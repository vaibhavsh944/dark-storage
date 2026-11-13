import Database from 'better-sqlite3';
import {
  DomainError,
  OrderDto,
  OrderLineDto,
  ReservationDto,
  OrderQueryInput,
  OrderType,
  Priority
} from '@dark-storage/shared';
import { nextRef } from './ids.js';
import { reserve, release } from './inventoryRepo.js';
import { audit, appendOrderEvent } from './audit.js';
import { emit } from './outbox.js';

export function closeReservationIfDone(db: Database.Database, reservationId: number): void {
  const row = db.prepare('SELECT qty, consumed_qty, released_qty FROM reservations WHERE id = ?').get(reservationId) as {
    qty: number;
    consumed_qty: number;
    released_qty: number;
  } | undefined;

  if (!row) return;

  const outstanding = row.qty - row.consumed_qty - row.released_qty;
  const now = new Date().toISOString();

  if (outstanding <= 0) {
    const nextStatus = row.consumed_qty > 0 ? 'CONSUMED' : 'RELEASED';
    db.prepare('UPDATE reservations SET status = ?, updated_at = ? WHERE id = ?').run(nextStatus, now, reservationId);
  } else {
    db.prepare("UPDATE reservations SET status = 'HELD', updated_at = ? WHERE id = ?").run(now, reservationId);
  }
}

export function allocateStock(
  db: Database.Database,
  sku: string,
  qty: number,
  options: { excludeBins?: string[] } = {}
): Array<{ bin: string; qty: number }> | null {
  const exclude = options.excludeBins || [];
  let query = 'SELECT bin_code, available_qty FROM v_available_stock WHERE sku = ? COLLATE NOCASE';
  const params: any[] = [sku];

  if (exclude.length > 0) {
    query += ` AND bin_code NOT IN (${exclude.map(() => '?').join(',')})`;
    params.push(...exclude);
  }

  const rows = db.prepare(query).all(...params) as Array<{ bin_code: string; available_qty: number }>;

  const totalAvailable = rows.reduce((acc, r) => acc + r.available_qty, 0);
  if (totalAvailable < qty) {
    return null;
  }

  // Best-fit: single bin that satisfies alone, smallest available_qty first, tie-break bin_code ASC
  const single = rows
    .filter((r) => r.available_qty >= qty)
    .sort((a, b) => a.available_qty - b.available_qty || a.bin_code.localeCompare(b.bin_code));

  if (single.length > 0) {
    return [{ bin: single[0].bin_code, qty }];
  }

  // Greedy: largest available_qty first, tie-break bin_code ASC
  const sorted = rows.sort((a, b) => b.available_qty - a.available_qty || a.bin_code.localeCompare(b.bin_code));
  const plan: Array<{ bin: string; qty: number }> = [];
  let remaining = qty;

  for (const r of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, r.available_qty);
    plan.push({ bin: r.bin_code, qty: take });
    remaining -= take;
  }

  if (remaining === 0) {
    return plan;
  }

  return null;
}

export function executeReserveOrder(
  db: Database.Database,
  params: {
    order_type?: OrderType;
    priority?: Priority;
    customer_ref?: string | null;
    notes?: string | null;
    lines: Array<{ sku: string; qty: number }>;
    actor: { id: number; name?: string; display_name?: string; role: string };
  },
  hooks?: { afterStep?: (stepName: string) => void }
): OrderDto {
  if (!params.lines || params.lines.length === 0) {
    throw new DomainError('VALIDATION_ERROR', 'At least one line is required');
  }
  if (params.lines.length > 50) {
    throw new DomainError('VALIDATION_ERROR', 'At most 50 lines allowed');
  }

  // Validate duplicate SKUs
  const seenSkus = new Set<string>();
  for (const line of params.lines) {
    const norm = line.sku.toUpperCase();
    if (seenSkus.has(norm)) {
      throw new DomainError('DUPLICATE_LINE_SKU', `Duplicate SKU found in lines: ${line.sku}`, { sku: line.sku });
    }
    seenSkus.add(norm);

    if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > 10000) {
      throw new DomainError('QUANTITY_INVALID', `Quantity must be an integer between 1 and 10000 for SKU ${line.sku}`, {
        sku: line.sku,
        qty: line.qty
      });
    }

    const prod = db.prepare('SELECT sku, name, active FROM products WHERE sku = ? COLLATE NOCASE').get(line.sku) as
      | { sku: string; name: string; active: number }
      | undefined;
    if (!prod || prod.active !== 1) {
      throw new DomainError('UNKNOWN_SKU', `SKU ${line.sku} not found or inactive`, { sku: line.sku });
    }
  }

  // Pre-check ATP for all lines BEFORE nextRef so no order ref is consumed on shortage
  const shortages: Array<{ sku: string; product_name: string; requested: number; available: number }> = [];
  for (const line of params.lines) {
    const atpRow = db
      .prepare('SELECT COALESCE(SUM(available_qty), 0) AS atp FROM v_available_stock WHERE sku = ? COLLATE NOCASE')
      .get(line.sku) as { atp: number };
    const atp = atpRow.atp;
    if (atp < line.qty) {
      const prod = db.prepare('SELECT name FROM products WHERE sku = ? COLLATE NOCASE').get(line.sku) as { name: string };
      shortages.push({
        sku: line.sku,
        product_name: prod ? prod.name : line.sku,
        requested: line.qty,
        available: atp
      });
    }
  }

  if (shortages.length > 0) {
    throw new DomainError('INSUFFICIENT_STOCK', 'Not enough available stock to reserve order', { shortages });
  }

  // Generate sequence number and insert order
  const orderRef = nextRef(db, 'order');
  const nowIso = new Date().toISOString();
  const orderType = params.order_type || 'CUSTOMER';
  const priority = params.priority || 'NORMAL';

  const orderResult = db
    .prepare(
      `
    INSERT INTO orders (ref, order_type, priority, status, customer_ref, notes, requested_by, created_at, updated_at)
    VALUES (?, ?, ?, 'RESERVED', ?, ?, ?, ?, ?)
  `
    )
    .run(
      orderRef,
      orderType,
      priority,
      params.customer_ref || null,
      params.notes || null,
      params.actor.id,
      nowIso,
      nowIso
    );
  const orderId = Number(orderResult.lastInsertRowid);

  // Sort lines by sku ASC deterministically
  const sortedLines = [...params.lines].sort((a, b) => a.sku.localeCompare(b.sku));
  const affectedBins = new Set<string>();
  const allocations: Array<{ sku: string; allocations: Array<{ bin: string; qty: number }> }> = [];

  let lineNo = 1;
  for (const line of sortedLines) {
    const lineResult = db
      .prepare(
        `
      INSERT INTO order_lines (order_id, line_no, sku, qty_ordered, qty_picked, qty_short)
      VALUES (?, ?, ?, ?, 0, 0)
    `
      )
      .run(orderId, lineNo++, line.sku, line.qty);
    const lineId = Number(lineResult.lastInsertRowid);

    const plan = allocateStock(db, line.sku, line.qty);
    if (!plan) {
      throw new DomainError('INSUFFICIENT_STOCK', `Could not allocate stock for ${line.sku}`, {
        shortages: [{ sku: line.sku, requested: line.qty, available: 0 }]
      });
    }

    allocations.push({ sku: line.sku, allocations: plan });

    for (const alloc of plan) {
      reserve(db, { bin: alloc.bin, qty: alloc.qty });
      affectedBins.add(alloc.bin);

      db.prepare(
        `
        INSERT INTO reservations (order_id, order_line_id, sku, bin_code, qty, consumed_qty, released_qty, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, 0, 'HELD', ?, ?)
      `
      ).run(orderId, lineId, line.sku, alloc.bin, alloc.qty, nowIso, nowIso);
    }

    hooks?.afterStep?.('line:' + line.sku);
  }

  // Audit and Events
  audit(db, {
    actor: { id: params.actor.id, role: params.actor.role },
    action: 'ORDER_CREATED',
    entity_type: 'ORDER',
    entity_id: orderRef,
    details: {
      lines: sortedLines,
      allocations
    }
  });

  appendOrderEvent(db, {
    orderRef,
    event: 'order.created',
    actorId: params.actor.id,
    actorRole: params.actor.role,
    payload: {
      lines: sortedLines,
      allocations
    }
  });

  emit(db, {
    event_type: 'order.created',
    entity_type: 'ORDER',
    entity_id: orderRef,
    data: { ref: orderRef }
  });

  emit(db, {
    event_type: 'inventory.changed',
    entity_type: 'BIN',
    entity_id: 'multiple',
    data: { bins: Array.from(affectedBins) }
  });

  emit(db, {
    event_type: 'reservation.changed',
    entity_type: 'ORDER',
    entity_id: orderRef,
    data: { order_ref: orderRef }
  });

  return getOrder(db, orderRef)!;
}

export function cancelOrder(
  db: Database.Database,
  ref: string,
  reason: string,
  actor: { id: number; name?: string; role: string }
): OrderDto {
  const order = db.prepare('SELECT * FROM orders WHERE ref = ?').get(ref) as any;
  if (!order) {
    throw new DomainError('NOT_FOUND', `Order ${ref} not found`);
  }

  // Allowed statuses: RESERVED, ASSIGNED, PICKING, and PICKED only when total picked units == 0
  const totalPickedRow = db
    .prepare('SELECT COALESCE(SUM(qty_picked), 0) AS total_picked FROM order_lines WHERE order_id = ?')
    .get(order.id) as { total_picked: number };
  const totalPicked = totalPickedRow?.total_picked ?? 0;

  const allowedStatuses = ['RESERVED', 'ASSIGNED', 'PICKING'];
  const canCancelPicked = order.status === 'PICKED' && totalPicked === 0;

  if (!allowedStatuses.includes(order.status) && !canCancelPicked) {
    throw new DomainError('ORDER_NOT_CANCELLABLE', `Order cannot be cancelled in status ${order.status}`, {
      status: order.status,
      total_picked: totalPicked
    });
  }

  const nowIso = new Date().toISOString();

  // Release all outstanding HELD reservations
  const resRows = db.prepare("SELECT * FROM reservations WHERE order_id = ? AND status = 'HELD'").all(order.id) as any[];
  const releasedBins = new Set<string>();
  const releasedList: Array<{ bin: string; qty: number }> = [];

  for (const r of resRows) {
    const outstanding = r.qty - r.consumed_qty - r.released_qty;
    if (outstanding > 0) {
      release(db, { bin: r.bin_code, qty: outstanding });
      const nextStatus = r.consumed_qty > 0 ? 'CONSUMED' : 'RELEASED';
      db.prepare('UPDATE reservations SET released_qty = released_qty + ?, status = ?, updated_at = ? WHERE id = ?').run(
        outstanding,
        nextStatus,
        nowIso,
        r.id
      );
      releasedBins.add(r.bin_code);
      releasedList.push({ bin: r.bin_code, qty: outstanding });
    }
  }

  // Cancel active mission if missions table exists
  const hasMissionsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'missions'")
    .get();
  if (hasMissionsTable) {
    db.prepare("UPDATE missions SET status = 'CANCELLED' WHERE order_id = ? AND status IN ('ASSIGNED', 'IN_PROGRESS')").run(
      order.id
    );
  }

  // Close open exceptions if pick_exceptions table exists
  const hasExceptionsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pick_exceptions'")
    .get();
  if (hasExceptionsTable) {
    db.prepare(
      "UPDATE pick_exceptions SET status = 'RESOLVED', resolution = 'ORDER_CANCELLED', resolved_by = ?, resolved_at = ? WHERE order_id = ? AND status = 'OPEN'"
    ).run(actor.id, nowIso, order.id);

    // Also close stops
    const hasStopsTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pick_stops'")
      .get();
    if (hasStopsTable) {
      db.prepare(
        "UPDATE pick_stops SET status = 'RESOLVED' WHERE mission_id IN (SELECT id FROM missions WHERE order_id = ?) AND status = 'EXCEPTION_OPEN'"
      ).run(order.id);
    }
  }

  // Unreturned picked items
  const unreturnedRows = db
    .prepare(
      `
    SELECT sku, SUM(qty_picked) AS picked
    FROM order_lines
    WHERE order_id = ?
    GROUP BY sku
    HAVING SUM(qty_picked) > 0
  `
    )
    .all(order.id) as Array<{ sku: string; picked: number }>;
  const unreturnedList = unreturnedRows.map((u) => ({ sku: u.sku, qty: u.picked }));

  // Update order status
  db.prepare(
    `
    UPDATE orders
    SET status = 'CANCELLED', cancelled_reason = ?, updated_at = ?
    WHERE id = ?
  `
  ).run(reason, nowIso, order.id);

  // Audit & events
  audit(db, {
    actor: { id: actor.id, role: actor.role },
    action: 'ORDER_CANCELLED',
    entity_type: 'ORDER',
    entity_id: ref,
    details: {
      reason,
      released: releasedList,
      unreturned_picked: unreturnedList
    }
  });

  appendOrderEvent(db, {
    orderRef: ref,
    event: 'order.cancelled',
    actorId: actor.id,
    actorRole: actor.role,
    payload: {
      reason,
      released: releasedList,
      unreturned_picked: unreturnedList
    }
  });

  emit(db, {
    event_type: 'order.status_changed',
    entity_type: 'ORDER',
    entity_id: ref,
    data: { ref, status: 'CANCELLED' }
  });

  if (releasedBins.size > 0) {
    emit(db, {
      event_type: 'inventory.changed',
      entity_type: 'BIN',
      entity_id: 'multiple',
      data: { bins: Array.from(releasedBins) }
    });
  }

  emit(db, {
    event_type: 'reservation.changed',
    entity_type: 'ORDER',
    entity_id: ref,
    data: { order_ref: ref }
  });

  return getOrder(db, ref)!;
}

export function getOrder(db: Database.Database, ref: string): OrderDto | null {
  const order = db.prepare('SELECT * FROM orders WHERE ref = ?').get(ref) as any;
  if (!order) return null;

  // Requester name
  const user = db.prepare('SELECT display_name FROM users WHERE id = ?').get(order.requested_by) as { display_name: string } | undefined;
  const requestedByName = user?.display_name || `User #${order.requested_by}`;

  // Picker name
  let assignedPickerName: string | null = null;
  if (order.assigned_picker) {
    const pickerUser = db.prepare('SELECT display_name FROM users WHERE id = ?').get(order.assigned_picker) as { display_name: string } | undefined;
    assignedPickerName = pickerUser?.display_name || null;
  }

  // Mission ref
  let missionRef: string | null = null;
  const hasMissionsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'missions'")
    .get();
  if (hasMissionsTable) {
    const m = db.prepare('SELECT ref FROM missions WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(order.id) as { ref: string } | undefined;
    if (m) missionRef = m.ref;
  }

  // Lines
  const lineRows = db.prepare('SELECT * FROM order_lines WHERE order_id = ? ORDER BY line_no ASC').all(order.id) as any[];
  const lines: OrderLineDto[] = [];

  for (const lr of lineRows) {
    const prod = db.prepare('SELECT name FROM products WHERE sku = ? COLLATE NOCASE').get(lr.sku) as { name: string } | undefined;
    const resRows = db.prepare('SELECT * FROM reservations WHERE order_line_id = ? ORDER BY id ASC').all(lr.id) as any[];

    const reservations: ReservationDto[] = resRows.map((r) => ({
      id: r.id,
      bin_code: r.bin_code,
      qty: r.qty,
      consumed_qty: r.consumed_qty,
      released_qty: r.released_qty,
      outstanding: r.qty - r.consumed_qty - r.released_qty,
      status: r.status
    }));

    lines.push({
      line_no: lr.line_no,
      sku: lr.sku,
      product_name: prod?.name || lr.sku,
      qty_ordered: lr.qty_ordered,
      qty_picked: lr.qty_picked,
      qty_short: lr.qty_short,
      reservations
    });
  }

  // Reservation summary
  const summaryRow = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(CASE WHEN status = 'HELD' THEN (qty - consumed_qty - released_qty) ELSE 0 END), 0) AS held_units,
      COALESCE(SUM(consumed_qty), 0) AS consumed_units,
      COALESCE(SUM(released_qty), 0) AS released_units
    FROM reservations
    WHERE order_id = ?
  `
    )
    .get(order.id) as { held_units: number; consumed_units: number; released_units: number };

  // Audit log
  const auditRows = db
    .prepare("SELECT occurred_at, action, actor_user_id, details_json FROM audit_log WHERE entity_type = 'ORDER' AND entity_id = ? ORDER BY id ASC")
    .all(ref) as any[];

  const auditList = auditRows.map((a) => {
    const actorUser = a.actor_user_id
      ? (db.prepare('SELECT display_name FROM users WHERE id = ?').get(a.actor_user_id) as { display_name: string })
      : null;
    return {
      at: a.occurred_at,
      action: a.action,
      by: actorUser?.display_name || 'System',
      details: a.details_json ? JSON.parse(a.details_json) : undefined
    };
  });

  return {
    ref: order.ref,
    order_type: order.order_type,
    priority: order.priority,
    status: order.status,
    customer_ref: order.customer_ref,
    notes: order.notes,
    requested_by: requestedByName,
    created_at: order.created_at,
    assigned_picker: assignedPickerName,
    mission_ref: missionRef,
    fulfilment_type: order.fulfilment_type,
    cancelled_reason: order.cancelled_reason,
    lines,
    reservation_summary: {
      held_units: summaryRow.held_units,
      consumed_units: summaryRow.consumed_units,
      released_units: summaryRow.released_units
    },
    audit: auditList
  };
}

export function listOrders(
  db: Database.Database,
  query: OrderQueryInput
): { orders: OrderDto[]; items: OrderDto[]; page: number; page_size: number; total: number } {
  let whereClause = 'WHERE 1=1';
  const params: any[] = [];

  if (query.status) {
    whereClause += ' AND o.status = ?';
    params.push(query.status);
  }
  if (query.priority) {
    whereClause += ' AND o.priority = ?';
    params.push(query.priority);
  }
  if (query.search) {
    const term = `%${query.search.trim()}%`;
    whereClause += ` AND (
      o.ref LIKE ?
      OR o.customer_ref LIKE ?
      OR EXISTS (
        SELECT 1 FROM order_lines ol
        JOIN products p ON p.sku = ol.sku COLLATE NOCASE
        WHERE ol.order_id = o.id AND (ol.sku LIKE ? OR p.name LIKE ?)
      )
    )`;
    params.push(term, term, term, term);
  }

  const countRow = db.prepare(`SELECT COUNT(*) AS total FROM orders o ${whereClause}`).get(...params) as { total: number };
  const total = countRow.total;

  const page = query.page ?? 1;
  const pageSize = query.page_size ?? 25;
  const offset = (page - 1) * pageSize;
  const orderRefs = db
    .prepare(`SELECT o.ref FROM orders o ${whereClause} ORDER BY o.id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as Array<{ ref: string }>;

  const items = orderRefs.map((r) => getOrder(db, r.ref)!).filter(Boolean);

  return {
    orders: items,
    items,
    page,
    page_size: pageSize,
    total
  };
}
