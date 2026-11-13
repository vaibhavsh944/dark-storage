import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import { runLeaseSweep } from '../../services/engine3-inventory/src/jobs/leaseSweep.js';

describe('Lease Sweep Integration Test', () => {
  it('expires missions and floor tasks past lease_expires_at, returning missions to CREATED while preserving tote and DONE stops', () => {
    const db = makeTestDb();
    seedMinimal(db);

    const pastIso = new Date(Date.now() - 60000).toISOString();
    const futureIso = new Date(Date.now() + 60000).toISOString();

    // 1. Order and Mission 1 (Expired, with tote and 1 DONE stop out of 2)
    db.prepare(`
      INSERT INTO orders (id, ref, order_type, priority, status, requested_by)
      VALUES (1, 'ORD-LEASE-1', 'CUSTOMER', 'NORMAL', 'PICKING', 1)
    `).run();

    db.prepare(`
      INSERT INTO order_lines (id, order_id, line_no, sku, qty_ordered)
      VALUES (1, 1, 1, 'SKU-001', 2), (2, 1, 2, 'SKU-002', 1)
    `).run();

    db.prepare(`
      INSERT INTO reservations (id, order_id, order_line_id, sku, bin_code, qty, consumed_qty, status)
      VALUES (1, 1, 1, 'SKU-001', 'A-01-01', 2, 2, 'CONSUMED'), (2, 1, 2, 'SKU-002', 'A-01-02', 1, 0, 'HELD')
    `).run();

    db.prepare(`
      INSERT INTO missions (
        id, ref, order_id, picker_id, status, route_json, route_distance, route_algorithm,
        tote_code, lease_expires_at, version
      ) VALUES (
        1, 'MSN-LEASE-1', 1, 5, 'IN_PROGRESS', '[]', 10.0, 'TRIVIAL',
        'TOTE-005', ?, 1
      )
    `).run(pastIso);

    // Stop 1 is DONE
    db.prepare(`
      INSERT INTO pick_stops (
        id, mission_id, stop_no, stop_ref, seq, reservation_id, bin_code, sku,
        qty_required, qty_picked, status, step
      ) VALUES (
        1, 1, 1, 'MSN-LEASE-1-S1', 1, 1, 'A-01-01', 'SKU-001',
        2, 2, 'CONFIRMED', 'DONE'
      )
    `).run();

    // Stop 2 is PENDING
    db.prepare(`
      INSERT INTO pick_stops (
        id, mission_id, stop_no, stop_ref, seq, reservation_id, bin_code, sku,
        qty_required, qty_picked, status, step
      ) VALUES (
        2, 1, 2, 'MSN-LEASE-1-S2', 2, 2, 'A-01-02', 'SKU-002',
        1, 0, 'PENDING', 'PENDING'
      )
    `).run();

    // 2. Order and Mission 2 (Active, lease in future -> should NOT expire)
    db.prepare(`
      INSERT INTO orders (id, ref, order_type, priority, status, requested_by)
      VALUES (2, 'ORD-LEASE-2', 'CUSTOMER', 'NORMAL', 'ASSIGNED', 1)
    `).run();

    db.prepare(`
      INSERT INTO missions (
        id, ref, order_id, picker_id, status, route_json, route_distance, route_algorithm,
        tote_code, lease_expires_at, version
      ) VALUES (
        2, 'MSN-LEASE-2', 2, 6, 'ASSIGNED', '[]', 8.0, 'TRIVIAL',
        'TOTE-006', ?, 1
      )
    `).run(futureIso);

    // 3. Expired floor task
    db.prepare(`
      INSERT INTO floor_tasks (task_ref, type, status, assigned_to, lease_expires_at, version)
      VALUES ('FT-EXP-1', 'COUNT', 'CLAIMED', '3', ?, 1)
    `).run(pastIso);

    // Run sweep
    const sweepRes = runLeaseSweep(db);
    expect(sweepRes.expiredMissions).toBe(1);
    expect(sweepRes.expiredFloorTasks).toBe(1);

    // Assert Mission 1 reverted to CREATED
    const m1 = db.prepare('SELECT status, picker_id, lease_expires_at, tote_code, version FROM missions WHERE id = 1').get() as any;
    expect(m1.status).toBe('CREATED');
    expect(m1.picker_id).toBeNull();
    expect(m1.lease_expires_at).toBeNull();
    expect(m1.tote_code).toBe('TOTE-005'); // Preserved!
    expect(m1.version).toBe(2);

    // Stops are preserved
    const s1 = db.prepare('SELECT step, status FROM pick_stops WHERE id = 1').get() as any;
    expect(s1.step).toBe('DONE');
    expect(s1.status).toBe('CONFIRMED');

    // Order 1 has partial progress, so status remains PICKING
    const o1 = db.prepare('SELECT status FROM orders WHERE id = 1').get() as any;
    expect(o1.status).toBe('PICKING');

    // Assert Mission 2 was untouched
    const m2 = db.prepare('SELECT status, picker_id FROM missions WHERE id = 2').get() as any;
    expect(m2.status).toBe('ASSIGNED');
    expect(m2.picker_id).toBe(6);

    // Assert Floor Task 1 was reverted to OPEN
    const ft1 = db.prepare('SELECT status, assigned_to, lease_expires_at, version FROM floor_tasks WHERE task_ref = ?').get('FT-EXP-1') as any;
    expect(ft1.status).toBe('OPEN');
    expect(ft1.assigned_to).toBeNull();
    expect(ft1.lease_expires_at).toBeNull();
    expect(ft1.version).toBe(2);

    // Assert lease expiration event was recorded
    const event = db.prepare("SELECT * FROM order_events WHERE event = 'mission.lease_expired'").get() as any;
    expect(event).toBeTruthy();
    expect(event.order_ref).toBe('ORD-LEASE-1');
  });
});
