-- 015_totes_missions.sql: Totes, missions extension, pick_stops step, floor_tasks

CREATE TABLE IF NOT EXISTS totes (
  tote_code TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'FREE' CHECK (status IN ('FREE','IN_USE','AWAITING_PACK','PACKING','QUARANTINED')),
  mission_ref TEXT,
  order_ref TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO totes (tote_code, status) VALUES
  ('TOTE-001', 'FREE'), ('TOTE-002', 'FREE'), ('TOTE-003', 'FREE'), ('TOTE-004', 'FREE'), ('TOTE-005', 'FREE'),
  ('TOTE-006', 'FREE'), ('TOTE-007', 'FREE'), ('TOTE-008', 'FREE'), ('TOTE-009', 'FREE'), ('TOTE-010', 'FREE'),
  ('TOTE-011', 'FREE'), ('TOTE-012', 'FREE'), ('TOTE-013', 'FREE'), ('TOTE-014', 'FREE'), ('TOTE-015', 'FREE'),
  ('TOTE-016', 'FREE'), ('TOTE-017', 'FREE'), ('TOTE-018', 'FREE'), ('TOTE-019', 'FREE'), ('TOTE-020', 'FREE'),
  ('TOTE-021', 'FREE'), ('TOTE-022', 'FREE'), ('TOTE-023', 'FREE'), ('TOTE-024', 'FREE'), ('TOTE-025', 'FREE'),
  ('TOTE-026', 'FREE'), ('TOTE-027', 'FREE'), ('TOTE-028', 'FREE'), ('TOTE-029', 'FREE'), ('TOTE-030', 'FREE');

PRAGMA foreign_keys = OFF;

CREATE TABLE missions_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ref               TEXT NOT NULL UNIQUE,
  order_id          INTEGER NOT NULL REFERENCES orders(id),
  picker_id         INTEGER REFERENCES users(id),
  status            TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','QUEUED','CLAIMED','ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  route_json        TEXT NOT NULL,
  route_distance    REAL NOT NULL,
  route_algorithm   TEXT NOT NULL CHECK (route_algorithm IN ('HELD_KARP','TWO_OPT','TRIVIAL')),
  assigned_by       INTEGER REFERENCES users(id),
  assigned_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at        TEXT,
  completed_at      TEXT,
  claimed_at        TEXT,
  lease_expires_at  TEXT,
  last_heartbeat_at TEXT,
  tote_code         TEXT,
  priority          INTEGER NOT NULL DEFAULT 300,
  sla_due_at        TEXT,
  version           INTEGER NOT NULL DEFAULT 0,
  batch_id          TEXT,
  zone_code         TEXT
);

INSERT INTO missions_new (
  id, ref, order_id, picker_id, status, route_json, route_distance, route_algorithm,
  assigned_by, assigned_at, started_at, completed_at
)
SELECT
  id, ref, order_id, picker_id, status, route_json, route_distance, route_algorithm,
  assigned_by, assigned_at, started_at, completed_at
FROM missions;

DROP TABLE missions;
ALTER TABLE missions_new RENAME TO missions;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mission_active_order ON missions(order_id) WHERE status IN ('ASSIGNED','IN_PROGRESS');
CREATE INDEX IF NOT EXISTS idx_missions_picker ON missions(picker_id, status);
CREATE INDEX IF NOT EXISTS idx_missions_status_prio ON missions(status, priority ASC, sla_due_at ASC);

CREATE TABLE pick_stops_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id     INTEGER NOT NULL REFERENCES missions(id),
  stop_no        INTEGER NOT NULL,
  stop_ref       TEXT NOT NULL UNIQUE,
  seq            INTEGER NOT NULL,
  reservation_id INTEGER NOT NULL UNIQUE REFERENCES reservations(id),
  bin_code       TEXT NOT NULL REFERENCES bins(code),
  sku            TEXT NOT NULL COLLATE NOCASE REFERENCES products(sku),
  qty_required   INTEGER NOT NULL CHECK (qty_required > 0),
  qty_picked     INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PICKED','EXCEPTION_OPEN','RESOLVED','IN_PROGRESS','CONFIRMED','EXCEPTION')),
  step           TEXT NOT NULL DEFAULT 'PENDING' CHECK (step IN ('PENDING','BIN_OK','ITEM_OK','DONE','SHORT','CANCELLED')),
  confirmed_at   TEXT,
  bin_scanned_at TEXT,
  item_scanned_at TEXT,
  tote_scanned_at TEXT,
  lot_id         TEXT,
  version        INTEGER NOT NULL DEFAULT 0,
  CHECK (qty_picked >= 0 AND qty_picked <= qty_required),
  UNIQUE (mission_id, stop_no)
);

INSERT INTO pick_stops_new (
  id, mission_id, stop_no, stop_ref, seq, reservation_id, bin_code, sku,
  qty_required, qty_picked, status, step, confirmed_at
)
SELECT
  id, mission_id, stop_no, stop_ref, seq, reservation_id, bin_code, sku,
  qty_required, qty_picked, status,
  CASE WHEN status = 'CONFIRMED' OR status = 'PICKED' THEN 'DONE' ELSE 'PENDING' END,
  confirmed_at
FROM pick_stops;

DROP TABLE pick_stops;
ALTER TABLE pick_stops_new RENAME TO pick_stops;
CREATE INDEX IF NOT EXISTS idx_stops_mission ON pick_stops(mission_id, seq);

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS floor_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_ref TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('COUNT','RELOCATE','REPLENISH','PUTBACK','REPICK','EXPIRY_REMOVE')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLAIMED','IN_PROGRESS','DONE','CANCELLED')),
  bin_code TEXT,
  dest_bin_code TEXT,
  sku TEXT,
  lot_id TEXT,
  qty INTEGER,
  order_ref TEXT,
  source_ref TEXT,
  priority INTEGER NOT NULL DEFAULT 300,
  due_at TEXT,
  assigned_to TEXT REFERENCES users(id),
  lease_expires_at TEXT,
  payload TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_floor_tasks_status_prio ON floor_tasks(status, priority ASC, due_at ASC);
