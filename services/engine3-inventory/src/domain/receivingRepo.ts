import Database from 'better-sqlite3';
import { DomainError } from '@dark-storage/shared';
import { nextRef } from './ids.js';
import { recordMovement } from './inventoryRepo.js';
import { ensureLot, postLedger, LedgerLine } from '../ledger/postLedger.js';
import { recordAudit } from './audit.js';
import { insertOutboxEvent } from './outbox.js';

export interface CreateReceiptLineArg {
  sku: string;
  qty: number;
}

export interface CreateReceiptArgs {
  supplier?: string | null;
  reference_no?: string | null;
  notes?: string | null;
  received_at?: string | null;
  lines: CreateReceiptLineArg[];
  actor: { id: number; name: string; role: string };
  hooks?: {
    afterStep?: (stepName: string) => void;
  };
}

export interface ReceiptLineDetail {
  line_id: number;
  line_no: number;
  sku: string;
  product_name: string;
  qty_received: number;
  qty_put_away: number;
  qty_staged: number;
  movement_ref: string;
}

export interface ReceiptDetail {
  ref: string;
  status: string;
  received_at: string;
  received_by: { id: number; name: string };
  supplier: string | null;
  reference_no: string | null;
  notes: string | null;
  lines: ReceiptLineDetail[];
}

export function createReceipt(db: Database.Database, args: CreateReceiptArgs): ReceiptDetail {
  const { lines, actor, hooks } = args;

  if (!lines || lines.length === 0) {
    throw new DomainError('VALIDATION_ERROR', 'At least one line is required');
  }

  // 1. Check for duplicates in SKUs (case-insensitive)
  const seenSkus = new Set<string>();
  for (const line of lines) {
    const norm = line.sku.toUpperCase();
    if (seenSkus.has(norm)) {
      throw new DomainError('DUPLICATE_LINE_SKU', `Duplicate SKU in lines: ${line.sku}`, { sku: line.sku });
    }
    seenSkus.add(norm);
  }

  // Validate each product exists and qty in [1, max_receive_qty]
  const productInfoMap = new Map<string, { sku: string; name: string; max_receive_qty: number }>();
  for (const line of lines) {
    const prod = db.prepare(`
      SELECT sku, name, max_receive_qty, active
      FROM products
      WHERE UPPER(sku) = UPPER(?)
    `).get(line.sku) as {
      sku: string;
      name: string;
      max_receive_qty: number;
      active: number;
    } | undefined;

    if (!prod || prod.active !== 1) {
      throw new DomainError('UNKNOWN_SKU', `SKU ${line.sku} not found or inactive`, { sku: line.sku });
    }

    if (!Number.isInteger(line.qty) || line.qty <= 0 || line.qty > prod.max_receive_qty) {
      throw new DomainError('QUANTITY_INVALID', `Quantity invalid or exceeds limit of ${prod.max_receive_qty}`, {
        sku: line.sku,
        max: prod.max_receive_qty
      });
    }

    productInfoMap.set(line.sku.toUpperCase(), {
      sku: prod.sku,
      name: prod.name,
      max_receive_qty: prod.max_receive_qty
    });
  }

  // 2. Generate receipt ref
  const receiptRef = nextRef(db, 'receipt');
  const receivedAt = args.received_at || new Date().toISOString();

  const insertReceiptStmt = db.prepare(`
    INSERT INTO receipts (ref, supplier, reference_no, notes, received_at, received_by, status)
    VALUES (?, ?, ?, ?, ?, ?, 'STAGED')
  `);

  const receiptRes = insertReceiptStmt.run(
    receiptRef,
    args.supplier || null,
    args.reference_no || null,
    args.notes || null,
    receivedAt,
    actor.id
  );

  const receiptId = Number(receiptRes.lastInsertRowid);
  const resultLines: ReceiptLineDetail[] = [];

  const insertLineStmt = db.prepare(`
    INSERT INTO receipt_lines (receipt_id, line_no, sku, qty_received, qty_put_away, movement_ref)
    VALUES (?, ?, ?, ?, 0, ?)
  `);

  // 3. For each line
  const ledgerLines: LedgerLine[] = [];
  let lineNo = 1;
  for (const line of lines) {
    const pInfo = productInfoMap.get(line.sku.toUpperCase())!;
    const lotId = `LOT-${receiptRef}-${pInfo.sku}`;

    ensureLot(db, {
      lotId,
      sku: pInfo.sku,
      lotCode: receiptRef,
      poRef: args.reference_no || null,
      supplier: args.supplier || null
    });

    ledgerLines.push({
      sku: pInfo.sku,
      lotId,
      qty: line.qty,
      from: 'EXT',
      to: `STAGED:${receiptRef}`,
      type: 'RECEIVE',
      refType: 'RECEIPT',
      refId: receiptRef
    });

    const movRef = recordMovement(db, {
      type: 'RECEIVE',
      sku: pInfo.sku,
      qty: line.qty,
      from: { kind: 'EXTERNAL' },
      to: { kind: 'STAGING', ref: receiptRef },
      related: { type: 'RECEIPT', ref: receiptRef },
      actorId: actor.id
    });

    const lineRes = insertLineStmt.run(
      receiptId,
      lineNo,
      pInfo.sku,
      line.qty,
      movRef
    );

    resultLines.push({
      line_id: Number(lineRes.lastInsertRowid),
      line_no: lineNo,
      sku: pInfo.sku,
      product_name: pInfo.name,
      qty_received: line.qty,
      qty_put_away: 0,
      qty_staged: line.qty,
      movement_ref: movRef
    });

    hooks?.afterStep?.('line:' + lineNo);
    lineNo++;
  }

  // Post to ledger
  if (ledgerLines.length > 0) {
    postLedger(db, ledgerLines, { id: actor.id });
  }

  // 4. Audit & Outbox
  recordAudit(db, {
    entity_type: 'RECEIPT',
    entity_id: receiptRef,
    action: 'RECEIPT_CREATED',
    actor_id: actor.id,
    after: { lines: resultLines }
  });

  insertOutboxEvent(db, {
    event_type: 'receipt.created',
    entity_type: 'RECEIPT',
    entity_id: receiptRef,
    data: {
      ref: receiptRef,
      lines: resultLines.map(l => ({ sku: l.sku, qty: l.qty_received }))
    }
  });

  // 5. Return 201 receipt detail
  return {
    ref: receiptRef,
    status: 'STAGED',
    received_at: receivedAt,
    received_by: { id: actor.id, name: actor.name },
    supplier: args.supplier || null,
    reference_no: args.reference_no || null,
    notes: args.notes || null,
    lines: resultLines
  };
}
