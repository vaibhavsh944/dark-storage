import { describe, it, expect } from 'vitest';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import {
  toPickerMissionDTO,
  toPackSessionDTO,
  toCountTaskDTO,
  FORBIDDEN_FLOOR_KEYS
} from '../../services/engine3-inventory/src/dto/floorDtos.js';

function collectKeys(obj: any): string[] {
  const keys: string[] = [];
  function recurse(current: any) {
    if (!current || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      for (const item of current) {
        recurse(item);
      }
      return;
    }
    for (const [k, v] of Object.entries(current)) {
      keys.push(k);
      recurse(v);
    }
  }
  recurse(obj);
  return keys;
}

describe('Blind Floor DTO Mappers', () => {
  it('toPickerMissionDTO strips all forbidden inventory and financial fields', () => {
    const db = makeTestDb();
    seedMinimal(db);

    // Setup an order, mission, and pick stops
    db.prepare(`
      INSERT INTO orders (id, ref, order_type, priority, status, requested_by)
      VALUES (1, 'ORD-TEST-1', 'CUSTOMER', 'NORMAL', 'ASSIGNED', 1)
    `).run();

    db.prepare(`
      INSERT INTO missions (
        id, ref, order_id, picker_id, status, route_json, route_distance, route_algorithm,
        assigned_by, tote_code, priority, sla_due_at, version
      ) VALUES (
        1, 'MSN-TEST-1', 1, 1, 'ASSIGNED', '[]', 10.5, 'TRIVIAL',
        1, 'TOTE-001', 100, '2026-11-13T12:00:00Z', 1
      )
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
      INSERT INTO pick_stops (
        id, mission_id, stop_no, stop_ref, seq, reservation_id, bin_code, sku,
        qty_required, qty_picked, status, step
      ) VALUES (
        1, 1, 1, 'MSN-TEST-1-S1', 1, 1, 'A-01-01', 'SKU-001',
        2, 0, 'PENDING', 'PENDING'
      )
    `).run();

    // Mission row with tainted forbidden keys injected
    const dirtyMissionRow = {
      id: 1,
      ref: 'MSN-TEST-1',
      order_id: 1,
      order_ref: 'ORD-TEST-1',
      status: 'ASSIGNED',
      tote_code: 'TOTE-001',
      lease_expires_at: '2026-11-13T12:30:00Z',
      // Forbidden fields that should NEVER leak:
      current_qty: 999,
      currentQty: 999,
      reserved_qty: 50,
      reservedQty: 50,
      available_to_promise: 949,
      atp_pickable: 949,
      customer: 'Secret VIP Customer',
      shipping_address: '123 Classified Way',
      price_paise: 99900
    };

    const dto = toPickerMissionDTO(db, dirtyMissionRow);
    const jsonString = JSON.stringify(dto);
    const parsed = JSON.parse(jsonString);
    const allKeys = collectKeys(parsed);

    for (const forbidden of FORBIDDEN_FLOOR_KEYS) {
      expect(allKeys).not.toContain(forbidden);
      expect(jsonString).not.toContain(`"${forbidden}"`);
    }

    expect(dto.missionRef).toBe('MSN-TEST-1');
    expect(dto.orderRef).toBe('ORD-TEST-1');
    expect(dto.totalStops).toBe(1);
    expect(dto.stops[0].qtyToPick).toBe(2);
    expect(dto.stops[0].qtyPicked).toBe(0);
    expect(dto.stops[0].binCode).toBe('A-01-01');
  });

  it('toPackSessionDTO strips forbidden keys', () => {
    const dirtySessionRow = {
      id: 10,
      order_ref: 'ORD-TEST-1',
      tote_code: 'TOTE-001',
      benchCode: 'BENCH-1',
      status: 'OPEN',
      expected_weight_g: 500,
      actual_weight_g: 502,
      weight_ok: 1,
      can_complete: 1,
      lines: [
        {
          sku: 'SKU-001',
          barcode: 'SKU-001-BAR',
          productName: 'Product 1',
          expectedQty: 2,
          scannedQty: 2,
          flaggedQty: 0,
          current_qty: 100,
          system_qty: 100,
          price_paise: 5000
        }
      ],
      customer: 'VIP',
      shipping_address: 'Secret'
    };

    const dto = toPackSessionDTO(null, dirtySessionRow);
    const jsonString = JSON.stringify(dto);
    const allKeys = collectKeys(JSON.parse(jsonString));

    for (const forbidden of FORBIDDEN_FLOOR_KEYS) {
      expect(allKeys).not.toContain(forbidden);
      expect(jsonString).not.toContain(`"${forbidden}"`);
    }

    expect(dto.sessionId).toBe(10);
    expect(dto.weightOk).toBe(true);
    expect(dto.lines[0].expectedQty).toBe(2);
  });

  it('toCountTaskDTO strips system_qty, variance, and current_qty', () => {
    const dirtyCountRow = {
      id: 42,
      task_ref: 'TSK-CNT-001',
      type: 'COUNT',
      bin_code: 'B-02-01',
      sku: 'SKU-002',
      due_at: '2026-11-13T14:00:00Z',
      payload: JSON.stringify({ round: 2 }),
      // Forbidden fields:
      system_qty: 15,
      systemQty: 15,
      variance: -2,
      current_qty: 15,
      reserved_qty: 0
    };

    const dto = toCountTaskDTO(dirtyCountRow);
    const jsonString = JSON.stringify(dto);
    const allKeys = collectKeys(JSON.parse(jsonString));

    for (const forbidden of FORBIDDEN_FLOOR_KEYS) {
      expect(allKeys).not.toContain(forbidden);
      expect(jsonString).not.toContain(`"${forbidden}"`);
    }

    expect(dto.taskRef).toBe('TSK-CNT-001');
    expect(dto.type).toBe('COUNT');
    expect(dto.binCode).toBe('B-02-01');
    expect(dto.sku).toBe('SKU-002');
    expect(dto.round).toBe(2);
  });
});
