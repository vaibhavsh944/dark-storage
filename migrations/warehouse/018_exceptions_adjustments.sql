-- 018_exceptions_adjustments.sql: Bin freeze, exceptions extension, dual-control adjustments, count results, available stock view

-- 1. Extend bins with freeze tracking columns
ALTER TABLE bins ADD COLUMN pick_frozen INTEGER NOT NULL DEFAULT 0 CHECK (pick_frozen IN (0,1));
ALTER TABLE bins ADD COLUMN frozen_reason TEXT;
ALTER TABLE bins ADD COLUMN frozen_at TEXT;
ALTER TABLE bins ADD COLUMN frozen_exception_ref TEXT;
ALTER TABLE bins ADD COLUMN last_counted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_bins_frozen ON bins(pick_frozen) WHERE pick_frozen = 1;

-- 2. Rebuild pick_exceptions using Part D.1 recipe
PRAGMA foreign_keys = OFF;

CREATE TABLE pick_exceptions_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ref               TEXT NOT NULL UNIQUE,
  mission_id        INTEGER REFERENCES missions(id),
  order_id          INTEGER REFERENCES orders(id),
  stop_id           INTEGER REFERENCES pick_stops(id),
  bin_code          TEXT NOT NULL REFERENCES bins(code),
  sku               TEXT NOT NULL COLLATE NOCASE REFERENCES products(sku),
  exception_type    TEXT NOT NULL,
  expected_qty      INTEGER NOT NULL DEFAULT 0,
  actual_qty        INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  reported_by       INTEGER REFERENCES users(id),
  reported_at       TEXT NOT NULL DEFAULT (datetime('now')),
  status            TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','COUNT_REQUESTED','COUNT_SUBMITTED','RESOLVED')),
  resolution        TEXT,
  resolved_by       INTEGER REFERENCES users(id),
  resolved_at       TEXT,
  resolution_notes  TEXT,
  escalated         INTEGER NOT NULL DEFAULT 0,
  due_at            TEXT,
  count_task_ref    TEXT,
  order_ref         TEXT,
  resolution_reason TEXT
);

INSERT INTO pick_exceptions_new (
  id, ref, mission_id, order_id, stop_id, bin_code, sku, exception_type,
  expected_qty, actual_qty, notes, reported_by, reported_at, status,
  resolution, resolved_by, resolved_at, resolution_notes,
  escalated, due_at, count_task_ref, order_ref, resolution_reason
)
SELECT
  id,
  ref,
  mission_id,
  order_id,
  stop_id,
  bin_code,
  sku,
  CASE
    WHEN exception_type IS NOT NULL THEN exception_type
    ELSE 'OTHER'
  END,
  expected_qty,
  actual_qty,
  notes,
  reported_by,
  reported_at,
  status,
  resolution,
  resolved_by,
  resolved_at,
  resolution_notes,
  0,
  NULL,
  NULL,
  NULL,
  NULL
FROM pick_exceptions;

DROP TABLE pick_exceptions;
ALTER TABLE pick_exceptions_new RENAME TO pick_exceptions;

CREATE INDEX IF NOT EXISTS idx_exc_status ON pick_exceptions(status, escalated);
CREATE INDEX IF NOT EXISTS idx_exc_bin ON pick_exceptions(bin_code);

PRAGMA foreign_keys = ON;

-- 3. Create inventory_adjustments
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adj_ref TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('COUNT_VARIANCE','DAMAGE_WRITE_OFF','EXPIRY_WRITE_OFF','RTV')),
  status TEXT NOT NULL DEFAULT 'PENDING_MANAGER' CHECK (status IN ('PENDING_MANAGER','PENDING_SECOND_MANAGER','APPLIED','REJECTED','CANCELLED')),
  bin_code TEXT REFERENCES bins(code),
  sku TEXT NOT NULL REFERENCES products(sku),
  lot_id TEXT REFERENCES lots(lot_id),
  delta_qty INTEGER NOT NULL CHECK (delta_qty <> 0),
  value_paise INTEGER NOT NULL DEFAULT 0,
  reason_code TEXT NOT NULL,
  note TEXT,
  requested_by TEXT NOT NULL REFERENCES users(id),
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  manager1_id TEXT REFERENCES users(id),
  manager1_at TEXT,
  manager2_id TEXT REFERENCES users(id),
  manager2_at TEXT,
  reject_reason TEXT,
  source_ref TEXT,
  version INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_adj_status ON inventory_adjustments(status);
CREATE INDEX IF NOT EXISTS idx_adj_bin ON inventory_adjustments(bin_code);

-- 4. Create count_results
CREATE TABLE IF NOT EXISTS count_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_ref TEXT NOT NULL REFERENCES floor_tasks(task_ref),
  bin_code TEXT NOT NULL REFERENCES bins(code),
  sku TEXT NOT NULL REFERENCES products(sku),
  counted_qty INTEGER NOT NULL CHECK (counted_qty >= 0),
  system_qty INTEGER NOT NULL,
  variance INTEGER NOT NULL,
  counted_by TEXT NOT NULL REFERENCES users(id),
  counted_at TEXT NOT NULL DEFAULT (datetime('now')),
  round INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_count_results_task ON count_results(task_ref);
CREATE INDEX IF NOT EXISTS idx_count_results_bin ON count_results(bin_code);

-- 5. Rebuild v_available_stock
DROP VIEW IF EXISTS v_available_stock;
CREATE VIEW v_available_stock AS
SELECT
  i.bin_code,
  i.sku,
  i.qty,
  i.reserved_qty,
  CASE
    WHEN b.pick_frozen = 0 AND b.recount_required = 0 AND b.status = 'ACTIVE' AND s.status = 'ACTIVE'
    THEN MAX(0, i.qty - i.reserved_qty)
    ELSE 0
  END AS atp_pickable,
  (i.qty - i.reserved_qty) AS available_qty,
  b.shelf_code,
  b.level,
  b.capacity,
  b.pick_frozen,
  s.nav_node_id
FROM inventory i
JOIN bins b    ON b.code = i.bin_code
JOIN shelves s ON s.code = b.shelf_code
WHERE i.sku IS NOT NULL AND (i.qty - i.reserved_qty) > 0;
