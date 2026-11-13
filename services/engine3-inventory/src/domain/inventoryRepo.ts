import Database from 'better-sqlite3';
import { DomainError } from '@dark-storage/shared';
import { nextRef } from './ids.js';
import { recordAudit } from './audit.js';
import { insertOutboxEvent } from './outbox.js';
import { postLedger, reserveStock, releaseStock } from '../ledger/postLedger.js';

export interface StockInArgs {
  bin: string;
  sku: string;
  qty: number;
}

export interface StockOutArgs {
  bin: string;
  qty: number;
  consumeReserved: boolean;
}

export interface ReserveArgs {
  bin: string;
  qty: number;
}

export interface ReleaseArgs {
  bin: string;
  qty: number;
}

export interface RecordMovementArgs {
  type: 'RECEIVE' | 'PUTAWAY' | 'RELOCATE' | 'PICK' | 'ADJUSTMENT';
  sku: string;
  qty: number;
  from: { kind: 'EXTERNAL' | 'STAGING' | 'BIN' | 'ADJUSTMENT'; ref?: string | null };
  to: { kind: 'STAGING' | 'BIN' | 'ORDER_PACKING' | 'ADJUSTMENT'; ref?: string | null };
  related?: { type: string; ref: string } | null;
  actorId?: number | null;
}

export interface RecountArgs {
  bin_code: string;
  counted_qty: number;
  sku?: string | null;
  reason: string;
  actorId?: number | null;
}

export function stockIn(db: Database.Database, args: StockInArgs): void {
  const { bin: binCode, sku, qty } = args;

  // 1. bin exists
  const binRow = db.prepare(`
    SELECT b.code, b.capacity, b.status as bin_status, b.recount_required,
           s.status as shelf_status, s.storage_class as shelf_storage_class
    FROM bins b
    JOIN shelves s ON s.code = b.shelf_code
    WHERE b.code = ?
  `).get(binCode) as {
    code: string;
    capacity: number;
    bin_status: string;
    recount_required: number;
    shelf_status: string;
    shelf_storage_class: string;
  } | undefined;

  if (!binRow) {
    throw new DomainError('UNKNOWN_BIN', `Bin ${binCode} not found`);
  }

  // 2. qty positive integer
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new DomainError('QUANTITY_INVALID', 'Quantity must be a positive integer');
  }

  // 3. bin status ACTIVE, shelf status ACTIVE, recount_required=0
  if (binRow.bin_status === 'BLOCKED') {
    throw new DomainError('BIN_NOT_RECEIVABLE', 'Bin is blocked', { reason: 'BIN_BLOCKED' });
  }
  if (binRow.bin_status === 'DAMAGED') {
    throw new DomainError('BIN_NOT_RECEIVABLE', 'Bin is damaged', { reason: 'BIN_DAMAGED' });
  }
  if (binRow.shelf_status === 'MAINTENANCE') {
    throw new DomainError('BIN_NOT_RECEIVABLE', 'Shelf is in maintenance', { reason: 'SHELF_MAINTENANCE' });
  }
  if (binRow.shelf_status === 'BLOCKED') {
    throw new DomainError('BIN_NOT_RECEIVABLE', 'Shelf is blocked', { reason: 'SHELF_BLOCKED' });
  }
  if (binRow.recount_required === 1) {
    throw new DomainError('BIN_NOT_RECEIVABLE', 'Bin requires recount', { reason: 'RECOUNT_REQUIRED' });
  }
  if (binRow.bin_status !== 'ACTIVE' || binRow.shelf_status !== 'ACTIVE') {
    throw new DomainError('BIN_NOT_RECEIVABLE', 'Bin or shelf is not receivable');
  }

  // 4. storage class match
  const productRow = db.prepare('SELECT sku, storage_class FROM products WHERE sku = ?').get(sku) as {
    sku: string;
    storage_class: string;
  } | undefined;

  if (!productRow) {
    throw new DomainError('UNKNOWN_SKU', `SKU ${sku} not found`);
  }

  if (productRow.storage_class !== binRow.shelf_storage_class) {
    throw new DomainError('STORAGE_CLASS_MISMATCH', 'Storage class mismatch');
  }

  // 5. bin empty or same SKU
  const invRow = db.prepare('SELECT sku, qty, reserved_qty FROM inventory WHERE bin_code = ?').get(binCode) as {
    sku: string | null;
    qty: number;
    reserved_qty: number;
  } | undefined;

  const currentQty = invRow ? invRow.qty : 0;
  const currentSku = invRow ? invRow.sku : null;

  if (currentSku && currentSku.toUpperCase() !== sku.toUpperCase() && currentQty > 0) {
    throw new DomainError('SKU_CONFLICT', 'Bin already holds a different SKU', { existing_sku: currentSku });
  }

  // 6. current + qty <= capacity
  if (currentQty + qty > binRow.capacity) {
    throw new DomainError('CAPACITY_EXCEEDED', 'Bin capacity exceeded', {
      free_capacity: Math.max(0, binRow.capacity - currentQty)
    });
  }

  // 7. Post ledger to update inventory via projection
  const lotId = `LOT-OPEN-${sku}`;
  postLedger(db, [{
    sku,
    lotId,
    qty,
    from: 'EXT',
    to: `BIN:${binCode}`,
    type: 'PUTAWAY'
  }], null);
}

export function stockOut(db: Database.Database, args: StockOutArgs): void {
  const { bin: binCode, qty, consumeReserved } = args;

  const binRow = db.prepare('SELECT code FROM bins WHERE code = ?').get(binCode);
  if (!binRow) {
    throw new DomainError('UNKNOWN_BIN', `Bin ${binCode} not found`);
  }

  if (!Number.isInteger(qty) || qty <= 0) {
    throw new DomainError('QUANTITY_INVALID', 'Quantity must be a positive integer');
  }

  const invRow = db.prepare('SELECT sku, qty, reserved_qty, lot_id FROM inventory WHERE bin_code = ?').get(binCode) as {
    sku: string | null;
    qty: number;
    reserved_qty: number;
    lot_id: string | null;
  } | undefined;

  if (!invRow || invRow.qty < qty) {
    throw new DomainError('INSUFFICIENT_STOCK', 'Not enough stock in bin');
  }

  if (consumeReserved) {
    if (invRow.reserved_qty < qty) {
      throw new DomainError('INSUFFICIENT_STOCK', 'Not enough reserved stock to consume', {
        reserved: invRow.reserved_qty,
        requested: qty
      });
    }
  } else {
    const unreserved = invRow.qty - invRow.reserved_qty;
    if (unreserved < qty) {
      throw new DomainError('INSUFFICIENT_STOCK', 'Not enough available unreserved stock', {
        unreserved,
        requested: qty
      });
    }
  }

  const lotId = invRow.lot_id || `LOT-OPEN-${invRow.sku}`;
  postLedger(db, [{
    sku: invRow.sku!,
    lotId,
    qty,
    from: `BIN:${binCode}`,
    to: 'EXT',
    type: 'PICK'
  }], null);

  if (consumeReserved) {
    releaseStock(db, binCode, qty);
  }
}

export function reserve(db: Database.Database, args: ReserveArgs): void {
  reserveStock(db, args.bin, args.qty);
}

export function release(db: Database.Database, args: ReleaseArgs): void {
  releaseStock(db, args.bin, args.qty);
}

export function recordMovement(db: Database.Database, args: RecordMovementArgs): string {
  const ref = nextRef(db, 'movement');

  db.prepare(`
    INSERT INTO stock_movements (
      ref, movement_type, sku, qty,
      from_kind, from_ref, to_kind, to_ref,
      related_type, related_ref, performed_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ref,
    args.type,
    args.sku,
    args.qty,
    args.from.kind,
    args.from.ref || null,
    args.to.kind,
    args.to.ref || null,
    args.related?.type || null,
    args.related?.ref || null,
    args.actorId || null
  );

  return ref;
}

export function applyRecount(db: Database.Database, args: RecountArgs): {
  bin_code: string;
  counted_qty: number;
  delta: number;
  adj_ref: string | null;
} {
  const { bin_code, counted_qty, sku, reason, actorId } = args;

  const binRow = db.prepare('SELECT code, capacity, status FROM bins WHERE code = ?').get(bin_code) as {
    code: string;
    capacity: number;
    status: string;
  } | undefined;

  if (!binRow) {
    throw new DomainError('UNKNOWN_BIN', `Bin ${bin_code} not found`);
  }

  if (!Number.isInteger(counted_qty) || counted_qty < 0) {
    throw new DomainError('QUANTITY_INVALID', 'Counted quantity must be >= 0');
  }

  if (!reason || reason.length < 3 || reason.length > 200) {
    throw new DomainError('VALIDATION_ERROR', 'Reason must be between 3 and 200 characters');
  }

  const invRow = db.prepare('SELECT sku, qty, reserved_qty FROM inventory WHERE bin_code = ?').get(bin_code) as {
    sku: string | null;
    qty: number;
    reserved_qty: number;
  };

  if (counted_qty > 0 && (invRow.sku === null || invRow.qty === 0)) {
    if (!sku) {
      throw new DomainError('VALIDATION_ERROR', 'SKU is required when recounting an empty bin with positive quantity');
    }
    const pCheck = db.prepare('SELECT sku FROM products WHERE sku = ?').get(sku);
    if (!pCheck) {
      throw new DomainError('UNKNOWN_SKU', `Product ${sku} not found`);
    }
  }

  if (invRow.qty > 0 && invRow.sku !== null) {
    if (sku && sku.toUpperCase() !== invRow.sku.toUpperCase()) {
      throw new DomainError('SKU_CONFLICT', 'Bin already holds a different SKU', { existing_sku: invRow.sku });
    }
  }

  if (counted_qty < invRow.reserved_qty) {
    throw new DomainError('ADJUSTMENT_CONFLICT', 'Counted quantity would violate existing reservations', {
      reserved_qty: invRow.reserved_qty
    });
  }

  if (counted_qty > binRow.capacity) {
    throw new DomainError('CAPACITY_EXCEEDED', 'Bin capacity exceeded', {
      free_capacity: Math.max(0, binRow.capacity - invRow.qty)
    });
  }

  // 1. Clear recount flag FIRST
  db.prepare('UPDATE bins SET recount_required = 0 WHERE code = ?').run(bin_code);

  const delta = counted_qty - invRow.qty;
  let adjRef: string | null = null;

  if (delta > 0) {
    adjRef = nextRef(db, 'adjustment');
    const effectiveSku = invRow.sku || sku!;
    stockIn(db, { bin: bin_code, sku: effectiveSku, qty: delta });
    recordMovement(db, {
      type: 'ADJUSTMENT',
      sku: effectiveSku,
      qty: delta,
      from: { kind: 'ADJUSTMENT', ref: adjRef },
      to: { kind: 'BIN', ref: bin_code },
      related: { type: 'ADJUSTMENT', ref: adjRef },
      actorId
    });
  } else if (delta < 0) {
    adjRef = nextRef(db, 'adjustment');
    const effectiveSku = invRow.sku!;
    stockOut(db, { bin: bin_code, qty: -delta, consumeReserved: false });
    recordMovement(db, {
      type: 'ADJUSTMENT',
      sku: effectiveSku,
      qty: -delta,
      from: { kind: 'BIN', ref: bin_code },
      to: { kind: 'ADJUSTMENT', ref: adjRef },
      related: { type: 'ADJUSTMENT', ref: adjRef },
      actorId
    });
  }

  // Record audit
  recordAudit(db, {
    entity_type: 'BIN',
    entity_id: bin_code,
    action: 'BIN_RECOUNTED',
    before: { qty: invRow.qty, reserved_qty: invRow.reserved_qty, sku: invRow.sku },
    after: { qty: counted_qty, reserved_qty: invRow.reserved_qty, sku: invRow.sku || sku },
    actor_id: actorId
  });

  // Outbox event
  insertOutboxEvent(db, {
    event_type: 'inventory.changed',
    entity_type: 'BIN',
    entity_id: bin_code,
    data: { bin_code, counted_qty, delta }
  });

  return {
    bin_code,
    counted_qty,
    delta,
    adj_ref: adjRef
  };
}
