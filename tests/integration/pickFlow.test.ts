import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import { postLedger, reconcileLedger, ensureLot } from '../../services/engine3-inventory/src/ledger/postLedger.js';
import { runInTx } from '../../services/engine3-inventory/src/db/tx.js';
import { claimNextMission } from '../../services/engine3-inventory/src/domain/missionsClaimRepo.js';
import { scanBin, scanItem, scanTote } from '../../services/engine3-inventory/src/domain/scanPickRepo.js';

describe('Picker 3-Step Scan & Flow Integration Tests', () => {
  let db: Database.Database;

  const picker1 = { id: 5, username: 'picker1', role: 'PICKER' };
  const picker2 = { id: 6, username: 'picker2', role: 'PICKER' };

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
      VALUES (1, 'ORD-PICK-001', 'CUSTOMER', 'NORMAL', 'RESERVED', 1)
    `).run();

    db.prepare(`
      INSERT INTO order_lines (id, order_id, line_no, sku, qty_ordered)
      VALUES (1, 1, 1, 'SKU-001', 3)
    `).run();

    db.prepare(`
      INSERT INTO reservations (id, order_id, order_line_id, sku, bin_code, qty, status)
      VALUES (1, 1, 1, 'SKU-001', 'A-01-01', 3, 'HELD')
    `).run();

    // Mission in CREATED status
    db.prepare(`
      INSERT INTO missions (
        id, ref, order_id, status, route_json, route_distance, route_algorithm,
        priority, version
      ) VALUES (
        1, 'MSN-001', 1, 'CREATED', '[]', 5.0, 'TRIVIAL',
        100, 0
      )
    `).run();

    // Pick stop in PENDING step
    db.prepare(`
      INSERT INTO pick_stops (
        id, mission_id, stop_no, stop_ref, seq, reservation_id, bin_code, sku,
        qty_required, qty_picked, status, step
      ) VALUES (
        1, 1, 1, 'MSN-001-S1', 1, 1, 'A-01-01', 'SKU-001',
        3, 0, 'PENDING', 'PENDING'
      )
    `).run();
  });

  it('runs complete 3-step picking flow to completion with correct ledger movements', () => {
    // 1. Claim mission
    const missionDto = claimNextMission(db, picker1);
    expect(missionDto.missionRef).toBe('MSN-001');
    expect(missionDto.status).toBe('ASSIGNED');
    expect(missionDto.stops.length).toBe(1);

    const missionRow = db.prepare('SELECT status, picker_id FROM missions WHERE id = 1').get() as any;
    expect(missionRow.status).toBe('ASSIGNED');
    expect(missionRow.picker_id).toBe(5);

    const orderRow = db.prepare('SELECT status FROM orders WHERE id = 1').get() as any;
    expect(orderRow.status).toBe('ASSIGNED');

    // 2. Non-owner scan is rejected
    expect(() => {
      scanBin(db, 'MSN-001-S1', 'A-01-01', picker2);
    }).toThrow(/MISSION_NOT_OWNED/);

    // 3. Wrong bin scan is rejected with audit/order rejection recorded
    expect(() => {
      scanBin(db, 'MSN-001-S1', 'BIN:A-01-02', picker1);
    }).toThrow(/SCAN_WRONG_BIN/);

    const rejections = db.prepare("SELECT * FROM order_events WHERE event = 'scan.rejected'").all();
    expect(rejections.length).toBe(1);

    // 4. Correct bin scan transitions stop to BIN_OK, mission to IN_PROGRESS, order to PICKING
    const binRes = scanBin(db, 'MSN-001-S1', 'A-01-01', picker1);
    expect(binRes.ok).toBe(true);
    expect(binRes.step).toBe('BIN_OK');

    const mAfterBin = db.prepare('SELECT status FROM missions WHERE id = 1').get() as any;
    expect(mAfterBin.status).toBe('IN_PROGRESS');
    const oAfterBin = db.prepare('SELECT status FROM orders WHERE id = 1').get() as any;
    expect(oAfterBin.status).toBe('PICKING');

    // 5. Out of order step (attempt scanTote before item)
    expect(() => {
      scanTote(db, 'MSN-001-S1', 'TOTE-001', picker1);
    }).toThrow(/SCAN_INVALID_STEP/);

    // 6. Wrong SKU scan
    expect(() => {
      scanItem(db, 'MSN-001-S1', 'SKU-002', 3, picker1);
    }).toThrow(/SCAN_WRONG_ITEM/);

    // 7. Qty exceeds required
    expect(() => {
      scanItem(db, 'MSN-001-S1', 'SKU-001', 5, picker1);
    }).toThrow(/SCAN_QTY_EXCEEDS/);

    // 8. Correct item scan
    const itemRes = scanItem(db, 'MSN-001-S1', 'SKU-001', 3, picker1);
    expect(itemRes.ok).toBe(true);
    expect(itemRes.step).toBe('ITEM_OK');

    // 9. Scan tote already in use test
    db.prepare("UPDATE totes SET status = 'IN_USE' WHERE tote_code = 'TOTE-002'").run();
    expect(() => {
      scanTote(db, 'MSN-001-S1', 'TOTE-002', picker1);
    }).toThrow(/TOTE_IN_USE/);

    // 10. Correct free tote scan (TOTE-001)
    const toteRes = scanTote(db, 'MSN-001-S1', 'TOTE-001', picker1);
    expect(toteRes.ok).toBe(true);
    expect(toteRes.step).toBe('DONE');

    // 11. Verify mission completed & order picked
    const mFinal = db.prepare('SELECT status, completed_at, tote_code FROM missions WHERE id = 1').get() as any;
    expect(mFinal.status).toBe('COMPLETED');
    expect(mFinal.completed_at).toBeTruthy();
    expect(mFinal.tote_code).toBe('TOTE-001');

    const oFinal = db.prepare('SELECT status, completed_at FROM orders WHERE id = 1').get() as any;
    expect(oFinal.status).toBe('PICKED');
    expect(oFinal.completed_at).toBeTruthy();

    const tFinal = db.prepare('SELECT status FROM totes WHERE tote_code = ?').get('TOTE-001') as any;
    expect(tFinal.status).toBe('AWAITING_PACK');

    // 12. Check ledger balance: 3 units now in TOTE:TOTE-001, 7 left in BIN:A-01-01
    const toteBal = db.prepare("SELECT qty FROM location_balances WHERE location_key = 'TOTE:TOTE-001'").get() as any;
    expect(toteBal.qty).toBe(3);

    const binBal = db.prepare("SELECT qty FROM location_balances WHERE location_key = 'BIN:A-01-01'").get() as any;
    expect(binBal.qty).toBe(7);

    // 13. Reconcile ledger
    const rec = reconcileLedger(db);
    expect(rec.ok).toBe(true);
    expect(rec.zeroSumOk).toBe(true);
    expect(rec.mismatches.length).toBe(0);
  });
});
