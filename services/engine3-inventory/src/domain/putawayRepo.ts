import Database from 'better-sqlite3';
import { DomainError, shelfOfBin } from '@dark-storage/shared';
import { runTx } from '../db/tx.js';
import { recordMovement } from './inventoryRepo.js';
import { postLedger } from '../ledger/postLedger.js';

import { nextRef } from './ids.js';
import { recordAudit } from './audit.js';
import { insertOutboxEvent } from './outbox.js';

export interface ExecutePutawayParams {
  receipt_line_id: number;
  dest_bin: string;
  qty: number;
  recommended_bin?: string;
  actor: {
    id: number;
    display_name: string;
    role: string;
  };
  taskId?: string;
  hooks?: {
    afterStep?: (step: string) => void;
  };
}

export function executePutaway(db: Database.Database, params: ExecutePutawayParams) {
  return runTx(db, () => {
    const { receipt_line_id, dest_bin, qty, recommended_bin, actor, taskId, hooks } = params;


  // 1. Query line and receipt
  const line = db.prepare(`
    SELECT l.id, l.receipt_id, l.sku, l.qty_received, l.qty_put_away,
           r.ref AS receipt_ref, r.status AS receipt_status,
           p.name AS product_name
    FROM receipt_lines l
    JOIN receipts r ON l.receipt_id = r.id
    JOIN products p ON l.sku = p.sku
    WHERE l.id = ?
  `).get(receipt_line_id) as {
    id: number;
    receipt_id: number;
    sku: string;
    qty_received: number;
    qty_put_away: number;
    receipt_ref: string;
    receipt_status: string;
    product_name: string;
  } | undefined;

  if (!line) {
    throw new DomainError('NOT_FOUND', `Receipt line ${receipt_line_id} not found`);
  }

  // 2. Validate quantity
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new DomainError('VALIDATION_ERROR', 'Quantity must be a positive integer');
  }

  const staged = line.qty_received - line.qty_put_away;
  if (qty > staged) {
    throw new DomainError('INSUFFICIENT_STAGED_STOCK', 'Quantity exceeds staged stock', {
      staged,
      requested: qty
    });
  }

  // 3. Selection mode
  const mode = recommended_bin && recommended_bin === dest_bin ? 'RECOMMENDED' : 'MANUAL';

  // 4. Find lot from STAGED
  const stagedBal = db.prepare(`
    SELECT lot_id, qty
    FROM location_balances
    WHERE location_key = ? AND sku = ? AND qty > 0
    ORDER BY qty DESC
    LIMIT 1
  `).get(`STAGED:${line.receipt_ref}`, line.sku) as { lot_id: string; qty: number } | undefined;

  const lotId = stagedBal?.lot_id || `LOT-${line.receipt_ref}-${line.sku}`;
  const putawayRef = nextRef(db, 'putaway');

  // 5. Post to ledger (STAGED -> BIN)
  postLedger(
    db,
    [{
      sku: line.sku,
      lotId,
      qty,
      from: `STAGED:${line.receipt_ref}`,
      to: `BIN:${dest_bin}`,
      type: 'PUTAWAY',
      refType: 'PUTAWAY',
      refId: putawayRef
    }],
    { id: actor.id }
  );

  // Hook for testing rollback / afterStep
  if (hooks?.afterStep) {
    hooks.afterStep('stockIn');
  }

  // 6. Update receipt_lines
  const updateLineRes = db.prepare(`
    UPDATE receipt_lines
    SET qty_put_away = qty_put_away + @qty
    WHERE id = @id AND qty_put_away + @qty <= qty_received
  `).run({ id: line.id, qty });

  if (updateLineRes.changes !== 1) {
    throw new DomainError('INSUFFICIENT_STAGED_STOCK', 'Failed to update staged quantity on receipt line');
  }

  const movementRef = putawayRef;

  // 7. Insert into putaways table
  const insertPutawayRes = db.prepare(`
    INSERT INTO putaways (
      ref, receipt_line_id, sku, qty, dest_bin,
      selection_mode, recommended_bin, movement_ref, performed_by, task_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    putawayRef,
    line.id,
    line.sku,
    qty,
    dest_bin,
    mode,
    recommended_bin || null,
    movementRef,
    actor.id,
    taskId || null
  );

  const putawayRow = db.prepare('SELECT created_at FROM putaways WHERE id = ?').get(insertPutawayRes.lastInsertRowid) as { created_at: string };

  // 8. Update receipt status
  const allLines = db.prepare(`
    SELECT qty_received, qty_put_away FROM receipt_lines WHERE receipt_id = ?
  `).all(line.receipt_id) as { qty_received: number; qty_put_away: number }[];

  let newReceiptStatus = 'STAGED';
  if (allLines.every((l) => l.qty_put_away >= l.qty_received)) {
    newReceiptStatus = 'PUT_AWAY';
  } else if (allLines.some((l) => l.qty_put_away > 0)) {
    newReceiptStatus = 'PARTIALLY_PUT_AWAY';
  }

  db.prepare('UPDATE receipts SET status = ? WHERE id = ?').run(newReceiptStatus, line.receipt_id);

  // 9. Audit and Outbox events
  recordAudit(db, {
    actor_id: actor.id,
    action: 'PUTAWAY_COMPLETED',
    entity_type: 'PUTAWAY',
    entity_id: putawayRef,
    after: {
      receipt_ref: line.receipt_ref,
      sku: line.sku,
      qty,
      dest_bin,
      mode
    }
  });

  insertOutboxEvent(db, {
    event_type: 'putaway.completed',
    entity_type: 'PUTAWAY',
    entity_id: putawayRef,
    data: {
      ref: putawayRef,
      receipt_ref: line.receipt_ref,
      sku: line.sku,
      qty,
      dest_bin
    }
  });

  insertOutboxEvent(db, {
    event_type: 'inventory.changed',
    entity_type: 'INVENTORY',
    entity_id: dest_bin,
    data: {
      bins: [dest_bin]
    }
  });


  // 10. Return putaway detail
  return {
    ref: putawayRef,
    receipt_ref: line.receipt_ref,
    receipt_line_id: line.id,
    sku: line.sku,
    product_name: line.product_name,
    qty,
    source: `Receiving staging (${line.receipt_ref})`,
    dest_shelf: shelfOfBin(dest_bin),
    dest_bin,
    selection_mode: mode as 'RECOMMENDED' | 'MANUAL',
    movement_ref: movementRef,
    performed_by: actor.display_name,
    status: 'COMPLETED' as const,
    created_at: putawayRow.created_at,
    line_remaining_staged: staged - qty,
    receipt_status: newReceiptStatus
  };
  });
}

export interface ExecuteRelocateParams {
  from_bin: string;
  to_bin: string;
  qty: number;
  actor: {
    id: number;
    display_name: string;
    role: string;
  };
  taskId?: string;
}

export function executeRelocate(db: Database.Database, params: ExecuteRelocateParams) {
  return runTx(db, () => {
    const { from_bin, to_bin, qty, actor } = params;


  if (from_bin === to_bin) {
    throw new DomainError('VALIDATION_ERROR', 'Source and destination bin cannot be identical');
  }

  if (!Number.isInteger(qty) || qty <= 0) {
    throw new DomainError('VALIDATION_ERROR', 'Quantity must be a positive integer');
  }

  // Check source bin exists
  const fromBin = db.prepare('SELECT code FROM bins WHERE code = ?').get(from_bin);
  if (!fromBin) {
    throw new DomainError('UNKNOWN_BIN', `Source bin ${from_bin} not found`);
  }

  // Check source inventory
  const inv = db.prepare('SELECT sku, qty, reserved_qty FROM inventory WHERE bin_code = ?').get(from_bin) as {
    sku: string | null;
    qty: number;
    reserved_qty: number;
  } | undefined;

  if (!inv || !inv.sku || inv.qty <= 0) {
    throw new DomainError('INSUFFICIENT_STOCK', 'Source bin has no stock');
  }

  const unreserved = inv.qty - inv.reserved_qty;
  if (qty > unreserved) {
    throw new DomainError('INSUFFICIENT_STOCK', 'Insufficient unreserved stock in source bin', {
      unreserved,
      requested: qty
    });
  }

  const sku = inv.sku;

  // 1. Find lot from location_balances
  const fromBal = db.prepare(`
    SELECT lot_id, qty
    FROM location_balances
    WHERE location_key = ? AND sku = ? AND qty > 0
    ORDER BY qty DESC
    LIMIT 1
  `).get(`BIN:${from_bin}`, sku) as { lot_id: string; qty: number } | undefined;

  const lotId = fromBal?.lot_id || `LOT-OPEN-${sku}`;

  // 2. Post to ledger (BIN -> BIN)
  const entries = postLedger(
    db,
    [{
      sku,
      lotId,
      qty,
      from: `BIN:${from_bin}`,
      to: `BIN:${to_bin}`,
      type: 'RELOCATE',
      refType: 'RELOCATION'
    }],
    { id: actor.id }
  );

  const movRef = entries[0]?.entryRef || nextRef(db, 'MOV');

  // 4. Audit & events
  recordAudit(db, {
    actor_id: actor.id,
    action: 'STOCK_RELOCATED',
    entity_type: 'INVENTORY',
    entity_id: from_bin,
    after: {
      from_bin,
      to_bin,
      sku,
      qty,
      movement_ref: movRef
    }
  });

  insertOutboxEvent(db, {
    event_type: 'inventory.changed',
    entity_type: 'INVENTORY',
    entity_id: from_bin,
    data: {
      bins: [from_bin, to_bin]
    }
  });


    const nowIso = new Date().toISOString();
    return {
      ref: movRef,
      sku,
      qty,
      from_bin,
      to_bin,
      movement_ref: movRef,
      performed_by: actor.display_name,
      created_at: nowIso
    };
  });
}

