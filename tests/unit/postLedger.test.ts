import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import { postLedger, ensureLot } from '../../services/engine3-inventory/src/ledger/postLedger.js';

describe('postLedger Unit Tests', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
    seedMinimal(db);
    ensureLot(db, {
      lotId: 'LOT-TEST-001',
      sku: 'SKU-001',
      supplier: 'Test Supplier'
    });
    ensureLot(db, {
      lotId: 'LOT-TEST-002',
      sku: 'SKU-001',
      supplier: 'Second Lot'
    });
  });

  it('throws if called outside an open transaction', () => {
    expect(() => {
      postLedger(
        db,
        [
          {
            sku: 'SKU-001',
            lotId: 'LOT-TEST-001',
            qty: 5,
            from: 'EXT',
            to: 'BIN:A-01-01',
            type: 'RECEIVE'
          }
        ],
        { id: '1' }
      );
    }).toThrow('postLedger requires active tx');
  });

  it('moves units EXT -> STAGED -> BIN -> TOTE successfully', () => {
    // 1. EXT -> STAGED
    const entries1 = db.transaction(() => {
      return postLedger(
        db,
        [
          {
            sku: 'SKU-001',
            lotId: 'LOT-TEST-001',
            qty: 10,
            from: 'EXT',
            to: 'STAGED:RCV-001',
            type: 'RECEIVE'
          }
        ],
        { id: '1' }
      );
    })();
    expect(entries1).toHaveLength(1);

    // 2. STAGED -> BIN
    const entries2 = db.transaction(() => {
      return postLedger(
        db,
        [
          {
            sku: 'SKU-001',
            lotId: 'LOT-TEST-001',
            qty: 6,
            from: 'STAGED:RCV-001',
            to: 'BIN:A-01-01',
            type: 'PUTAWAY'
          }
        ],
        { id: '1' }
      );
    })();
    expect(entries2).toHaveLength(1);

    // Verify projection in inventory table
    const inv1 = db.prepare('SELECT qty, sku, lot_id FROM inventory WHERE bin_code = ?').get('A-01-01') as any;
    expect(inv1.qty).toBe(6);
    expect(inv1.sku).toBe('SKU-001');
    expect(inv1.lot_id).toBe('LOT-TEST-001');

    // Verify balance in location_balances
    const balBin = db.prepare('SELECT qty FROM location_balances WHERE location_key = ?').get('BIN:A-01-01') as any;
    expect(balBin.qty).toBe(6);

    const balStaged = db.prepare('SELECT qty FROM location_balances WHERE location_key = ?').get('STAGED:RCV-001') as any;
    expect(balStaged.qty).toBe(4);

    // 3. BIN -> TOTE (4 units)
    const entries3 = db.transaction(() => {
      return postLedger(
        db,
        [
          {
            sku: 'SKU-001',
            lotId: 'LOT-TEST-001',
            qty: 4,
            from: 'BIN:A-01-01',
            to: 'TOTE:TOTE-001',
            type: 'PICK'
          }
        ],
        { id: '1' }
      );
    })();
    expect(entries3).toHaveLength(1);

    // Verify inventory projection updated to 2
    const inv2 = db.prepare('SELECT qty, sku, lot_id FROM inventory WHERE bin_code = ?').get('A-01-01') as any;
    expect(inv2.qty).toBe(2);

    const balTote = db.prepare('SELECT qty FROM location_balances WHERE location_key = ?').get('TOTE:TOTE-001') as any;
    expect(balTote.qty).toBe(4);
  });

  it('throws NEGATIVE_BALANCE when attempting to move more than present in non-EXT location', () => {
    // Put 5 units into BIN
    db.transaction(() => {
      postLedger(
        db,
        [
          {
            sku: 'SKU-001',
            lotId: 'LOT-TEST-001',
            qty: 5,
            from: 'EXT',
            to: 'BIN:A-01-01',
            type: 'PUTAWAY'
          }
        ],
        { id: '1' }
      );
    })();

    // Try to move 6 units out of BIN
    expect(() => {
      db.transaction(() => {
        postLedger(
          db,
          [
            {
              sku: 'SKU-001',
              lotId: 'LOT-TEST-001',
              qty: 6,
              from: 'BIN:A-01-01',
              to: 'TOTE:TOTE-001',
              type: 'PICK'
            }
          ],
          { id: '1' }
        );
      })();
    }).toThrow(/NEGATIVE_BALANCE/);

    // Assert bin balance remains intact (5)
    const inv = db.prepare('SELECT qty FROM inventory WHERE bin_code = ?').get('A-01-01') as any;
    expect(inv.qty).toBe(5);
  });

  it('rejects LOT_MIX when putting a 2nd lot into an occupied bin', () => {
    // Put 5 units of LOT-TEST-001 into bin
    db.transaction(() => {
      postLedger(
        db,
        [
          {
            sku: 'SKU-001',
            lotId: 'LOT-TEST-001',
            qty: 5,
            from: 'EXT',
            to: 'BIN:A-01-01',
            type: 'PUTAWAY'
          }
        ],
        { id: '1' }
      );
    })();

    // Attempt to put LOT-TEST-002 into the same occupied bin
    expect(() => {
      db.transaction(() => {
        postLedger(
          db,
          [
            {
              sku: 'SKU-001',
              lotId: 'LOT-TEST-002',
              qty: 3,
              from: 'EXT',
              to: 'BIN:A-01-01',
              type: 'PUTAWAY'
            }
          ],
          { id: '1' }
        );
      })();
    }).toThrow(/LOT_MIX/);
  });

  it('blocks updates and deletes on ledger_entries with LEDGER_IMMUTABLE', () => {
    let entryId: number;
    db.transaction(() => {
      const res = postLedger(
        db,
        [
          {
            sku: 'SKU-001',
            lotId: 'LOT-TEST-001',
            qty: 5,
            from: 'EXT',
            to: 'BIN:A-01-01',
            type: 'PUTAWAY'
          }
        ],
        { id: '1' }
      );
      entryId = res[0].id;
    })();

    expect(() => {
      db.prepare('UPDATE ledger_entries SET qty = 10 WHERE id = ?').run(entryId!);
    }).toThrow(/LEDGER_IMMUTABLE/);

    expect(() => {
      db.prepare('DELETE FROM ledger_entries WHERE id = ?').run(entryId!);
    }).toThrow(/LEDGER_IMMUTABLE/);
  });
});
