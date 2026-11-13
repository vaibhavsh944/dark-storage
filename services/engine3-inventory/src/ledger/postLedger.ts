import Database from 'better-sqlite3';
import { AppError } from '@dark-storage/shared';
import { nextRef } from '../domain/ids.js';

export type EntryType =
  | 'OPENING'
  | 'RECEIVE'
  | 'RECEIVE_REJECT'
  | 'PUTAWAY'
  | 'PICK'
  | 'PACK'
  | 'STAGE_DISPATCH'
  | 'HANDOVER'
  | 'PUTBACK'
  | 'RELOCATE'
  | 'REPLENISH'
  | 'QUARANTINE'
  | 'QUARANTINE_RELEASE'
  | 'WRITE_OFF'
  | 'ADJUST_IN'
  | 'ADJUST_OUT'
  | 'RTV'
  | 'EXPIRE';

export interface LedgerLine {
  sku: string;
  lotId: string;
  qty: number;
  from: string;
  to: string;
  type: EntryType;
  refType?: string;
  refId?: string;
  orderRef?: string;
  reasonCode?: string;
  note?: string;
}

export interface LedgerEntry {
  id: number;
  entryRef: string;
  ts: string;
  sku: string;
  lotId: string;
  qty: number;
  fromLoc: string;
  toLoc: string;
  entryType: EntryType;
  refType?: string | null;
  refId?: string | null;
  orderRef?: string | null;
  actorId?: string | null;
  reasonCode?: string | null;
  note?: string | null;
}

export interface PostLedgerOptions {
  skipProjection?: boolean;
  projection?: boolean;
}

export interface LotInput {
  lotId: string;
  sku: string;
  lotCode?: string | null;
  mfgDate?: string | null;
  expiryDate?: string | null;
  poRef?: string | null;
  supplier?: string | null;
}

export function ensureLot(db: Database.Database, lot: LotInput): void {
  db.prepare(`
    INSERT INTO lots (lot_id, sku, lot_code, mfg_date, expiry_date, po_ref, supplier)
    VALUES (@lotId, @sku, @lotCode, @mfgDate, @expiryDate, @poRef, @supplier)
    ON CONFLICT(lot_id) DO UPDATE SET
      lot_code = COALESCE(excluded.lot_code, lots.lot_code),
      mfg_date = COALESCE(excluded.mfg_date, lots.mfg_date),
      expiry_date = COALESCE(excluded.expiry_date, lots.expiry_date),
      po_ref = COALESCE(excluded.po_ref, lots.po_ref),
      supplier = COALESCE(excluded.supplier, lots.supplier)
  `).run({
    lotId: lot.lotId,
    sku: lot.sku,
    lotCode: lot.lotCode || null,
    mfgDate: lot.mfgDate || null,
    expiryDate: lot.expiryDate || null,
    poRef: lot.poRef || null,
    supplier: lot.supplier || null
  });
}

export function reserveStock(db: Database.Database, binCode: string, qty: number): void {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new AppError('QUANTITY_INVALID', 422, 'Quantity must be a positive integer');
  }

  const res = db.prepare(`
    UPDATE inventory
    SET reserved_qty = reserved_qty + @q,
        updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    WHERE bin_code = @bin AND (qty - reserved_qty) >= @q
  `).run({ q: qty, bin: binCode });

  if (res.changes === 0) {
    throw new AppError('INSUFFICIENT_STOCK', 422, 'Not enough unreserved stock to reserve');
  }
}

export function releaseStock(db: Database.Database, binCode: string, qty: number): void {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new AppError('QUANTITY_INVALID', 422, 'Quantity must be a positive integer');
  }

  const res = db.prepare(`
    UPDATE inventory
    SET reserved_qty = reserved_qty - @q,
        updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    WHERE bin_code = @bin AND reserved_qty >= @q
  `).run({ q: qty, bin: binCode });

  if (res.changes === 0) {
    throw new AppError('INVENTORY_DRIFT', 422, 'Cannot release more than reserved quantity');
  }
}

export function postLedger(
  db: Database.Database,
  lines: LedgerLine[],
  actor: { id?: string | number | null } | null,
  opts: PostLedgerOptions = {}
): LedgerEntry[] {
  // 1. Must be called inside active transaction
  if (!db.inTransaction) {
    throw new Error('postLedger requires active tx');
  }

  if (!lines || lines.length === 0) {
    return [];
  }

  // 2. Validate qty and required fields
  for (const line of lines) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      throw new AppError('VALIDATION_FAILED', 422, `Quantity must be a positive integer, got: ${line.qty}`);
    }
    if (!line.sku) {
      throw new AppError('VALIDATION_FAILED', 422, 'SKU is required on ledger line');
    }
    if (!line.lotId) {
      throw new AppError('VALIDATION_FAILED', 422, 'Lot ID is required on ledger line');
    }
    if (!line.from || !line.to) {
      throw new AppError('VALIDATION_FAILED', 422, 'from and to locations are required on ledger line');
    }
    if (line.from === line.to) {
      throw new AppError('VALIDATION_FAILED', 422, `from and to locations cannot be identical: ${line.from}`);
    }

    // Ensure lot exists
    ensureLot(db, {
      lotId: line.lotId,
      sku: line.sku,
      lotCode: line.lotId
    });
  }

  // 3. Collect touched locations and sort lexicographically (deadlock-free lock ordering, D19)
  const allLocations = Array.from(new Set(lines.flatMap((l) => [l.from, l.to]))).sort();

  // 4. For any to location starting with BIN:, verify single-lot-per-bin (D8) & bin capacity
  for (const line of lines) {
    if (line.to.startsWith('BIN:')) {
      const binCode = line.to.slice(4);

      // Check existing balances in this bin
      const existingBalances = db.prepare(`
        SELECT sku, lot_id, qty
        FROM location_balances
        WHERE location_key = ? AND qty > 0
      `).all(line.to) as Array<{ sku: string; lot_id: string; qty: number }>;

      for (const bal of existingBalances) {
        if (bal.sku !== line.sku || bal.lot_id !== line.lotId) {
          throw new AppError('LOT_MIX', 422, 'LOT_MIX: Cannot mix different SKUs or lots in the same bin');
        }
      }

      // Check bin capacity
      const bin = db.prepare('SELECT capacity FROM bins WHERE code = ?').get(binCode) as { capacity: number } | undefined;
      if (bin) {
        const currentQtyRow = db.prepare(`
          SELECT COALESCE(SUM(qty), 0) AS total_qty
          FROM location_balances
          WHERE location_key = ?
        `).get(line.to) as { total_qty: number };

        if (currentQtyRow.total_qty + line.qty > bin.capacity) {
          throw new AppError('VALIDATION_FAILED', 422, `Bin capacity exceeded: ${currentQtyRow.total_qty + line.qty} > ${bin.capacity}`);
        }
      }
    }
  }

  // 5. Insert ledger entries
  const insertStmt = db.prepare(`
    INSERT INTO ledger_entries (
      entry_ref, ts, sku, lot_id, qty, from_loc, to_loc, entry_type,
      ref_type, ref_id, order_ref, actor_id, reason_code, note
    ) VALUES (
      @entry_ref, @ts, @sku, @lot_id, @qty, @from_loc, @to_loc, @entry_type,
      @ref_type, @ref_id, @order_ref, @actor_id, @reason_code, @note
    )
    RETURNING id, entry_ref, ts, sku, lot_id, qty, from_loc, to_loc, entry_type,
              ref_type, ref_id, order_ref, actor_id, reason_code, note
  `);

  const results: LedgerEntry[] = [];
  const now = new Date().toISOString();
  const actorIdStr = actor?.id != null ? String(actor.id) : 'system';

  for (const line of lines) {
    const entryRef = nextRef(db, 'LED');
    try {
      const row = insertStmt.get({
        entry_ref: entryRef,
        ts: now,
        sku: line.sku,
        lot_id: line.lotId,
        qty: line.qty,
        from_loc: line.from,
        to_loc: line.to,
        entry_type: line.type,
        ref_type: line.refType || null,
        ref_id: line.refId || null,
        order_ref: line.orderRef || null,
        actor_id: actorIdStr,
        reason_code: line.reasonCode || null,
        note: line.note || null
      }) as any;

      results.push({
        id: row.id,
        entryRef: row.entry_ref,
        ts: row.ts,
        sku: row.sku,
        lotId: row.lot_id,
        qty: row.qty,
        fromLoc: row.from_loc,
        toLoc: row.to_loc,
        entryType: row.entry_type,
        refType: row.ref_type,
        refId: row.ref_id,
        orderRef: row.order_ref,
        actorId: row.actor_id,
        reasonCode: row.reason_code,
        note: row.note
      });
    } catch (err: any) {
      const msg = String(err.message || err);
      if (msg.includes('NEGATIVE_BALANCE')) {
        throw new AppError('NEGATIVE_BALANCE', 422, `NEGATIVE_BALANCE: Insufficient stock in ${line.from} for SKU ${line.sku}`);
      }
      if (msg.includes('LOT_MIX')) {
        throw new AppError('LOT_MIX', 422, 'LOT_MIX: Cannot mix different SKUs or lots in the same bin');
      }
      if (msg.includes('LEDGER_IMMUTABLE')) {
        throw new AppError('LEDGER_IMMUTABLE', 500, 'Ledger is immutable');
      }
      throw err;
    }
  }

  // 6. Update projections (unless skipProjection is true)
  const skip = opts.skipProjection ?? (opts.projection === false);
  if (!skip) {
    const touchedBins = allLocations
      .filter((loc) => loc.startsWith('BIN:'))
      .map((loc) => loc.slice(4))
      .sort();

    const sumStmt = db.prepare(`
      SELECT
        COALESCE(SUM(qty), 0) AS total_qty,
        MAX(sku) AS sku,
        MAX(lot_id) AS lot_id
      FROM location_balances
      WHERE location_key = ? AND qty > 0
    `);

    const upsertInvStmt = db.prepare(`
      INSERT INTO inventory (bin_code, sku, qty, reserved_qty, lot_id, updated_at)
      VALUES (@bin_code, @sku, @qty, 0, @lot_id, @updated_at)
      ON CONFLICT(bin_code) DO UPDATE SET
        qty = excluded.qty,
        sku = excluded.sku,
        lot_id = excluded.lot_id,
        reserved_qty = CASE WHEN excluded.qty = 0 THEN 0 ELSE MIN(inventory.reserved_qty, excluded.qty) END,
        updated_at = excluded.updated_at
    `);

    const hasCurrentQty = db.prepare("SELECT 1 FROM pragma_table_info('bins') WHERE name = 'current_qty'").get();
    const updateBinStmt = hasCurrentQty
      ? db.prepare(`
          UPDATE bins
          SET current_qty = @qty,
              current_sku = @sku
          WHERE code = @bin_code
        `)
      : null;

    for (const binCode of touchedBins) {
      const locKey = `BIN:${binCode}`;
      const bal = sumStmt.get(locKey) as { total_qty: number; sku: string | null; lot_id: string | null } | undefined;
      const totalQty = bal ? bal.total_qty : 0;
      const binSku = totalQty > 0 && bal ? bal.sku : null;
      const binLot = totalQty > 0 && bal ? bal.lot_id : null;

      upsertInvStmt.run({
        bin_code: binCode,
        sku: binSku,
        qty: totalQty,
        lot_id: binLot,
        updated_at: now
      });

      if (updateBinStmt) {
        updateBinStmt.run({
          bin_code: binCode,
          qty: totalQty,
          sku: binSku
        });
      }
    }

    // Insert corresponding row into stock_movements for bin-level movements
    const movStmt = db.prepare(`
      INSERT INTO stock_movements (
        ref, movement_type, sku, qty, from_kind, from_ref, to_kind, to_ref,
        related_type, related_ref, performed_by, created_at
      ) VALUES (
        @ref, @movement_type, @sku, @qty, @from_kind, @from_ref, @to_kind, @to_ref,
        @related_type, @related_ref, @performed_by, @created_at
      )
    `);

    const numericActor = actor?.id != null ? Number(actor.id) || null : null;

    for (const line of lines) {
      if (line.from.startsWith('BIN:') || line.to.startsWith('BIN:') || line.from.startsWith('STAGED:') || line.to.startsWith('STAGED:')) {
        let movType: 'RECEIVE' | 'PUTAWAY' | 'RELOCATE' | 'PICK' | 'ADJUSTMENT' = 'ADJUSTMENT';
        let fromKind: 'EXTERNAL' | 'STAGING' | 'BIN' | 'ADJUSTMENT' = 'ADJUSTMENT';
        let toKind: 'STAGING' | 'BIN' | 'ORDER_PACKING' | 'ADJUSTMENT' = 'ADJUSTMENT';

        if (line.from === 'EXT' && line.to.startsWith('STAGED:')) {
          movType = 'RECEIVE';
          fromKind = 'EXTERNAL';
          toKind = 'STAGING';
        } else if (line.from.startsWith('STAGED:') && line.to.startsWith('BIN:')) {
          movType = 'PUTAWAY';
          fromKind = 'STAGING';
          toKind = 'BIN';
        } else if (line.from.startsWith('BIN:') && line.to.startsWith('BIN:')) {
          movType = 'RELOCATE';
          fromKind = 'BIN';
          toKind = 'BIN';
        } else if (line.from.startsWith('BIN:') && (line.to.startsWith('TOTE:') || line.to.startsWith('BENCH:') || line.to === 'SHIPPED')) {
          movType = 'PICK';
          fromKind = 'BIN';
          toKind = 'ORDER_PACKING';
        } else if (line.from.startsWith('BIN:') || line.to.startsWith('BIN:')) {
          movType = 'ADJUSTMENT';
          fromKind = line.from.startsWith('BIN:') ? 'BIN' : 'ADJUSTMENT';
          toKind = line.to.startsWith('BIN:') ? 'BIN' : 'ADJUSTMENT';
        }

        try {
          const movRef = nextRef(db, 'MOV');
          movStmt.run({
            ref: movRef,
            movement_type: movType,
            sku: line.sku,
            qty: line.qty,
            from_kind: fromKind,
            from_ref: line.from,
            to_kind: toKind,
            to_ref: line.to,
            related_type: line.refType || 'LEDGER',
            related_ref: line.refId || line.orderRef || null,
            performed_by: numericActor,
            created_at: now
          });
        } catch {
          // Non-blocking projection fallback
        }
      }
    }
  }

  return results;
}

export function reconcileLedger(db: Database.Database): {
  ok: boolean;
  zeroSumOk: boolean;
  mismatches: Array<{
    binCode: string;
    inventoryQty: number;
    binsQty: number;
    ledgerQty: number;
  }>;
} {
  const mismatches: Array<{
    binCode: string;
    inventoryQty: number;
    binsQty: number;
    ledgerQty: number;
  }> = [];

  // 1. Compare inventory.qty and bins.current_qty against SUM(location_balances.qty) for every BIN:<code>
  const bins = db.prepare(`
    SELECT b.code, COALESCE(b.current_qty, 0) AS bins_qty, COALESCE(i.qty, 0) AS inv_qty
    FROM bins b
    LEFT JOIN inventory i ON i.bin_code = b.code
  `).all() as Array<{ code: string; bins_qty: number; inv_qty: number }>;

  const balStmt = db.prepare(`
    SELECT COALESCE(SUM(qty), 0) AS total_qty
    FROM location_balances
    WHERE location_key = ?
  `);

  for (const b of bins) {
    const locKey = `BIN:${b.code}`;
    const ledgerRow = balStmt.get(locKey) as { total_qty: number };
    const ledgerQty = ledgerRow ? ledgerRow.total_qty : 0;

    if (b.inv_qty !== ledgerQty || b.bins_qty !== ledgerQty) {
      mismatches.push({
        binCode: b.code,
        inventoryQty: b.inv_qty,
        binsQty: b.bins_qty,
        ledgerQty
      });
    }
  }

  // 2. Double-entry zero-sum check: SUM(location_balances.qty) across ALL locations must be 0 per (sku, lot_id)
  const zeroSumRows = db.prepare(`
    SELECT sku, lot_id, SUM(qty) AS net_qty
    FROM location_balances
    GROUP BY sku, lot_id
    HAVING SUM(qty) <> 0
  `).all() as Array<{ sku: string; lot_id: string; net_qty: number }>;

  const zeroSumOk = zeroSumRows.length === 0;
  const ok = mismatches.length === 0 && zeroSumOk;

  return {
    ok,
    zeroSumOk,
    mismatches
  };
}
