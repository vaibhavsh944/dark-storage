-- Migration 010: Add columns to users for 4-role floor operations, badges, PIN, zones and shifts
ALTER TABLE users ADD COLUMN badge_id TEXT;
ALTER TABLE users ADD COLUMN pin_hash TEXT;
ALTER TABLE users ADD COLUMN zones TEXT NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN shift TEXT NOT NULL DEFAULT 'MORNING' CHECK(shift IN ('MORNING','EVENING','NIGHT'));
ALTER TABLE users ADD COLUMN failed_pin_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_badge ON users(badge_id) WHERE badge_id IS NOT NULL;
