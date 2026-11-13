import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import { postLedger, reconcileLedger, ensureLot } from '../../services/engine3-inventory/src/ledger/postLedger.js';
import { runInTx } from '../../services/engine3-inventory/src/db/tx.js';
import { claimNextMission } from '../../services/engine3-inventory/src/domain/missionsClaimRepo.js';
import { scanBin, scanItem, scanTote } from '../../services/engine3-inventory/src/domain/scanPickRepo.js';
import {
  openPackSession,
  getPackSession,
  scanPackItem,
  flagPackItem,
  weighPackSession,
  completePackSession
} from '../../services/engine3-inventory/src/domain/packingBenchRepo.js';
import {
  getDispatchQueue,
  handoverDispatchOrder,
  regenDispatchOtp,
  getDemoOtp
} from '../../services/engine3-inventory/src/domain/dispatchRepo.js';

describe('Pack Bench and Dispatch Handover Flow Integration Tests', () => {
  let db: Database.Database;

  const manager1 = { id: 1, username: 'manager1', role: 'MANAGER' };
  const operator1 = { id: 3, username: 'operator1', role: 'OPERATOR' };
  const picker1 = { id: 5, username: 'picker1', role: 'PICKER' };
  const staff1 = { id: 7, username: 'staff1', role: 'STAFF' };

  beforeEach(() => {
    db = makeTestDb();
    seedMinimal(db);

    // Opening inventory in BIN:A-01-01 (10 units of SKU-001)
    ensureLot(db, {
      lotId: 'LOT-TEST-001',
      sku: 'SKU-001',
      lotCode: 'LOT001'
    });

    runInTx(db, () => {
      postLedger(
        db,
        [
          {
            sku: 'SKU-001',
            lotId: 'LOT-TEST-001',
            qty: 10,
            from: 'EXT',
            to: 'BIN:A-01-01',
            type: 'OPENING'
          }
        ],
        { id: 'SYSTEM' }
      );
    });

    // Create Order with requested_by = 1 (manager1)
    db.prepare(`
      INSERT INTO orders (id, ref, order_type, priority, status, requested_by)
      VALUES (1, 'ORD-FLOW-001', 'CUSTOMER', 'NORMAL', 'RESERVED', 1)
    `).run();

    db.prepare(`
      INSERT INTO order_lines (id, order_id, line_no, sku, qty_ordered)
      VALUES (1, 1, 1, 'SKU-001', 2)
    `).run();

    db.prepare(`
      INSERT INTO reservations (id, order_id, order_line_id, sku, bin_code, qty, status)
      VALUES (1, 1, 1, 'SKU-001', 'A-01-01', 2, 'HELD')
    `).run();

    db.prepare(`
      INSERT INTO missions (
        id, ref, order_id, status, route_json, route_distance, route_algorithm,
        priority, version
      ) VALUES (
        1, 'MSN-FLOW-001', 1, 'CREATED', '[]', 5.0, 'TRIVIAL',
        100, 0
      )
    `).run();

    db.prepare(`
      INSERT INTO pick_stops (
        id, mission_id, stop_no, stop_ref, seq, reservation_id, bin_code, sku,
        qty_required, qty_picked, status, step
      ) VALUES (
        1, 1, 1, 'MSN-FLOW-001-S1', 1, 1, 'A-01-01', 'SKU-001',
        2, 0, 'PENDING', 'PENDING'
      )
    `).run();
  });

  it('Happy path: Receive -> Putaway -> Order -> Pick -> Pack -> Weigh -> Stage -> Handover with OTP', () => {
    // 1. Picker claims mission
    const claimed = claimNextMission(db, picker1);
    expect(claimed).not.toBeNull();
    const toteCode = 'TOTE-001';

    // 2. 3-step picking execution
    scanBin(db, 'MSN-FLOW-001-S1', 'A-01-01', picker1);
    scanItem(db, 'MSN-FLOW-001-S1', 'SKU-001', 2, picker1);
    const pickResult = scanTote(db, 'MSN-FLOW-001-S1', toteCode, picker1);

    expect(pickResult.mission.status).toBe('COMPLETED');
    const pickedOrder = db.prepare('SELECT status FROM orders WHERE id = 1').get() as any;
    expect(pickedOrder.status).toBe('PICKED');

    // Verify tote status is AWAITING_PACK
    const toteRow = db.prepare('SELECT status, order_ref FROM totes WHERE tote_code = ?').get(toteCode) as any;
    expect(toteRow.status).toBe('AWAITING_PACK');
    expect(toteRow.order_ref).toBe('ORD-FLOW-001');

    // 3. Staff opens pack session
    const session = openPackSession(db, {
      toteScan: toteCode,
      actor: staff1
    });

    expect(session.orderRef).toBe('ORD-FLOW-001');
    expect(session.status).toBe('OPEN');
    expect(session.lines.length).toBe(1);
    expect(session.lines[0].expectedQty).toBe(2);
    expect(session.lines[0].scannedQty).toBe(0);

    // Verify order transitioned to PACKING
    const orderPacking = db.prepare('SELECT status FROM orders WHERE ref = ?').get('ORD-FLOW-001') as any;
    expect(orderPacking.status).toBe('PACKING');

    // 4. Staff scans 2 items
    const s1 = scanPackItem(db, session.sessionId, { scan: 'SKU-001', actor: staff1 });
    expect(s1.lines[0].scannedQty).toBe(1);

    const s2 = scanPackItem(db, session.sessionId, { scan: 'SKU-001', actor: staff1 });
    expect(s2.lines[0].scannedQty).toBe(2);

    // Verify stock moved from TOTE to BENCH
    const benchBal = db.prepare('SELECT qty FROM location_balances WHERE location_key = ? AND sku = ?').get('BENCH:BENCH-1', 'SKU-001') as any;
    expect(benchBal.qty).toBe(2);

    // 5. Scale check
    // Expected = 2 * product.weight_g (250g) + bagTare (40g) = 540g
    const weighRes = weighPackSession(db, session.sessionId, { grams: 540, actor: staff1 });
    expect(weighRes.weightOk).toBe(true);
    expect(weighRes.canComplete).toBe(true);

    // 6. Complete pack into dispatch slot D-1
    const completeRes = completePackSession(db, session.sessionId, {
      slotScan: 'D-1',
      actor: staff1
    });

    expect(completeRes.ok).toBe(true);
    expect(completeRes.slotCode).toBe('D-1');
    expect(completeRes.fulfilmentType).toBe('FULL');

    // Verify tote is freed
    const toteFreed = db.prepare('SELECT status, order_ref, mission_ref FROM totes WHERE tote_code = ?').get(toteCode) as any;
    expect(toteFreed.status).toBe('FREE');
    expect(toteFreed.order_ref).toBeNull();

    // Verify slot is OCCUPIED
    const slotOcc = db.prepare('SELECT status, order_ref FROM dispatch_slots WHERE slot_code = ?').get('D-1') as any;
    expect(slotOcc.status).toBe('OCCUPIED');
    expect(slotOcc.order_ref).toBe('ORD-FLOW-001');

    // Verify order status is PACKED
    const orderPacked = db.prepare('SELECT status, packed_at FROM orders WHERE ref = ?').get('ORD-FLOW-001') as any;
    expect(orderPacked.status).toBe('PACKED');
    expect(orderPacked.packed_at).not.toBeNull();

    // 7. Check dispatch queue
    const queue = getDispatchQueue(db);
    expect(queue.length).toBeGreaterThanOrEqual(1);
    const queuedOrder = queue.find(q => q.orderRef === 'ORD-FLOW-001');
    expect(queuedOrder).toBeDefined();
    expect(queuedOrder?.slotCode).toBe('D-1');
    expect(queuedOrder?.locked).toBe(false);

    // 8. Rider Handover
    const demoOtp = getDemoOtp('ORD-FLOW-001');
    expect(demoOtp.otp).toMatch(/^\d{4}$/);

    const handoverRes = handoverDispatchOrder(db, 'ORD-FLOW-001', {
      slotScan: 'D-1',
      otp: demoOtp.otp,
      riderName: 'Zepto Rider Ravi',
      actor: staff1
    });

    expect(handoverRes.ok).toBe(true);

    // Verify slot D-1 is freed
    const slotFreed = db.prepare('SELECT status, order_ref FROM dispatch_slots WHERE slot_code = ?').get('D-1') as any;
    expect(slotFreed.status).toBe('FREE');
    expect(slotFreed.order_ref).toBeNull();

    // Verify order is DISPATCHED
    const orderDispatched = db.prepare('SELECT status, dispatched_at FROM orders WHERE ref = ?').get('ORD-FLOW-001') as any;
    expect(orderDispatched.status).toBe('DISPATCHED');
    expect(orderDispatched.dispatched_at).not.toBeNull();

    // Verify stock is in SHIPPED
    const shippedBal = db.prepare('SELECT qty FROM location_balances WHERE location_key = ? AND sku = ?').get('SHIPPED', 'SKU-001') as any;
    expect(shippedBal.qty).toBe(2);

    // Verify zero-sum ledger integrity
    const rec = reconcileLedger(db);
    expect(rec.ok).toBe(true);
    expect(rec.zeroSumOk).toBe(true);
  });

  it('Negative test: cannot open pack session if order is not PICKED (409)', () => {
    // Tote not ready
    expect(() => {
      openPackSession(db, { toteScan: 'TOTE-001', actor: staff1 });
    }).toThrow(/ORDER_NOT_PICKED/);
  });

  it('Negative test: SoD violation when order creator attempts to pack (403)', () => {
    // Set requested_by to staff1.id (7)
    db.prepare('UPDATE orders SET requested_by = 7, status = \'PICKED\' WHERE ref = ?').run('ORD-FLOW-001');
    db.prepare('UPDATE totes SET status = \'AWAITING_PACK\', order_ref = ? WHERE tote_code = ?').run('ORD-FLOW-001', 'TOTE-001');

    expect(() => {
      openPackSession(db, { toteScan: 'TOTE-001', actor: staff1 });
    }).toThrow(/SOD_VIOLATION/);
  });

  it('Negative test: scanning item not in order fails with 422 PACK_ITEM_NOT_IN_ORDER', () => {
    db.prepare('UPDATE orders SET status = \'PICKED\' WHERE ref = ?').run('ORD-FLOW-001');
    db.prepare('UPDATE totes SET status = \'AWAITING_PACK\', order_ref = ? WHERE tote_code = ?').run('ORD-FLOW-001', 'TOTE-001');

    const session = openPackSession(db, { toteScan: 'TOTE-001', actor: staff1 });

    expect(() => {
      scanPackItem(db, session.sessionId, { scan: 'SKU-WRONG-999', actor: staff1 });
    }).toThrow(/PACK_ITEM_NOT_IN_ORDER/);
  });

  it('Negative test: overscan beyond required quantity fails with 422 PACK_ITEM_OVERSCAN', () => {
    db.prepare('UPDATE orders SET status = \'PICKED\' WHERE ref = ?').run('ORD-FLOW-001');
    db.prepare('UPDATE totes SET status = \'AWAITING_PACK\', order_ref = ? WHERE tote_code = ?').run('ORD-FLOW-001', 'TOTE-001');

    // Put stock in TOTE
    runInTx(db, () => {
      postLedger(
        db,
        [{ sku: 'SKU-001', lotId: 'LOT-TEST-001', qty: 5, from: 'EXT', to: 'TOTE:TOTE-001', type: 'PICK' }],
        { id: 'SYSTEM' }
      );
    });

    const session = openPackSession(db, { toteScan: 'TOTE-001', actor: staff1 });

    scanPackItem(db, session.sessionId, { scan: 'SKU-001', actor: staff1 });
    scanPackItem(db, session.sessionId, { scan: 'SKU-001', actor: staff1 });

    // 3rd scan on a 2-qty line must throw
    expect(() => {
      scanPackItem(db, session.sessionId, { scan: 'SKU-001', actor: staff1 });
    }).toThrow(/PACK_ITEM_OVERSCAN/);
  });

  it('Negative test: scale weight outside tolerance throws 422 WEIGHT_MISMATCH', () => {
    db.prepare('UPDATE orders SET status = \'PICKED\' WHERE ref = ?').run('ORD-FLOW-001');
    db.prepare('UPDATE totes SET status = \'AWAITING_PACK\', order_ref = ? WHERE tote_code = ?').run('ORD-FLOW-001', 'TOTE-001');

    runInTx(db, () => {
      postLedger(
        db,
        [{ sku: 'SKU-001', lotId: 'LOT-TEST-001', qty: 2, from: 'EXT', to: 'TOTE:TOTE-001', type: 'PICK' }],
        { id: 'SYSTEM' }
      );
    });

    const session = openPackSession(db, { toteScan: 'TOTE-001', actor: staff1 });
    scanPackItem(db, session.sessionId, { scan: 'SKU-001', actor: staff1 });
    scanPackItem(db, session.sessionId, { scan: 'SKU-001', actor: staff1 });

    // Expected is 540g, test with 900g
    expect(() => {
      weighPackSession(db, session.sessionId, { grams: 900, actor: staff1 });
    }).toThrow(/WEIGHT_MISMATCH/);
  });

  it('Negative test: 3 wrong OTP attempts locks handover (409 OTP_LOCKED); Manager regen unlocks', () => {
    // Setup packed order staged in D-1
    db.prepare('UPDATE orders SET status = \'PACKED\' WHERE ref = ?').run('ORD-FLOW-001');
    db.prepare('UPDATE dispatch_slots SET status = \'OCCUPIED\', order_ref = ? WHERE slot_code = ?').run('ORD-FLOW-001', 'D-1');

    // Create handover with known OTP
    const correctOtp = '8888';
    const otpHash = require('crypto').createHash('sha256').update(correctOtp + ':ORD-FLOW-001').digest('hex');
    db.prepare(`
      INSERT INTO dispatch_handovers (order_ref, slot_code, otp_hash, otp_expires_at, attempts, locked)
      VALUES ('ORD-FLOW-001', 'D-1', ?, datetime('now', '+1 hour'), 0, 0)
    `).run(otpHash);

    // Attempt 1: wrong OTP
    expect(() => {
      handoverDispatchOrder(db, 'ORD-FLOW-001', { slotScan: 'D-1', otp: '1111', actor: staff1 });
    }).toThrow(/OTP_INVALID/);

    // Attempt 2: wrong OTP
    expect(() => {
      handoverDispatchOrder(db, 'ORD-FLOW-001', { slotScan: 'D-1', otp: '2222', actor: staff1 });
    }).toThrow(/OTP_INVALID/);

    // Attempt 3: wrong OTP -> locks
    expect(() => {
      handoverDispatchOrder(db, 'ORD-FLOW-001', { slotScan: 'D-1', otp: '3333', actor: staff1 });
    }).toThrow(/OTP_LOCKED/);

    // Attempt 4: even with correct OTP, it's locked
    expect(() => {
      handoverDispatchOrder(db, 'ORD-FLOW-001', { slotScan: 'D-1', otp: correctOtp, actor: staff1 });
    }).toThrow(/OTP_LOCKED/);

    // Manager regenerates OTP
    const regen = regenDispatchOtp(db, 'ORD-FLOW-001', {
      reasonCode: 'CUSTOMER_PHONE_UPDATE',
      note: 'Verified with rider dispatch',
      actor: manager1
    });

    const demoOtp = getDemoOtp('ORD-FLOW-001');
    expect(demoOtp.otp).toMatch(/^\d{4}$/);

    // Put stock in DISP:D-1 so handover succeeds
    runInTx(db, () => {
      postLedger(
        db,
        [{ sku: 'SKU-001', lotId: 'LOT-TEST-001', qty: 2, from: 'EXT', to: 'DISP:D-1', type: 'STAGE_DISPATCH' }],
        { id: 'SYSTEM' }
      );
    });

    // Valid OTP succeeds!
    const handoverSuccess = handoverDispatchOrder(db, 'ORD-FLOW-001', {
      slotScan: 'D-1',
      otp: demoOtp.otp,
      riderName: 'Express Rider',
      actor: staff1
    });

    expect(handoverSuccess.ok).toBe(true);
    expect(handoverSuccess.slotCode).toBe('D-1');

    const finalOrder = db.prepare('SELECT status FROM orders WHERE ref = ?').get('ORD-FLOW-001') as any;
    expect(finalOrder.status).toBe('DISPATCHED');
  });

  it('Damaged item flagging moves stock to QUAR and auto-creates high-priority REPICK task', () => {
    db.prepare('UPDATE orders SET status = \'PICKED\' WHERE ref = ?').run('ORD-FLOW-001');
    db.prepare('UPDATE totes SET status = \'AWAITING_PACK\', order_ref = ? WHERE tote_code = ?').run('ORD-FLOW-001', 'TOTE-001');

    runInTx(db, () => {
      postLedger(
        db,
        [{ sku: 'SKU-001', lotId: 'LOT-TEST-001', qty: 2, from: 'EXT', to: 'TOTE:TOTE-001', type: 'PICK' }],
        { id: 'SYSTEM' }
      );
    });

    const session = openPackSession(db, { toteScan: 'TOTE-001', actor: staff1 });

    // Flag 1 unit damaged
    const flagged = flagPackItem(db, session.sessionId, {
      sku: 'SKU-001',
      qty: 1,
      kind: 'DAMAGED',
      note: 'Punctured bottle',
      actor: staff1
    });

    expect(flagged.lines[0].flaggedQty).toBe(1);

    // Verify stock moved to QUAR
    const quarBal = db.prepare('SELECT qty FROM location_balances WHERE location_key = ? AND sku = ?').get('QUAR', 'SKU-001') as any;
    expect(quarBal.qty).toBe(1);

    // Verify REPICK floor task auto-created with priority 100
    const repickTask = db.prepare('SELECT * FROM floor_tasks WHERE type = \'REPICK\' AND order_ref = ?').get('ORD-FLOW-001') as any;
    expect(repickTask).toBeDefined();
    expect(repickTask.priority).toBe(100);
    expect(repickTask.sku).toBe('SKU-001');
    expect(repickTask.qty).toBe(1);
    expect(repickTask.status).toBe('OPEN');
  });
});
