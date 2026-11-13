import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import {
  AppError,
  matchesTote,
  matchesSku,
  matchesSlot,
  normalizeScan,
  PackSessionDTO,
  transition
} from '@dark-storage/shared';
import { runInTx } from '../db/tx.js';
import { nextRef } from './ids.js';
import { appendAudit, appendOrderEvent } from '../audit/appendAudit.js';
import { postLedger } from '../ledger/postLedger.js';
import { getConfig } from './config.js';
import { toPackSessionDTO } from '../dto/floorDtos.js';
import { recordDemoOtp } from './dispatchRepo.js';

export interface ActorInfo {
  id: number | string;
  username: string;
  role: string;
}

export function openPackSession(
  db: Database.Database,
  params: {
    toteScan: string;
    benchCode?: string;
    actor: ActorInfo;
  }
): PackSessionDTO {
  const normScan = normalizeScan(params.toteScan);
  if (!normScan) {
    throw new AppError('SCAN_WRONG_TOTE', 422, 'Tote scan barcode is required');
  }

  // Find tote
  const tote = db
    .prepare('SELECT tote_code, status, mission_ref, order_ref FROM totes WHERE tote_code = ?')
    .get(normScan) as { tote_code: string; status: string; mission_ref: string | null; order_ref: string | null } | undefined;

  if (!tote) {
    throw new AppError('SCAN_WRONG_TOTE', 422, `Tote ${normScan} not found`);
  }

  // Check if resuming own open session
  const existingOpenSession = db
    .prepare('SELECT * FROM pack_sessions WHERE tote_code = ? AND status = \'OPEN\'')
    .get(tote.tote_code) as any;

  if (existingOpenSession) {
    if (String(existingOpenSession.opened_by) === String(params.actor.id)) {
      return toPackSessionDTO(db, existingOpenSession);
    } else {
      throw new AppError('TOTE_BUSY', 409, `Tote ${tote.tote_code} is currently being packed by another operator`);
    }
  }

  if (tote.status !== 'AWAITING_PACK') {
    throw new AppError('ORDER_NOT_PICKED', 409, `Tote ${tote.tote_code} is not ready for packing (status: ${tote.status})`);
  }

  // Find linked order
  let orderRef = tote.order_ref;
  if (!orderRef && tote.mission_ref) {
    const m = db.prepare('SELECT o.ref FROM missions m JOIN orders o ON o.id = m.order_id WHERE m.ref = ?').get(tote.mission_ref) as { ref: string } | undefined;
    if (m) orderRef = m.ref;
  }

  if (!orderRef) {
    throw new AppError('ORDER_NOT_PICKED', 409, `No order linked to tote ${tote.tote_code}`);
  }

  const order = db.prepare('SELECT * FROM orders WHERE ref = ?').get(orderRef) as any;
  if (!order) {
    throw new AppError('ORDER_NOT_FOUND', 404, `Order ${orderRef} not found`);
  }

  if (order.status !== 'PICKED') {
    throw new AppError('ORDER_NOT_PICKED', 409, `Order ${orderRef} is in status ${order.status}, must be PICKED to pack`);
  }

  // Segregation of Duties: Order creator cannot pack order
  if (String(order.requested_by) === String(params.actor.id)) {
    throw new AppError('SOD_VIOLATION', 403, 'Segregation of Duties: Order requester cannot pack order');
  }

  const benchCode = params.benchCode || 'BENCH-1';

  // Compute expected weight
  const bagTare = getConfig<number>(db, 'pack.bag_tare_g') ?? 40;
  const orderLines = db.prepare(`
    SELECT ol.sku, ol.qty_picked, ol.qty_ordered, p.weight_g
    FROM order_lines ol
    LEFT JOIN products p ON p.sku = ol.sku COLLATE NOCASE
    WHERE ol.order_id = ?
  `).all(order.id) as Array<{ sku: string; qty_picked: number; qty_ordered: number; weight_g: number | null }>;

  let itemsWeight = 0;
  for (const line of orderLines) {
    const qty = line.qty_picked > 0 ? line.qty_picked : line.qty_ordered;
    itemsWeight += qty * (line.weight_g || 100);
  }
  const expectedWeightG = itemsWeight + bagTare;

  return runInTx(db, () => {
    // Transition order PICKED -> PACKING
    transition('ORDER', order.status, 'open_pack');
    db.prepare(`
      UPDATE orders
      SET status = 'PACKING', updated_at = datetime('now'), version = version + 1
      WHERE id = ?
    `).run(order.id);

    // Update tote status
    db.prepare(`
      UPDATE totes
      SET status = 'PACKING', updated_at = datetime('now')
      WHERE tote_code = ?
    `).run(tote.tote_code);

    // Insert pack session
    const insertResult = db.prepare(`
      INSERT INTO pack_sessions (
        order_ref, tote_code, bench_code, opened_by, opened_at,
        status, weight_g, expected_weight_g, weight_ok
      ) VALUES (?, ?, ?, ?, datetime('now'), 'OPEN', NULL, ?, 0)
    `).run(order.ref, tote.tote_code, benchCode, String(params.actor.id), expectedWeightG);

    const sessionId = Number(insertResult.lastInsertRowid);

    // Order event
    appendOrderEvent(db, {
      orderRef: order.ref,
      event: 'order.packing_opened',
      actor: params.actor,
      payload: {
        sessionId,
        tote_code: tote.tote_code,
        bench_code: benchCode
      }
    });

    // Audit log
    appendAudit(db, {
      actor: params.actor,
      action: 'order.packing_opened',
      entityType: 'pack_session',
      entityId: String(sessionId),
      details: {
        order_ref: order.ref,
        tote_code: tote.tote_code,
        bench_code: benchCode
      }
    });

    const session = db.prepare('SELECT * FROM pack_sessions WHERE id = ?').get(sessionId);
    return toPackSessionDTO(db, session);
  });
}

export function getPackSession(db: Database.Database, sessionId: number): PackSessionDTO {
  const session = db.prepare('SELECT * FROM pack_sessions WHERE id = ?').get(sessionId);
  if (!session) {
    throw new AppError('NOT_FOUND', 404, `Pack session ${sessionId} not found`);
  }
  return toPackSessionDTO(db, session);
}

export function scanPackItem(
  db: Database.Database,
  sessionId: number,
  params: {
    scan: string;
    actor: ActorInfo;
  }
): PackSessionDTO {
  const session = db.prepare('SELECT * FROM pack_sessions WHERE id = ?').get(sessionId) as any;
  if (!session) {
    throw new AppError('NOT_FOUND', 404, `Pack session ${sessionId} not found`);
  }
  if (session.status !== 'OPEN') {
    throw new AppError('SESSION_CLOSED', 409, `Pack session ${sessionId} is closed (${session.status})`);
  }

  const normScan = normalizeScan(params.scan);
  if (!normScan) {
    throw new AppError('PACK_ITEM_NOT_IN_ORDER', 422, 'Scan barcode is required');
  }

  const order = db.prepare('SELECT id, ref FROM orders WHERE ref = ?').get(session.order_ref) as { id: number; ref: string } | undefined;
  if (!order) {
    throw new AppError('ORDER_NOT_FOUND', 404, `Order ${session.order_ref} not found`);
  }

  // Fetch lines
  const orderLines = db.prepare(`
    SELECT ol.id, ol.sku, ol.qty_ordered, ol.qty_picked, p.barcode, p.name AS product_name, p.weight_g
    FROM order_lines ol
    LEFT JOIN products p ON p.sku = ol.sku COLLATE NOCASE
    WHERE ol.order_id = ?
  `).all(order.id) as Array<{
    id: number;
    sku: string;
    qty_ordered: number;
    qty_picked: number;
    barcode: string | null;
    product_name: string | null;
    weight_g: number | null;
  }>;

  const matchedLine = orderLines.find(l => matchesSku(normScan, { sku: l.sku, barcode: l.barcode }));
  if (!matchedLine) {
    throw new AppError('PACK_ITEM_NOT_IN_ORDER', 422, `Scanned item ${normScan} is not part of order ${session.order_ref}`);
  }

  const expectedQty = matchedLine.qty_picked > 0 ? matchedLine.qty_picked : matchedLine.qty_ordered;

  // Check overscan
  const scanCounts = db.prepare(`
    SELECT
      SUM(CASE WHEN kind = 'SCANNED' THEN qty ELSE 0 END) AS scanned_qty,
      SUM(CASE WHEN kind IN ('MISSING', 'DAMAGED') THEN qty ELSE 0 END) AS flagged_qty
    FROM pack_scans
    WHERE session_id = ? AND sku = ?
  `).get(sessionId, matchedLine.sku) as { scanned_qty: number | null; flagged_qty: number | null };

  const currentScanned = Number(scanCounts?.scanned_qty || 0);
  const currentFlagged = Number(scanCounts?.flagged_qty || 0);

  if (currentScanned + currentFlagged >= expectedQty) {
    throw new AppError('PACK_ITEM_OVERSCAN', 422, `SKU ${matchedLine.sku} already has ${currentScanned} scanned + ${currentFlagged} flagged of ${expectedQty} expected`);
  }

  return runInTx(db, () => {
    // Select lot in TOTE:<toteCode> from location_balances (earliest expiry first)
    const toteLocation = `TOTE:${session.tote_code}`;
    const lotRow = db.prepare(`
      SELECT lb.lot_id, lb.qty
      FROM location_balances lb
      LEFT JOIN lots l ON l.lot_id = lb.lot_id
      WHERE lb.location_key = ? AND lb.sku = ? AND lb.qty > 0
      ORDER BY l.expiry_date ASC NULLS LAST, lb.qty DESC
      LIMIT 1
    `).get(toteLocation, matchedLine.sku) as { lot_id: string | null; qty: number } | undefined;

    const lotId = lotRow?.lot_id || 'LOT-DEFAULT';

    // Post ledger movement TOTE -> BENCH
    postLedger(
      db,
      [
        {
          sku: matchedLine.sku,
          lotId,
          qty: 1,
          from: toteLocation,
          to: `BENCH:${session.bench_code}`,
          type: 'PACK',
          orderRef: session.order_ref
        }
      ],
      params.actor
    );

    // Record scan
    db.prepare(`
      INSERT INTO pack_scans (
        session_id, sku, qty, kind, lot_id, at, actor_id
      ) VALUES (?, ?, 1, 'SCANNED', ?, datetime('now'), ?)
    `).run(sessionId, matchedLine.sku, lotId, String(params.actor.id));

    // Order event
    appendOrderEvent(db, {
      orderRef: session.order_ref,
      event: 'pack.item_scanned',
      actor: params.actor,
      payload: {
        sessionId,
        sku: matchedLine.sku,
        lotId
      }
    });

    appendAudit(db, {
      actor: params.actor,
      action: 'pack.item_scanned',
      entityType: 'pack_scan',
      entityId: String(sessionId),
      details: {
        order_ref: session.order_ref,
        sku: matchedLine.sku,
        lot_id: lotId
      }
    });

    const updated = db.prepare('SELECT * FROM pack_sessions WHERE id = ?').get(sessionId);
    return toPackSessionDTO(db, updated);
  });
}

export function flagPackItem(
  db: Database.Database,
  sessionId: number,
  params: {
    sku: string;
    qty: number;
    kind: 'MISSING' | 'DAMAGED';
    note?: string;
    actor: ActorInfo;
  }
): PackSessionDTO {
  const session = db.prepare('SELECT * FROM pack_sessions WHERE id = ?').get(sessionId) as any;
  if (!session) {
    throw new AppError('NOT_FOUND', 404, `Pack session ${sessionId} not found`);
  }
  if (session.status !== 'OPEN') {
    throw new AppError('SESSION_CLOSED', 409, `Pack session ${sessionId} is closed (${session.status})`);
  }

  const sku = params.sku.trim().toUpperCase();
  const qty = Number(params.qty);
  if (!qty || qty <= 0) {
    throw new AppError('INVALID_QUANTITY', 422, 'Flagged quantity must be > 0');
  }

  const order = db.prepare('SELECT id, ref FROM orders WHERE ref = ?').get(session.order_ref) as { id: number; ref: string } | undefined;
  if (!order) {
    throw new AppError('ORDER_NOT_FOUND', 404, `Order ${session.order_ref} not found`);
  }

  const line = db.prepare(`
    SELECT ol.sku, ol.qty_ordered, ol.qty_picked
    FROM order_lines ol
    WHERE ol.order_id = ? AND ol.sku = ? COLLATE NOCASE
  `).get(order.id, sku) as { sku: string; qty_ordered: number; qty_picked: number } | undefined;

  if (!line) {
    throw new AppError('PACK_ITEM_NOT_IN_ORDER', 422, `SKU ${sku} is not in order ${session.order_ref}`);
  }

  const expectedQty = line.qty_picked > 0 ? line.qty_picked : line.qty_ordered;

  const scanCounts = db.prepare(`
    SELECT
      SUM(CASE WHEN kind = 'SCANNED' THEN qty ELSE 0 END) AS scanned_qty,
      SUM(CASE WHEN kind IN ('MISSING', 'DAMAGED') THEN qty ELSE 0 END) AS flagged_qty
    FROM pack_scans
    WHERE session_id = ? AND sku = ?
  `).get(sessionId, line.sku) as { scanned_qty: number | null; flagged_qty: number | null };

  const currentScanned = Number(scanCounts?.scanned_qty || 0);
  const currentFlagged = Number(scanCounts?.flagged_qty || 0);

  if (currentScanned + currentFlagged + qty > expectedQty) {
    throw new AppError('PACK_ITEM_OVERSCAN', 422, `Flagging ${qty} exceeds remaining expected qty for ${sku}`);
  }

  return runInTx(db, () => {
    let lotId: string = 'LOT-DEFAULT';

    if (params.kind === 'DAMAGED') {
      const toteLocation = `TOTE:${session.tote_code}`;
      const lotRow = db.prepare(`
        SELECT lb.lot_id, lb.qty
        FROM location_balances lb
        WHERE lb.location_key = ? AND lb.sku = ? AND lb.qty >= ?
        LIMIT 1
      `).get(toteLocation, line.sku, qty) as { lot_id: string | null; qty: number } | undefined;

      lotId = lotRow?.lot_id || 'LOT-DEFAULT';

      postLedger(
        db,
        [
          {
            sku: line.sku,
            lotId,
            qty,
            from: toteLocation,
            to: 'QUAR',
            type: 'QUARANTINE',
            orderRef: session.order_ref
          }
        ],
        params.actor
      );
    }

    // Insert pack_scans
    db.prepare(`
      INSERT INTO pack_scans (
        session_id, sku, qty, kind, lot_id, at, actor_id
      ) VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
    `).run(sessionId, line.sku, qty, params.kind, lotId, String(params.actor.id));

    // Auto-create high-priority REPICK floor task
    const taskRef = nextRef(db, 'FLR');
    db.prepare(`
      INSERT INTO floor_tasks (
        task_ref, type, status, sku, lot_id, qty, order_ref, priority,
        created_by, created_at, payload
      ) VALUES (?, 'REPICK', 'OPEN', ?, ?, ?, ?, 100, ?, datetime('now'), ?)
    `).run(
      taskRef,
      line.sku,
      lotId,
      qty,
      session.order_ref,
      String(params.actor.id),
      JSON.stringify({
        reason: params.kind,
        note: params.note || '',
        sessionId: session.id,
        toteCode: session.tote_code
      })
    );

    // Event & audit
    appendOrderEvent(db, {
      orderRef: session.order_ref,
      event: 'pack.item_flagged',
      actor: params.actor,
      payload: {
        sessionId,
        sku: line.sku,
        qty,
        kind: params.kind,
        taskRef
      }
    });

    appendAudit(db, {
      actor: params.actor,
      action: 'pack.item_flagged',
      entityType: 'floor_task',
      entityId: taskRef,
      details: {
        order_ref: session.order_ref,
        sku: line.sku,
        qty,
        kind: params.kind
      }
    });

    const updated = db.prepare('SELECT * FROM pack_sessions WHERE id = ?').get(sessionId);
    return toPackSessionDTO(db, updated);
  });
}

export function weighPackSession(
  db: Database.Database,
  sessionId: number,
  params: {
    grams: number;
    actor: ActorInfo;
  }
): PackSessionDTO {
  const session = db.prepare('SELECT * FROM pack_sessions WHERE id = ?').get(sessionId) as any;
  if (!session) {
    throw new AppError('NOT_FOUND', 404, `Pack session ${sessionId} not found`);
  }
  if (session.status !== 'OPEN') {
    throw new AppError('SESSION_CLOSED', 409, `Pack session ${sessionId} is closed (${session.status})`);
  }

  const actualGrams = Number(params.grams);
  if (isNaN(actualGrams) || actualGrams < 0) {
    throw new AppError('INVALID_WEIGHT', 422, 'Weight grams must be a non-negative number');
  }

  // Calculate expected weight
  const bagTare = getConfig<number>(db, 'pack.bag_tare_g') ?? 40;
  const tolerancePct = getConfig<number>(db, 'pack.weight_tolerance_pct') ?? 8;

  const scannedItems = db.prepare(`
    SELECT ps.sku, ps.qty, p.weight_g
    FROM pack_scans ps
    LEFT JOIN products p ON p.sku = ps.sku COLLATE NOCASE
    WHERE ps.session_id = ? AND ps.kind = 'SCANNED'
  `).all(sessionId) as Array<{ sku: string; qty: number; weight_g: number | null }>;

  let itemsWeight = 0;
  for (const item of scannedItems) {
    itemsWeight += item.qty * (item.weight_g || 100);
  }
  const expectedWeightG = itemsWeight + bagTare;

  const delta = Math.abs(actualGrams - expectedWeightG);
  const allowed = expectedWeightG === 0 || (delta / expectedWeightG) * 100 <= tolerancePct;

  if (allowed) {
    db.prepare(`
      UPDATE pack_sessions
      SET weight_g = ?, expected_weight_g = ?, weight_ok = 1
      WHERE id = ?
    `).run(actualGrams, expectedWeightG, sessionId);

    appendAudit(db, {
      actor: params.actor,
      action: 'pack.weighed',
      entityType: 'pack_session',
      entityId: String(sessionId),
      details: {
        order_ref: session.order_ref,
        actual_g: actualGrams,
        expected_g: expectedWeightG,
        weight_ok: 1
      }
    });

    const updated = db.prepare('SELECT * FROM pack_sessions WHERE id = ?').get(sessionId);
    return toPackSessionDTO(db, updated);
  } else {
    db.prepare(`
      UPDATE pack_sessions
      SET weight_g = ?, expected_weight_g = ?, weight_ok = 0
      WHERE id = ?
    `).run(actualGrams, expectedWeightG, sessionId);

    throw new AppError('WEIGHT_MISMATCH', 422, `Scale weight mismatch: expected ${expectedWeightG}g ±${tolerancePct}%, got ${actualGrams}g`, {
      expected: expectedWeightG,
      actual: actualGrams,
      tolerancePct
    });
  }
}

export function completePackSession(
  db: Database.Database,
  sessionId: number,
  params: {
    slotScan: string;
    cartonType?: string;
    actor: ActorInfo;
  }
): { ok: boolean; orderRef: string; slotCode: string; fulfilmentType: 'FULL' | 'PARTIAL'; otp?: string } {
  const session = db.prepare('SELECT * FROM pack_sessions WHERE id = ?').get(sessionId) as any;
  if (!session) {
    throw new AppError('NOT_FOUND', 404, `Pack session ${sessionId} not found`);
  }
  if (session.status !== 'OPEN') {
    throw new AppError('SESSION_CLOSED', 409, `Pack session ${sessionId} is closed (${session.status})`);
  }

  // Check lines completion
  const sessionDTO = toPackSessionDTO(db, session);
  if (!sessionDTO.lines.length || !sessionDTO.lines.every(l => l.scannedQty + l.flaggedQty === l.expectedQty)) {
    throw new AppError('PACK_INCOMPLETE', 422, 'All order lines must be scanned or flagged before completing pack');
  }

  // Check scale weight verification
  if (!sessionDTO.weightOk) {
    throw new AppError('WEIGHT_MISMATCH', 422, 'Scale weight check must be verified before completing pack');
  }

  // Validate slotScan
  const normSlot = normalizeScan(params.slotScan);
  const slot = db.prepare('SELECT slot_code, status, order_ref FROM dispatch_slots WHERE slot_code = ?').get(normSlot) as { slot_code: string; status: string; order_ref: string | null } | undefined;
  if (!slot || !matchesSlot(normSlot, slot.slot_code)) {
    throw new AppError('SLOT_MISMATCH', 422, `Invalid dispatch slot scan: ${params.slotScan}`);
  }
  if (slot.status !== 'FREE') {
    throw new AppError('SLOT_OCCUPIED', 409, `Dispatch slot ${slot.slot_code} is currently occupied by ${slot.order_ref}`);
  }

  const order = db.prepare('SELECT id, ref, requested_by, status FROM orders WHERE ref = ?').get(session.order_ref) as any;
  if (!order) {
    throw new AppError('ORDER_NOT_FOUND', 404, `Order ${session.order_ref} not found`);
  }

  return runInTx(db, () => {
    const benchLocation = `BENCH:${session.bench_code}`;
    const slotLocation = `DISP:${slot.slot_code}`;

    // Query SCANNED items on bench
    const scannedItems = db.prepare(`
      SELECT sku, lot_id, SUM(qty) AS qty
      FROM pack_scans
      WHERE session_id = ? AND kind = 'SCANNED'
      GROUP BY sku, lot_id
    `).all(sessionId) as Array<{ sku: string; lot_id: string | null; qty: number }>;

    if (scannedItems.length > 0) {
      postLedger(
        db,
        scannedItems.map(item => ({
          sku: item.sku,
          lotId: item.lot_id || 'LOT-DEFAULT',
          qty: item.qty,
          from: benchLocation,
          to: slotLocation,
          type: 'STAGE_DISPATCH',
          orderRef: session.order_ref
        })),
        params.actor
      );
    }

    // Occupy dispatch slot
    db.prepare(`
      UPDATE dispatch_slots
      SET status = 'OCCUPIED', order_ref = ?
      WHERE slot_code = ?
    `).run(session.order_ref, slot.slot_code);

    // Free the tote
    db.prepare(`
      UPDATE totes
      SET status = 'FREE', mission_ref = NULL, order_ref = NULL, updated_at = datetime('now')
      WHERE tote_code = ?
    `).run(session.tote_code);

    // Transition order PACKING -> PACKED
    transition('ORDER', order.status, 'pack_complete');
    db.prepare(`
      UPDATE orders
      SET status = 'PACKED', packed_at = datetime('now'), updated_at = datetime('now'), version = version + 1
      WHERE id = ?
    `).run(order.id);

    // Check if any flagged
    const anyFlagged = db.prepare(`
      SELECT 1 FROM pack_scans WHERE session_id = ? AND kind IN ('MISSING','DAMAGED') LIMIT 1
    `).get(sessionId);
    const fulfilmentType: 'FULL' | 'PARTIAL' = anyFlagged ? 'PARTIAL' : 'FULL';

    // Insert packing_records
    const packRef = nextRef(db, 'PCK');
    const totalOrdered = sessionDTO.lines.reduce((acc, l) => acc + l.expectedQty, 0);
    const totalPicked = sessionDTO.lines.reduce((acc, l) => acc + l.scannedQty, 0);
    const trackingNumber = 'TRK-' + Date.now();

    db.prepare(`
      INSERT INTO packing_records (
        ref, order_id, mission_id, packed_by, packed_at, fulfilment_type,
        total_ordered, total_picked, session_id, tracking_number
      ) VALUES (?, ?, NULL, ?, datetime('now'), ?, ?, ?, ?, ?)
    `).run(
      packRef,
      order.id,
      Number(params.actor.id) || 1,
      fulfilmentType,
      totalOrdered,
      totalPicked,
      sessionId,
      trackingNumber
    );

    // Generate 4-digit Rider OTP
    const otp = String(crypto.randomInt(1000, 10000));
    const otpHash = crypto.createHash('sha256').update(otp + ':' + session.order_ref).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT OR REPLACE INTO dispatch_handovers (
        order_ref, slot_code, otp_hash, otp_expires_at, attempts, locked, handed_by, handed_at
      ) VALUES (?, ?, ?, ?, 0, 0, NULL, NULL)
    `).run(session.order_ref, slot.slot_code, otpHash, expiresAt);

    // Record demo OTP for demo mode helper
    recordDemoOtp(session.order_ref, otp);

    // Close pack session
    db.prepare(`
      UPDATE pack_sessions
      SET status = 'COMPLETE', completed_at = datetime('now')
      WHERE id = ?
    `).run(sessionId);

    // Events & audit
    appendOrderEvent(db, {
      orderRef: session.order_ref,
      event: 'order.packed',
      actor: params.actor,
      payload: {
        sessionId,
        slot_code: slot.slot_code,
        fulfilmentType,
        trackingNumber
      }
    });

    appendAudit(db, {
      actor: params.actor,
      action: 'pack.completed',
      entityType: 'pack_session',
      entityId: String(sessionId),
      details: {
        order_ref: session.order_ref,
        slot_code: slot.slot_code,
        fulfilment_type: fulfilmentType,
        tracking_number: trackingNumber
      }
    });

    const isDemo = process.env.DEMO_MODE === 'true';
    return {
      ok: true,
      orderRef: session.order_ref,
      slotCode: slot.slot_code,
      fulfilmentType,
      otp: isDemo ? otp : undefined
    };
  });
}
