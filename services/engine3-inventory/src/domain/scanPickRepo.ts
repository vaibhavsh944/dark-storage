import Database from 'better-sqlite3';
import {
  AppError,
  matchesBin,
  matchesSku,
  matchesTote,
  normalizeScan,
  PickerMissionDTO
} from '@dark-storage/shared';
import { runInTx } from '../db/tx.js';
import { getConfig } from './config.js';
import { toPickerMissionDTO } from '../dto/floorDtos.js';
import { appendAudit, appendOrderEvent } from '../audit/appendAudit.js';
import { postLedger } from '../ledger/postLedger.js';
import { emit } from './outbox.js';
import { ClaimActor } from './missionsClaimRepo.js';

function getActorName(actor: ClaimActor): string {
  return actor.username || actor.name || String(actor.id);
}

interface LoadedStopContext {
  stop: any;
  mission: any;
  order: any;
}

function loadAndValidateStop(db: Database.Database, stopRef: string, actor: ClaimActor): LoadedStopContext {
  const actorId = actor.id;

  // 1. Find stop by id, stop_ref, or missionRef-Sseq
  let stop = db.prepare(`
    SELECT ps.*, m.ref AS mission_ref, m.order_id, m.picker_id, m.status AS mission_status,
           m.lease_expires_at, m.tote_code AS mission_tote_code, m.version AS mission_version
    FROM pick_stops ps
    JOIN missions m ON m.id = ps.mission_id
    WHERE ps.stop_ref = ? OR ps.id = ?
  `).get(stopRef, Number(stopRef) || -1) as any;

  if (!stop && stopRef.includes('-S')) {
    const parts = stopRef.split('-S');
    const mRef = parts[0];
    const seq = parseInt(parts[1], 10);
    stop = db.prepare(`
      SELECT ps.*, m.ref AS mission_ref, m.order_id, m.picker_id, m.status AS mission_status,
             m.lease_expires_at, m.tote_code AS mission_tote_code, m.version AS mission_version
      FROM pick_stops ps
      JOIN missions m ON m.id = ps.mission_id
      WHERE m.ref = ? AND ps.seq = ?
    `).get(mRef, seq) as any;
  }

  if (!stop) {
    throw new AppError('NOT_FOUND', 404, `Pick stop "${stopRef}" not found`);
  }

  // 2. Verify ownership
  if (String(stop.picker_id) !== String(actorId)) {
    throw new AppError('MISSION_NOT_OWNED', 403, 'You do not own this mission');
  }

  // 3. Verify mission lease
  if (stop.lease_expires_at) {
    const exp = new Date(stop.lease_expires_at).getTime();
    if (exp < Date.now()) {
      throw new AppError('MISSION_LEASE_EXPIRED', 410, 'Mission lease has expired');
    }
  }

  // 4. Verify stop sequence
  const allStops = db.prepare(`
    SELECT id, seq, step, status
    FROM pick_stops
    WHERE mission_id = ?
    ORDER BY seq ASC
  `).all(stop.mission_id) as Array<{ id: number; seq: number; step: string; status: string }>;

  const activeFirstStop = allStops.find(s => !['DONE', 'SHORT', 'CANCELLED'].includes(s.step));
  if (activeFirstStop && activeFirstStop.id !== stop.id) {
    throw new AppError('SCAN_OUT_OF_SEQUENCE', 422, 'Complete earlier stop first');
  }

  const order = db.prepare('SELECT id, ref, status FROM orders WHERE id = ?').get(stop.order_id) as any;
  const mission = db.prepare('SELECT * FROM missions WHERE id = ?').get(stop.mission_id) as any;

  return { stop, mission, order };
}

function recordScanRejection(
  db: Database.Database,
  orderRef: string,
  missionRef: string,
  actor: ClaimActor,
  scanType: 'BIN' | 'ITEM' | 'TOTE',
  scanned: string,
  expected: string
) {
  const actorName = getActorName(actor);
  const actorRole = actor.role || 'PICKER';

  runInTx(db, () => {
    appendOrderEvent(db, {
      orderRef,
      event: 'scan.rejected',
      actor: { id: actor.id, username: actorName, role: actorRole },
      payload: {
        missionRef,
        scanType,
        scanned,
        expected
      }
    });

    appendAudit(db, {
      actor: { id: actor.id, username: actorName, role: actorRole },
      action: 'scan.rejected',
      entityType: 'PICK_STOP',
      entityId: missionRef,
      details: {
        scanType,
        scanned,
        expected
      }
    });
  });
}

export function scanBin(
  db: Database.Database,
  stopRef: string,
  rawScan: string,
  actor: ClaimActor
): { ok: true; step: 'BIN_OK'; mission: PickerMissionDTO } {
  const { stop, mission, order } = loadAndValidateStop(db, stopRef, actor);

  if (stop.step !== 'PENDING') {
    throw new AppError('SCAN_INVALID_STEP', 422, `Stop is in step ${stop.step}, expected PENDING`);
  }

  if (!matchesBin(rawScan, stop.bin_code)) {
    recordScanRejection(db, order.ref, mission.ref, actor, 'BIN', rawScan, stop.bin_code);
    throw new AppError('SCAN_WRONG_BIN', 422, `Wrong bin scanned. Expected ${stop.bin_code}, got ${rawScan}`);
  }

  return runInTx(db, () => {
    const leaseSec = getConfig<number>(db, 'lease.mission_seconds') || 300;
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + leaseSec * 1000).toISOString();

    // Update stop
    db.prepare(`
      UPDATE pick_stops
      SET step = 'BIN_OK',
          status = 'IN_PROGRESS',
          bin_scanned_at = ?,
          version = version + 1
      WHERE id = ?
    `).run(nowIso, stop.id);

    // If mission was ASSIGNED, transition to IN_PROGRESS
    if (mission.status === 'ASSIGNED') {
      db.prepare(`
        UPDATE missions
        SET status = 'IN_PROGRESS',
            started_at = ?,
            lease_expires_at = ?,
            last_heartbeat_at = ?,
            version = version + 1
        WHERE id = ?
      `).run(nowIso, leaseExpiresAt, nowIso, mission.id);

      db.prepare(`
        UPDATE orders
        SET status = 'PICKING',
            updated_at = ?
        WHERE id = ?
      `).run(nowIso, order.id);
    } else {
      db.prepare(`
        UPDATE missions
        SET lease_expires_at = ?,
            last_heartbeat_at = ?,
            version = version + 1
        WHERE id = ?
      `).run(leaseExpiresAt, nowIso, mission.id);
    }

    const updatedMission = db.prepare('SELECT * FROM missions WHERE id = ?').get(mission.id);
    return {
      ok: true,
      step: 'BIN_OK',
      mission: toPickerMissionDTO(db, updatedMission)
    };
  });
}

export function scanItem(
  db: Database.Database,
  stopRef: string,
  rawScan: string,
  qty: number,
  actor: ClaimActor
): { ok: true; step: 'ITEM_OK'; mission: PickerMissionDTO } {
  const { stop, mission, order } = loadAndValidateStop(db, stopRef, actor);

  if (stop.step !== 'BIN_OK') {
    throw new AppError('SCAN_INVALID_STEP', 422, `Stop is in step ${stop.step}, expected BIN_OK`);
  }

  const product = db.prepare('SELECT sku, barcode FROM products WHERE sku = ?').get(stop.sku) as any;
  if (!product || !matchesSku(rawScan, product)) {
    recordScanRejection(db, order.ref, mission.ref, actor, 'ITEM', rawScan, stop.sku);
    throw new AppError('SCAN_WRONG_ITEM', 422, `Wrong item scanned. Expected ${stop.sku}, got ${rawScan}`);
  }

  const intQty = Math.floor(Number(qty));
  if (!intQty || intQty < 1 || intQty > stop.qty_required) {
    throw new AppError('SCAN_QTY_EXCEEDS', 422, `Quantity must be between 1 and ${stop.qty_required}`);
  }

  return runInTx(db, () => {
    const leaseSec = getConfig<number>(db, 'lease.mission_seconds') || 300;
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + leaseSec * 1000).toISOString();

    db.prepare(`
      UPDATE pick_stops
      SET step = 'ITEM_OK',
          qty_picked = ?,
          item_scanned_at = ?,
          version = version + 1
      WHERE id = ?
    `).run(intQty, nowIso, stop.id);

    db.prepare(`
      UPDATE missions
      SET lease_expires_at = ?,
          last_heartbeat_at = ?,
          version = version + 1
      WHERE id = ?
    `).run(leaseExpiresAt, nowIso, mission.id);

    const updatedMission = db.prepare('SELECT * FROM missions WHERE id = ?').get(mission.id);
    return {
      ok: true,
      step: 'ITEM_OK',
      mission: toPickerMissionDTO(db, updatedMission)
    };
  });
}

export function scanTote(
  db: Database.Database,
  stopRef: string,
  rawScan: string,
  actor: ClaimActor
): { ok: true; step: 'DONE'; mission: PickerMissionDTO } {
  const { stop, mission, order } = loadAndValidateStop(db, stopRef, actor);

  if (stop.step !== 'ITEM_OK') {
    throw new AppError('SCAN_INVALID_STEP', 422, `Stop is in step ${stop.step}, expected ITEM_OK`);
  }

  let assignedToteCode = mission.tote_code;

  if (!assignedToteCode) {
    // Find matching tote
    const allTotes = db.prepare('SELECT tote_code, status FROM totes').all() as Array<{ tote_code: string; status: string }>;
    const matchingTote = allTotes.find(t => matchesTote(rawScan, t.tote_code));

    if (!matchingTote) {
      recordScanRejection(db, order.ref, mission.ref, actor, 'TOTE', rawScan, 'ANY_FREE_TOTE');
      throw new AppError('SCAN_WRONG_TOTE', 422, `Tote ${rawScan} not found`);
    }

    if (matchingTote.status !== 'FREE') {
      recordScanRejection(db, order.ref, mission.ref, actor, 'TOTE', rawScan, 'FREE_TOTE');
      throw new AppError('TOTE_IN_USE', 422, `Tote ${matchingTote.tote_code} is ${matchingTote.status}, not FREE`);
    }

    assignedToteCode = matchingTote.tote_code;
  } else {
    if (!matchesTote(rawScan, assignedToteCode)) {
      recordScanRejection(db, order.ref, mission.ref, actor, 'TOTE', rawScan, assignedToteCode);
      throw new AppError('SCAN_WRONG_TOTE', 422, `Wrong tote scanned. Expected ${assignedToteCode}, got ${rawScan}`);
    }
  }

  return runInTx(db, () => {
    if (!mission.tote_code) {
      db.prepare(`
        UPDATE totes
        SET status = 'IN_USE',
            mission_ref = ?,
            order_ref = ?,
            updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        WHERE tote_code = ?
      `).run(mission.ref, order.ref, assignedToteCode);

      db.prepare(`
        UPDATE missions
        SET tote_code = ?
        WHERE id = ?
      `).run(assignedToteCode, mission.id);
    }
    const locKey = `BIN:${stop.bin_code}`;
    const lotRow = db.prepare(`
      SELECT lot_id
      FROM location_balances
      WHERE location_key = ? AND sku = ? AND qty > 0
      ORDER BY qty DESC
      LIMIT 1
    `).get(locKey, stop.sku) as { lot_id: string } | undefined;

    const lotId = lotRow?.lot_id || `LOT-OPEN-${stop.sku}`;

    // 2. Move stock: BIN -> TOTE
    postLedger(
      db,
      [
        {
          sku: stop.sku,
          lotId,
          qty: stop.qty_picked,
          from: locKey,
          to: `TOTE:${assignedToteCode}`,
          type: 'PICK'
        }
      ],
      actor
    );

    // 3. Decrement reserved_qty in inventory projection
    db.prepare(`
      UPDATE inventory
      SET reserved_qty = MAX(0, reserved_qty - ?)
      WHERE bin_code = ?
    `).run(stop.qty_picked, stop.bin_code);

    // 4. Mark reservation consumed
    if (stop.reservation_id) {
      db.prepare(`
        UPDATE reservations
        SET status = 'CONSUMED',
            consumed_qty = qty,
            updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        WHERE id = ?
      `).run(stop.reservation_id);
    }

    // 5. Update order_lines
    db.prepare(`
      UPDATE order_lines
      SET qty_picked = qty_picked + ?
      WHERE order_id = ? AND sku = ?
    `).run(stop.qty_picked, order.id, stop.sku);

    const now = new Date();
    const nowIso = now.toISOString();

    // 6. Update pick_stop
    db.prepare(`
      UPDATE pick_stops
      SET step = 'DONE',
          status = 'CONFIRMED',
          tote_scanned_at = ?,
          lot_id = ?,
          version = version + 1
      WHERE id = ?
    `).run(nowIso, lotId, stop.id);

    // 7. Check if all stops in mission are now DONE/SHORT/CANCELLED
    const remainingPending = (db.prepare(`
      SELECT COUNT(*) AS c
      FROM pick_stops
      WHERE mission_id = ? AND step NOT IN ('DONE', 'SHORT', 'CANCELLED')
    `).get(mission.id) as { c: number }).c;

    if (remainingPending === 0) {
      db.prepare(`
        UPDATE missions
        SET status = 'COMPLETED',
            completed_at = ?,
            version = version + 1
        WHERE id = ?
      `).run(nowIso, mission.id);

      db.prepare(`
        UPDATE orders
        SET status = 'PICKED',
            updated_at = ?,
            completed_at = ?
        WHERE id = ?
      `).run(nowIso, nowIso, order.id);

      db.prepare(`
        UPDATE totes
        SET status = 'AWAITING_PACK',
            updated_at = ?
        WHERE tote_code = ?
      `).run(nowIso, assignedToteCode);

      appendOrderEvent(db, {
        orderRef: order.ref,
        event: 'order.picked',
        actor: { id: actor.id, username: getActorName(actor), role: actor.role || 'PICKER' },
        payload: {
          missionRef: mission.ref,
          toteCode: assignedToteCode
        }
      });

      emit(db, {
        event_type: 'mission.completed',
        entity_type: 'MISSION',
        entity_id: mission.ref,
        data: {
          mission_ref: mission.ref,
          order_ref: order.ref,
          tote_code: assignedToteCode
        }
      });
    }

    const finalMission = db.prepare('SELECT * FROM missions WHERE id = ?').get(mission.id);
    return {
      ok: true,
      step: 'DONE',
      mission: toPickerMissionDTO(db, finalMission)
    };
  });
}
