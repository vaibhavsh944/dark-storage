-- Migration 011: System Configuration & Background Job Runs

CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('int','float','bool','string')),
  grp TEXT NOT NULL CHECK(grp IN ('THRESHOLD','WEIGHT')),
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('OK','ERROR')),
  detail TEXT
);

-- Seed REF-6 config keys
INSERT OR IGNORE INTO system_config (key, value, type, grp, description) VALUES
  ('lease.mission_seconds', '60', 'int', 'THRESHOLD', 'Picker mission lease duration before auto-release'),
  ('lease.floor_task_seconds', '120', 'int', 'THRESHOLD', 'Floor task lease duration'),
  ('exception.recount_sla_min', '15', 'int', 'THRESHOLD', 'SLA minutes for Operator recount on frozen bin'),
  ('exception.escalate_min', '15', 'int', 'THRESHOLD', 'Minutes before unresolved exception flags escalated'),
  ('exception.rate_flag_per_100_picks', '5', 'float', 'THRESHOLD', 'Abnormal picker exception rate threshold per 100 picks'),
  ('adjust.high_threshold_inr', '5000', 'int', 'THRESHOLD', 'Adjustment value (INR) requiring 2nd distinct Manager approval'),
  ('count.recount_variance_pct', '10', 'float', 'THRESHOLD', 'Variance % triggering automatic Round 2 blind count'),
  ('count.require_second_counter', 'true', 'bool', 'THRESHOLD', 'Enforce counter2 != counter1 on Round 2 count'),
  ('cycle.days.A', '7', 'int', 'THRESHOLD', 'Cycle count frequency days by ABC velocity class A'),
  ('cycle.days.B', '30', 'int', 'THRESHOLD', 'Cycle count frequency days by ABC velocity class B'),
  ('cycle.days.C', '90', 'int', 'THRESHOLD', 'Cycle count frequency days by ABC velocity class C'),
  ('pack.weight_tolerance_pct', '8', 'float', 'THRESHOLD', 'Allowed % deviation on pack bench scale weight'),
  ('pack.bag_tare_g', '40', 'int', 'THRESHOLD', 'Standard delivery bag tare weight in grams'),
  ('dispatch.otp_max_attempts', '3', 'int', 'THRESHOLD', 'Max failed rider OTP attempts before lock'),
  ('inbound.min_shelf_life_pct', '50', 'float', 'THRESHOLD', 'Minimum remaining shelf life % required at dock'),
  ('fefo.min_days_to_expiry_at_pick', '1', 'int', 'THRESHOLD', 'Minimum days before expiry allowed for order allocation'),
  ('expiry.markdown_days', '7', 'int', 'THRESHOLD', 'Days before expiry to flag stock as expiring soon'),
  ('pick.strategy', 'SINGLE', 'string', 'THRESHOLD', 'SINGLE or BATCH picking mode'),
  ('pick.batch_size', '3', 'int', 'THRESHOLD', 'Max orders grouped into one batch mission'),
  ('sla.promise_minutes', '10', 'int', 'THRESHOLD', 'Dark store customer delivery promise in minutes'),
  ('sla.pick_seconds_per_line', '45', 'int', 'THRESHOLD', 'Estimated seconds per order line for SLA slack'),
  ('reslot.benefit_effort_ratio', '2.0', 'float', 'THRESHOLD', 'Min saved walking distance / move effort ratio'),
  ('device.binding_required', 'false', 'bool', 'THRESHOLD', 'Require registered x-device-id on floor mutations'),
  ('session.idle_minutes', '10', 'int', 'THRESHOLD', 'Floor session idle timeout'),
  ('alloc.w.velocity', '30', 'int', 'WEIGHT', 'Explainable shelf allocator velocity weight'),
  ('alloc.w.zone', '20', 'int', 'WEIGHT', 'Explainable shelf allocator zone weight'),
  ('alloc.w.capacity', '15', 'int', 'WEIGHT', 'Explainable shelf allocator capacity weight'),
  ('alloc.w.distance', '15', 'int', 'WEIGHT', 'Explainable shelf allocator distance weight'),
  ('alloc.w.weight_level', '10', 'int', 'WEIGHT', 'Explainable shelf allocator weight-level weight'),
  ('alloc.w.compat', '10', 'int', 'WEIGHT', 'Explainable shelf allocator compatibility weight');
