import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import { postLedger, ensureLot, reconcileLedger } from '../../services/engine3-inventory/src/ledger/postLedger.js';

describe('P4-T6: Ledger Property Tests', () => {
  it('executes 200 randomized valid movements across 5 bins and 2 SKUs; asserts reconcile(db).ok === true and zeroSumOk === true', () => {
    const db = makeTestDb();
    seedMinimal(db);

    // Setup 5 bins on shelf S-01
    const bins = ['A-01-01', 'A-01-02', 'A-01-03', 'A-01-04', 'A-01-05'];
    for (let i = 4; i <= 5; i++) {
      db.prepare(`
        INSERT OR IGNORE INTO bins (code, shelf_code, level, capacity, status, recount_required)
        VALUES (?, 'S-01', ?, 500, 'ACTIVE', 0)
      `).run(`A-01-0${i}`, i);

      db.prepare(`
        INSERT OR IGNORE INTO inventory (bin_code, sku, qty, reserved_qty)
        VALUES (?, NULL, 0, 0)
      `).run(`A-01-0${i}`);
    }

    // Ensure all bins have capacity 500
    db.prepare("UPDATE bins SET capacity = 500 WHERE shelf_code = 'S-01'").run();

    const skus = [
      { sku: 'SKU-001', lot: 'LOT-PROP-001' },
      { sku: 'SKU-002', lot: 'LOT-PROP-002' }
    ];

    for (const item of skus) {
      ensureLot(db, {
        lotId: item.lot,
        sku: item.sku,
        supplier: 'PROP_TEST'
      });
    }

    // Seed initial stock from EXT into bins
    db.transaction(() => {
      postLedger(
        db,
        [
          {
            sku: skus[0].sku,
            lotId: skus[0].lot,
            qty: 100,
            from: 'EXT',
            to: `BIN:${bins[0]}`,
            type: 'PUTAWAY'
          },
          {
            sku: skus[1].sku,
            lotId: skus[1].lot,
            qty: 100,
            from: 'EXT',
            to: `BIN:${bins[1]}`,
            type: 'PUTAWAY'
          }
        ],
        { id: '1' }
      );
    })();

    const initialRec = reconcileLedger(db);
    expect(initialRec.ok).toBe(true);
    expect(initialRec.zeroSumOk).toBe(true);

    const totes = ['TOTE:TOTE-001', 'TOTE:TOTE-002'];
    const staged = ['STAGED:RCV-PROP-1'];

    for (let step = 0; step < 200; step++) {
      const currentItem = skus[step % 2];

      // Query current balances with qty > 0 for this SKU
      const balances = db.prepare(`
        SELECT location_key, qty
        FROM location_balances
        WHERE sku = ? AND lot_id = ? AND qty > 0
      `).all(currentItem.sku, currentItem.lot) as Array<{ location_key: string; qty: number }>;

      db.transaction(() => {
        const action = Math.floor(Math.random() * 5);

        if (action === 0 || balances.length === 0) {
          // EXT -> BIN
          const candidateBin = bins.find((b) => {
            const inv = db.prepare('SELECT sku, qty FROM inventory WHERE bin_code = ?').get(b) as any;
            return !inv || inv.qty === 0 || inv.sku === currentItem.sku;
          }) || bins[0];

          postLedger(
            db,
            [
              {
                sku: currentItem.sku,
                lotId: currentItem.lot,
                qty: Math.floor(Math.random() * 5) + 1,
                from: 'EXT',
                to: `BIN:${candidateBin}`,
                type: 'PUTAWAY'
              }
            ],
            { id: '1' }
          );
        } else if (action === 1) {
          // Move from positive location to TOTE
          const source = balances[Math.floor(Math.random() * balances.length)];
          const moveQty = Math.max(1, Math.min(source.qty, Math.floor(Math.random() * 4) + 1));
          const targetTote = totes[Math.floor(Math.random() * totes.length)];

          if (source.location_key !== targetTote) {
            postLedger(
              db,
              [
                {
                  sku: currentItem.sku,
                  lotId: currentItem.lot,
                  qty: moveQty,
                  from: source.location_key,
                  to: targetTote,
                  type: 'PICK'
                }
              ],
              { id: '1' }
            );
          }
        } else if (action === 2) {
          // Move from TOTE or source to candidate BIN
          const source = balances[Math.floor(Math.random() * balances.length)];
          const moveQty = Math.max(1, Math.min(source.qty, Math.floor(Math.random() * 4) + 1));
          const candidateBin = bins.find((b) => {
            const inv = db.prepare('SELECT sku, qty FROM inventory WHERE bin_code = ?').get(b) as any;
            return (!inv || inv.qty === 0 || inv.sku === currentItem.sku) && `BIN:${b}` !== source.location_key;
          });

          if (candidateBin) {
            postLedger(
              db,
              [
                {
                  sku: currentItem.sku,
                  lotId: currentItem.lot,
                  qty: moveQty,
                  from: source.location_key,
                  to: `BIN:${candidateBin}`,
                  type: 'PUTBACK'
                }
              ],
              { id: '1' }
            );
          }
        } else if (action === 3) {
          // Write off a small amount from a positive non-EXT balance
          const nonExtBalances = balances.filter((b) => b.location_key !== 'EXT' && !b.location_key.startsWith('LOST'));
          if (nonExtBalances.length > 0) {
            const source = nonExtBalances[Math.floor(Math.random() * nonExtBalances.length)];
            const moveQty = Math.max(1, Math.min(source.qty, Math.floor(Math.random() * 2) + 1));

            postLedger(
              db,
              [
                {
                  sku: currentItem.sku,
                  lotId: currentItem.lot,
                  qty: moveQty,
                  from: source.location_key,
                  to: 'LOST',
                  type: 'WRITE_OFF'
                }
              ],
              { id: '1' }
            );
          }
        } else {
          // Inbound staged: EXT -> STAGED -> BIN
          const stg = staged[0];
          const moveQty = Math.floor(Math.random() * 4) + 1;
          const candidateBin = bins.find((b) => {
            const inv = db.prepare('SELECT sku, qty FROM inventory WHERE bin_code = ?').get(b) as any;
            return !inv || inv.qty === 0 || inv.sku === currentItem.sku;
          }) || bins[0];

          postLedger(
            db,
            [
              {
                sku: currentItem.sku,
                lotId: currentItem.lot,
                qty: moveQty,
                from: 'EXT',
                to: stg,
                type: 'RECEIVE'
              },
              {
                sku: currentItem.sku,
                lotId: currentItem.lot,
                qty: moveQty,
                from: stg,
                to: `BIN:${candidateBin}`,
                type: 'PUTAWAY'
              }
            ],
            { id: '1' }
          );
        }
      })();

      // After every step assert reconcile(db).ok === true and zeroSumOk === true
      const rec = reconcileLedger(db);
      expect(rec.ok, `Reconcile failed at step ${step}: ${JSON.stringify(rec)}`).toBe(true);
      expect(rec.zeroSumOk, `ZeroSum failed at step ${step}: ${JSON.stringify(rec)}`).toBe(true);
    }
  });
});
