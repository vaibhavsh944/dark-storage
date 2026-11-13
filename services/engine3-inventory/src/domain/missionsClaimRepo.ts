import Database from 'better-sqlite3';
import {
  AppError,
  matchesBin,
  matchesSku,
  matchesTote,
  normalizeScan,
  transition,
  PickerMissionDTO
} from '@dark-storage/shared';
import { runInTx } from '../db/tx.js';
import { getConfig } from './config.js';
import { toPickerMissionDTO } from '../dto/floorDtos.js';
import { appendAudit, appendOrderEvent } from '../audit/appendAudit.js';
import { postLedger } from '../ledger/postLedger.js';
import { emit } from './outbox.js';

export interface ClaimActor {
  id: number | string;
  username?: string;
  name?: string;
  role?: string;
  zones?: string[];
}

function getActorName(actor: ClaimActor): string {
  return actor.username || actor.name || String(actor.id);
}

export function claimNextMission(db: Database.Database, actor: ClaimActor): PickerMissionDTO {
  return runInTx(db, () => {
    const actorId = actor.id;
    const actorName = getActorName(actor);
    const actorRole = actor.role || 'PICKER';

    // 1. Check if caller already has an active mission
    const activeMission = db.prepare(`
      SELECT id, ref FROM missions
      WHERE picker_id = ? AND status IN ('ASSIGNED', 'IN_PROGRESS')
    `).get(actorId) as { id: number; ref: string } | undefined;

    if (activeMission) {
      throw new AppError('ACTIVE_MISSION_EXISTS', 409, 'You already have an active mission');
    }

    // 2. Determine caller's allowed zones
    let allowedZones: string[] = actor.zones || [];
    if (!actor.zones) {
      const u = db.prepare('SELECT zones FROM users WHERE id = ?').get(actorId) as { zones: string } | undefined;
      if (u && u.zones) {
        try {
          allowedZones = JSON.parse(u.zones);
        } catch {
          allowedZones = [];
        }
      }
    }

    // 3. Find candidate missions with status = 'CREATED'
    const candidates = db.prepare(`
      SELECT
        m.id,
        m.ref,
        m.order_id,
        m.status,
        m.priority,
        m.sla_due_at,
        m.version,
        m.tote_code,
        o.ref AS order_ref,
        o.status AS order_status,
        COALESCE(o.requested_by, o.customer_ref) AS order_creator
      FROM missions m
      JOIN orders o ON o.id = m.order_id
      WHERE m.status = 'CREATED'
      ORDER BY m.priority ASC, m.sla_due_at ASC, m.id ASC
    `).all() as Array<{
      id: number;
      ref: string;
      order_id: number;
      status: string;
      priority: number;
      sla_due_at: string | null;
      version: number;
      tote_code: string | null;
      order_ref: string;
      order_status: string;
      order_creator: any;
    }>;

    if (candidates.length === 0) {
      throw new AppError('NO_MISSION_AVAILABLE', 404, 'No missions waiting in queue');
    }

    let selectedMission: typeof candidates[0] | null = null;
    let sodViolationCount = 0;

    for (const cand of candidates) {
      // Segregation of duties: order creator cannot pick their own order
      if (String(cand.order_creator) === String(actorId)) {
        sodViolationCount++;
        continue;
      }

      // Zone filtering if caller's zones array is non-empty
      if (allowedZones.length > 0) {
        const stopAisles = db.prepare(`
          SELECT DISTINCT sh.aisle
          FROM pick_stops ps
          JOIN bins b ON b.code = ps.bin_code
          JOIN shelves sh ON sh.code = b.shelf_code
          WHERE ps.mission_id = ?
        `).all(cand.id) as Array<{ aisle: string }>;

        const matchesZone = stopAisles.some(a => allowedZones.includes(a.aisle));
        if (!matchesZone) {
          continue;
        }
      }

      selectedMission = cand;
      break;
    }

    if (!selectedMission) {
      if (sodViolationCount === candidates.length) {
        throw new AppError('SOD_VIOLATION', 403, 'Cannot pick an order you created');
      }
      throw new AppError('NO_MISSION_AVAILABLE', 404, 'No missions waiting in queue');
    }

    // 4. State transitions
    transition('MISSION', 'CREATED', 'claim');
    transition('ORDER', selectedMission.order_status, 'assign');

    const leaseSec = getConfig<number>(db, 'lease.mission_seconds') || 300;
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + leaseSec * 1000).toISOString();

    // 5. Optimistic locking claim update
    const updateRes = db.prepare(`
      UPDATE missions
      SET status = 'ASSIGNED',
          picker_id = ?,
          claimed_at = ?,
          lease_expires_at = ?,
          last_heartbeat_at = ?,
          version = version + 1
      WHERE id = ? AND version = ? AND status = 'CREATED'
    `).run(actorId, nowIso, leaseExpiresAt, nowIso, selectedMission.id, selectedMission.version);

    if (updateRes.changes !== 1) {
      throw new AppError('VERSION_CONFLICT', 409, 'Mission was just claimed by another picker');
    }

    // 6. Update order status
    db.prepare(`
      UPDATE orders
      SET status = 'ASSIGNED',
          updated_at = ?
      WHERE id = ?
    `).run(nowIso, selectedMission.order_id);

    // 7. Audit & Order Events
    appendOrderEvent(db, {
      orderRef: selectedMission.order_ref,
      event: 'mission.claimed',
      actor: { id: actorId, username: actorName, role: actorRole },
      payload: {
        missionRef: selectedMission.ref,
        pickerId: actorId
      }
    });

    appendAudit(db, {
      actor: { id: actorId, username: actorName, role: actorRole },
      action: 'mission.claimed',
      entityType: 'MISSION',
      entityId: selectedMission.ref,
      details: {
        orderRef: selectedMission.order_ref,
        leaseExpiresAt
      }
    });

    emit(db, {
      event_type: 'mission.claimed',
      entity_type: 'MISSION',
      entity_id: selectedMission.ref,
      data: {
        mission_ref: selectedMission.ref,
        order_ref: selectedMission.order_ref,
        picker_id: actorId,
        lease_expires_at: leaseExpiresAt
      }
    });

    const updatedRow = db.prepare('SELECT * FROM missions WHERE id = ?').get(selectedMission.id);
    return toPickerMissionDTO(db, updatedRow);
  });
}

export function heartbeatMission(db: Database.Database, missionRef: string, actor: ClaimActor): { ok: true; leaseExpiresAt: string } {
  return runInTx(db, () => {
    const actorId = actor.id;
    const mission = db.prepare(`
      SELECT id, ref, picker_id, status, lease_expires_at
      FROM missions
      WHERE ref = ?
    `).get(missionRef) as { id: number; ref: string; picker_id: any; status: string; lease_expires_at: string | null } | undefined;

    if (!mission) {
      throw new AppError('NOT_FOUND', 404, `Mission ${missionRef} not found`);
    }

    if (String(mission.picker_id) !== String(actorId)) {
      throw new AppError('MISSION_NOT_OWNED', 403, 'You do not own this mission');
    }

    if (!['ASSIGNED', 'IN_PROGRESS'].includes(mission.status)) {
      throw new AppError('MISSION_STATE_INVALID', 409, `Mission is in status ${mission.status}`);
    }

    const leaseSec = getConfig<number>(db, 'lease.mission_seconds') || 300;
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + leaseSec * 1000).toISOString();

    db.prepare(`
      UPDATE missions
      SET lease_expires_at = ?,
          last_heartbeat_at = ?,
          version = version + 1
      WHERE id = ?
    `).run(leaseExpiresAt, nowIso, mission.id);

    return { ok: true, leaseExpiresAt };
  });
}

export function releaseMission(db: Database.Database, missionRef: string, actor: ClaimActor): { ok: true; status: 'CREATED' } {
  return runInTx(db, () => {
    const actorId = actor.id;
    const actorName = getActorName(actor);
    const actorRole = actor.role || 'PICKER';

    const mission = db.prepare(`
      SELECT m.id, m.ref, m.picker_id, m.status, m.order_id, m.tote_code, o.ref AS order_ref
      FROM missions m
      JOIN orders o ON o.id = m.order_id
      WHERE m.ref = ?
    `).get(missionRef) as {
      id: number;
      ref: string;
      picker_id: any;
      status: string;
      order_id: number;
      tote_code: string | null;
      order_ref: string;
    } | undefined;

    if (!mission) {
      throw new AppError('NOT_FOUND', 404, `Mission ${missionRef} not found`);
    }

    if (String(mission.picker_id) !== String(actorId)) {
      throw new AppError('MISSION_NOT_OWNED', 403, 'You do not own this mission');
    }

    // Check stops
    const doneStopsCount = (db.prepare(`
      SELECT COUNT(*) AS c
      FROM pick_stops
      WHERE mission_id = ? AND step = 'DONE'
    `).get(mission.id) as { c: number }).c;

    const newOrderStatus = doneStopsCount === 0 ? 'RESERVED' : 'PICKING';
    const nowIso = new Date().toISOString();

    db.prepare(`
      UPDATE missions
      SET status = 'CREATED',
          picker_id = NULL,
          lease_expires_at = NULL,
          version = version + 1
      WHERE id = ?
    `).run(mission.id);

    db.prepare(`
      UPDATE orders
      SET status = ?,
          updated_at = ?
      WHERE id = ?
    `).run(newOrderStatus, nowIso, mission.order_id);

    appendOrderEvent(db, {
      orderRef: mission.order_ref,
      event: 'mission.released',
      actor: { id: actorId, username: actorName, role: actorRole },
      payload: {
        missionRef: mission.ref,
        doneStopsCount
      }
    });

    appendAudit(db, {
      actor: { id: actorId, username: actorName, role: actorRole },
      action: 'mission.released',
      entityType: 'MISSION',
      entityId: mission.ref,
      details: {
        orderRef: mission.order_ref,
        doneStopsCount
      }
    });

    emit(db, {
      event_type: 'mission.released',
      entity_type: 'MISSION',
      entity_id: mission.ref,
      data: {
        mission_ref: mission.ref,
        order_ref: mission.order_ref
      }
    });

    return { ok: true, status: 'CREATED' };
  });
}

export function forceUnassignMission(
  db: Database.Database,
  missionRef: string,
  actor: ClaimActor,
  reasonCode: string,
  note?: string
): { ok: true; status: 'CREATED' } {
  return runInTx(db, () => {
    const actorName = getActorName(actor);
    const actorRole = actor.role || 'MANAGER';

    const mission = db.prepare(`
      SELECT m.id, m.ref, m.picker_id, m.status, m.order_id, o.ref AS order_ref
      FROM missions m
      JOIN orders o ON o.id = m.order_id
      WHERE m.ref = ?
    `).get(missionRef) as {
      id: number;
      ref: string;
      picker_id: any;
      status: string;
      order_id: number;
      order_ref: string;
    } | undefined;

    if (!mission) {
      throw new AppError('NOT_FOUND', 404, `Mission ${missionRef} not found`);
    }

    const doneStopsCount = (db.prepare(`
      SELECT COUNT(*) AS c
      FROM pick_stops
      WHERE mission_id = ? AND step = 'DONE'
    `).get(mission.id) as { c: number }).c;

    const newOrderStatus = doneStopsCount === 0 ? 'RESERVED' : 'PICKING';
    const nowIso = new Date().toISOString();

    db.prepare(`
      UPDATE missions
      SET status = 'CREATED',
          picker_id = NULL,
          lease_expires_at = NULL,
          version = version + 1
      WHERE id = ?
    `).run(mission.id);

    db.prepare(`
      UPDATE orders
      SET status = ?,
          updated_at = ?
      WHERE id = ?
    `).run(newOrderStatus, nowIso, mission.order_id);

    appendOrderEvent(db, {
      orderRef: mission.order_ref,
      event: 'mission.force_unassigned',
      actor: { id: actor.id, username: actorName, role: actorRole },
      payload: {
        missionRef: mission.ref,
        note: note || '',
        reasonCode
      }
    });

    appendAudit(db, {
      actor: { id: actor.id, username: actorName, role: actorRole },
      action: 'mission.force_unassigned',
      entityType: 'MISSION',
      entityId: mission.ref,
      reasonCode,
      details: {
        orderRef: mission.order_ref,
        note: note || ''
      }
    });

    emit(db, {
      event_type: 'mission.force_unassigned',
      entity_type: 'MISSION',
      entity_id: mission.ref,
      data: {
        mission_ref: mission.ref,
        order_ref: mission.order_ref,
        reason_code: reasonCode
      }
    });

    return { ok: true, status: 'CREATED' };
  });
}

export function getPickerActiveMission(db: Database.Database, actor: ClaimActor): PickerMissionDTO {
  const actorId = actor.id;
  const mission = db.prepare(`
    SELECT *
    FROM missions
    WHERE picker_id = ? AND status IN ('ASSIGNED', 'IN_PROGRESS')
    ORDER BY id DESC
    LIMIT 1
  `).get(actorId);

  if (!mission) {
    throw new AppError('NO_MISSION_AVAILABLE', 404, 'No active mission found for picker');
  }

  return toPickerMissionDTO(db, mission);
}
