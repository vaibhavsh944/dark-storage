import Database from 'better-sqlite3';
import { runInTx } from '../db/tx.js';
import { ensureLot, postLedger, LedgerLine } from './postLedger.js';

export function backfillOpeningLedger(db: Database.Database): void {
  // Check if ledger entries exist
  const countRow = db.prepare('SELECT COUNT(*) AS c FROM ledger_entries').get() as { c: number } | undefined;
  if (countRow && countRow.c > 0) {
    return;
  }

  // Also check job_runs
  const alreadyRun = db.prepare("SELECT 1 FROM job_runs WHERE job = 'backfill_opening_ledger' AND status = 'OK'").get();
  if (alreadyRun) {
    return;
  }

  runInTx(db, () => {
    const lines: LedgerLine[] = [];
    const now = new Date().toISOString();

    // 1. Inventory rows with qty > 0
    const invRows = db.prepare(`
      SELECT bin_code, sku, qty, lot_id
      FROM inventory
      WHERE qty > 0 AND sku IS NOT NULL
    `).all() as Array<{ bin_code: string; sku: string; qty: number; lot_id: string | null }>;

    for (const row of invRows) {
      const lotId = `LOT-OPEN-${row.sku}`;
      ensureLot(db, {
        lotId,
        sku: row.sku,
        lotCode: 'OPENING',
        supplier: 'INITIAL_BACKFILL'
      });

      db.prepare(`
        UPDATE inventory
        SET lot_id = ?
        WHERE bin_code = ?
      `).run(lotId, row.bin_code);

      lines.push({
        sku: row.sku,
        lotId,
        qty: row.qty,
        from: 'EXT',
        to: `BIN:${row.bin_code}`,
        type: 'OPENING',
        note: 'Initial opening stock backfill'
      });
    }

    // 2. Staged receipt lines with remaining stock (qty_received - qty_put_away > 0)
    const stagedRows = db.prepare(`
      SELECT r.ref AS receipt_ref, rl.sku, (rl.qty_received - rl.qty_put_away) AS remaining_qty
      FROM receipts r
      JOIN receipt_lines rl ON rl.receipt_id = r.id
      WHERE r.status IN ('STAGED', 'PARTIALLY_PUT_AWAY')
        AND (rl.qty_received - rl.qty_put_away) > 0
    `).all() as Array<{ receipt_ref: string; sku: string; remaining_qty: number }>;

    for (const s of stagedRows) {
      const lotId = `LOT-OPEN-${s.sku}`;
      ensureLot(db, {
        lotId,
        sku: s.sku,
        lotCode: 'OPENING',
        poRef: s.receipt_ref,
        supplier: 'INITIAL_BACKFILL'
      });

      lines.push({
        sku: s.sku,
        lotId,
        qty: s.remaining_qty,
        from: 'EXT',
        to: `STAGED:${s.receipt_ref}`,
        type: 'OPENING',
        refType: 'RECEIPT',
        refId: s.receipt_ref,
        note: 'Initial staged receipt stock backfill'
      });
    }

    if (lines.length > 0) {
      postLedger(db, lines, { id: 'SYSTEM' }, { skipProjection: true });
    }

    // Ensure bins current_qty and current_sku are populated
    db.prepare(`
      UPDATE bins
      SET current_qty = COALESCE((SELECT qty FROM inventory WHERE inventory.bin_code = bins.code), 0),
          current_sku = (SELECT sku FROM inventory WHERE inventory.bin_code = bins.code)
    `).run();

    db.prepare(`
      INSERT INTO job_runs (job, started_at, finished_at, status, detail)
      VALUES ('backfill_opening_ledger', ?, (strftime('%Y-%m-%dT%H:%M:%fZ','now')), 'OK', ?)
    `).run(now, JSON.stringify({ entriesCreated: lines.length }));
  });
}
