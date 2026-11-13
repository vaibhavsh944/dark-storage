-- 016_orders_rebuild.sql: Rebuild orders with new statuses and SLA/timestamp/version columns

PRAGMA foreign_keys = OFF;

CREATE TABLE orders_new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ref              TEXT NOT NULL UNIQUE,
  order_type       TEXT NOT NULL CHECK (order_type IN ('CUSTOMER','TRANSFER','PRODUCTION')),
  priority         TEXT NOT NULL CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  status           TEXT NOT NULL CHECK (status IN ('DRAFT','RESERVED','ASSIGNED','PICKING','PICKED','PACKING','PACKED','DISPATCHED','COMPLETED','CANCELLED','PARTIALLY_FULFILLED','FAILED')),
  customer_ref     TEXT,
  notes            TEXT,
  requested_by     INTEGER NOT NULL REFERENCES users(id),
  assigned_picker  INTEGER REFERENCES users(id),
  fulfilment_type  TEXT CHECK (fulfilment_type IN ('FULL','PARTIAL')),
  cancelled_reason TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at     TEXT,
  promised_at      TEXT,
  sla_due_at       TEXT,
  picked_at        TEXT,
  packed_at        TEXT,
  dispatched_at    TEXT,
  version          INTEGER NOT NULL DEFAULT 0
);

INSERT INTO orders_new (
  id, ref, order_type, priority,
  status,
  customer_ref, notes, requested_by, assigned_picker, fulfilment_type,
  cancelled_reason, created_at, updated_at, completed_at,
  promised_at, sla_due_at, picked_at, packed_at, dispatched_at, version
)
SELECT
  id, ref, order_type, priority,
  CASE
    WHEN status = 'PARTIALLY_FULFILLED' THEN 'PACKED'
    WHEN status = 'COMPLETED' THEN 'DISPATCHED'
    ELSE status
  END,
  customer_ref, notes, requested_by, assigned_picker, fulfilment_type,
  cancelled_reason, created_at, updated_at, completed_at,
  NULL, NULL, NULL, NULL, NULL, 0
FROM orders;

DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;

CREATE INDEX idx_orders_status ON orders(status, priority);

PRAGMA foreign_keys = ON;
