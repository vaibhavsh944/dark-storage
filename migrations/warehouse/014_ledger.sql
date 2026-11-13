-- Migration 014: Append-only stock ledger, lots, and location balances

CREATE TABLE IF NOT EXISTS lots (
  lot_id      TEXT PRIMARY KEY,
  sku         TEXT NOT NULL REFERENCES products(sku),
  lot_code    TEXT,
  mfg_date    TEXT,
  expiry_date TEXT,
  po_ref      TEXT,
  supplier    TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_lots_sku ON lots(sku);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_ref   TEXT UNIQUE NOT NULL,
  ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sku         TEXT NOT NULL REFERENCES products(sku),
  lot_id      TEXT NOT NULL REFERENCES lots(lot_id),
  qty         INTEGER NOT NULL CHECK (qty > 0),
  from_loc    TEXT NOT NULL,
  to_loc      TEXT NOT NULL,
  entry_type  TEXT NOT NULL CHECK (entry_type IN (
                'OPENING', 'RECEIVE', 'RECEIVE_REJECT', 'PUTAWAY', 'PICK', 'PACK',
                'STAGE_DISPATCH', 'HANDOVER', 'PUTBACK', 'RELOCATE', 'REPLENISH',
                'QUARANTINE', 'QUARANTINE_RELEASE', 'WRITE_OFF', 'ADJUST_IN', 'ADJUST_OUT',
                'RTV', 'EXPIRE'
              )),
  ref_type    TEXT,
  ref_id      TEXT,
  order_ref   TEXT,
  actor_id    TEXT,
  reason_code TEXT,
  note        TEXT,
  CHECK (
    (from_loc IN ('EXT', 'SHIPPED', 'QUAR', 'LOST') OR
     from_loc GLOB 'STAGED:*' OR
     from_loc GLOB 'BIN:*' OR
     from_loc GLOB 'TOTE:*' OR
     from_loc GLOB 'BENCH:*' OR
     from_loc GLOB 'DISP:*')
    AND
    (to_loc IN ('EXT', 'SHIPPED', 'QUAR', 'LOST') OR
     to_loc GLOB 'STAGED:*' OR
     to_loc GLOB 'BIN:*' OR
     to_loc GLOB 'TOTE:*' OR
     to_loc GLOB 'BENCH:*' OR
     to_loc GLOB 'DISP:*')
    AND
    from_loc <> to_loc
  )
);
CREATE INDEX IF NOT EXISTS idx_ledger_sku ON ledger_entries(sku);
CREATE INDEX IF NOT EXISTS idx_ledger_lot ON ledger_entries(lot_id);
CREATE INDEX IF NOT EXISTS idx_ledger_from ON ledger_entries(from_loc);
CREATE INDEX IF NOT EXISTS idx_ledger_to ON ledger_entries(to_loc);
CREATE INDEX IF NOT EXISTS idx_ledger_order ON ledger_entries(order_ref);
CREATE INDEX IF NOT EXISTS idx_ledger_ts ON ledger_entries(ts);

CREATE TABLE IF NOT EXISTS location_balances (
  location_key TEXT NOT NULL,
  sku          TEXT NOT NULL,
  lot_id       TEXT NOT NULL,
  qty          INTEGER NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (location_key, sku, lot_id)
);
CREATE INDEX IF NOT EXISTS idx_location_balances_loc ON location_balances(location_key);
CREATE INDEX IF NOT EXISTS idx_location_balances_sku ON location_balances(sku);

CREATE TRIGGER IF NOT EXISTS trg_ledger_no_update
BEFORE UPDATE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_no_delete
BEFORE DELETE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_balance
AFTER INSERT ON ledger_entries
BEGIN
  -- 1. Deduct from from_loc
  INSERT INTO location_balances (location_key, sku, lot_id, qty, updated_at)
  VALUES (NEW.from_loc, NEW.sku, NEW.lot_id, -NEW.qty, NEW.ts)
  ON CONFLICT(location_key, sku, lot_id) DO UPDATE SET
    qty = location_balances.qty - NEW.qty,
    updated_at = NEW.ts;

  -- 2. Add to to_loc
  INSERT INTO location_balances (location_key, sku, lot_id, qty, updated_at)
  VALUES (NEW.to_loc, NEW.sku, NEW.lot_id, NEW.qty, NEW.ts)
  ON CONFLICT(location_key, sku, lot_id) DO UPDATE SET
    qty = location_balances.qty + NEW.qty,
    updated_at = NEW.ts;

  -- 3. Abort if any non-EXT location has negative balance
  SELECT RAISE(ABORT, 'NEGATIVE_BALANCE')
  WHERE NEW.from_loc <> 'EXT'
    AND (
      SELECT qty FROM location_balances
      WHERE location_key = NEW.from_loc AND sku = NEW.sku AND lot_id = NEW.lot_id
    ) < 0;
END;

ALTER TABLE inventory ADD COLUMN lot_id TEXT;
ALTER TABLE bins ADD COLUMN current_qty INTEGER DEFAULT 0;
ALTER TABLE bins ADD COLUMN current_sku TEXT;

CREATE TRIGGER IF NOT EXISTS trg_inventory_lot_mix
BEFORE UPDATE ON inventory
WHEN OLD.lot_id IS NOT NULL AND NEW.lot_id IS NOT NULL AND NEW.lot_id <> OLD.lot_id AND NEW.qty > 0
BEGIN
  SELECT RAISE(ABORT, 'LOT_MIX');
END;
