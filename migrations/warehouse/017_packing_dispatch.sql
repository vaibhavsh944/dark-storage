-- 017_packing_dispatch.sql: Pack sessions, pack item scans, dispatch slots, dispatch handovers

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS dispatch_handovers;
DROP TABLE IF EXISTS pack_scans;
DROP TABLE IF EXISTS pack_sessions;
DROP TABLE IF EXISTS dispatch_slots;

CREATE TABLE pack_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_ref TEXT NOT NULL REFERENCES orders(ref),
  tote_code TEXT NOT NULL REFERENCES totes(tote_code),
  bench_code TEXT NOT NULL DEFAULT 'BENCH-1',
  opened_by TEXT NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','COMPLETE','ABORTED')),
  weight_g INTEGER,
  expected_weight_g INTEGER NOT NULL DEFAULT 0,
  weight_ok INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pack_sessions_order ON pack_sessions(order_ref, status);
CREATE INDEX IF NOT EXISTS idx_pack_sessions_tote ON pack_sessions(tote_code, status);

CREATE TABLE pack_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES pack_sessions(id) ON DELETE CASCADE,
  sku TEXT NOT NULL REFERENCES products(sku),
  qty INTEGER NOT NULL CHECK (qty > 0),
  kind TEXT NOT NULL CHECK (kind IN ('SCANNED','MISSING','DAMAGED')),
  lot_id TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  actor_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pack_scans_session ON pack_scans(session_id);

CREATE TABLE dispatch_slots (
  slot_code TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'FREE' CHECK (status IN ('FREE','OCCUPIED')),
  order_ref TEXT
);

INSERT OR IGNORE INTO dispatch_slots (slot_code, status) VALUES
  ('D-1', 'FREE'),
  ('D-2', 'FREE'),
  ('D-3', 'FREE'),
  ('D-4', 'FREE'),
  ('D-5', 'FREE'),
  ('D-6', 'FREE'),
  ('D-7', 'FREE'),
  ('D-8', 'FREE');

CREATE TABLE dispatch_handovers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_ref TEXT NOT NULL UNIQUE REFERENCES orders(ref),
  slot_code TEXT NOT NULL REFERENCES dispatch_slots(slot_code),
  otp_hash TEXT NOT NULL,
  otp_expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  rider_name TEXT,
  handed_by TEXT REFERENCES users(id),
  handed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_dispatch_handovers_order ON dispatch_handovers(order_ref);
CREATE INDEX IF NOT EXISTS idx_dispatch_handovers_slot ON dispatch_handovers(slot_code);

-- Rebuild packing_records safely to include session_id and tracking_number
CREATE TABLE IF NOT EXISTS packing_records_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ref             TEXT NOT NULL UNIQUE,
  order_id        INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  mission_id      INTEGER REFERENCES missions(id),
  packed_by       INTEGER NOT NULL REFERENCES users(id),
  packed_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  fulfilment_type TEXT NOT NULL CHECK (fulfilment_type IN ('FULL','PARTIAL')),
  total_ordered   INTEGER NOT NULL CHECK (total_ordered > 0),
  total_picked    INTEGER NOT NULL CHECK (total_picked > 0),
  notes           TEXT,
  session_id      INTEGER REFERENCES pack_sessions(id),
  tracking_number TEXT
);

INSERT INTO packing_records_new (
  id, ref, order_id, mission_id, packed_by, packed_at, fulfilment_type, total_ordered, total_picked, notes
)
SELECT id, ref, order_id, mission_id, packed_by, packed_at, fulfilment_type, total_ordered, total_picked, notes
FROM packing_records;

DROP TABLE packing_records;
ALTER TABLE packing_records_new RENAME TO packing_records;

PRAGMA foreign_keys = ON;
