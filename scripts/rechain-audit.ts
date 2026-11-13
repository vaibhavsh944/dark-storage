import Database from 'better-sqlite3';
import { canonicalJson } from '../services/engine3-inventory/src/audit/appendAudit.js';
import crypto from 'node:crypto';

const db = new Database('./data/warehouse.db');
db.exec('DROP TRIGGER IF EXISTS trg_audit_no_update; DROP TRIGGER IF EXISTS trg_audit_no_delete;');

const rows = db.prepare('SELECT * FROM audit_log ORDER BY id ASC').all() as any[];
let prevHash = 'GENESIS';
let seq = 0;

const updateStmt = db.prepare(`
  UPDATE audit_log
  SET seq = ?, prev_hash = ?, row_hash = ?, at = ?, actor = ?, role = ?, details = ?
  WHERE id = ?
`);

for (const row of rows) {
  seq += 1;
  const at = row.at || row.occurred_at || new Date().toISOString();
  const actor = row.actor != null ? String(row.actor) : (row.actor_user_id != null ? String(row.actor_user_id) : 'system');
  const role = row.role || row.actor_role || null;
  const details = row.details != null ? row.details : (row.details_json && row.details_json !== '{}' ? row.details_json : null);
  const reasonCode = row.reason_code ?? null;

  const canonical = canonicalJson({
    action: row.action,
    actor,
    at,
    details,
    entity_id: String(row.entity_id),
    entity_type: String(row.entity_type),
    reason_code: reasonCode,
    role,
    seq
  });

  const rowHash = crypto.createHash('sha256').update(prevHash + canonical).digest('hex');
  updateStmt.run(seq, prevHash, rowHash, at, actor, role, details, row.id);
  prevHash = rowHash;
}

db.prepare('UPDATE audit_head SET last_seq = ?, last_hash = ? WHERE id = 1').run(seq, prevHash);

db.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
  BEFORE UPDATE ON audit_log
  WHEN OLD.row_hash IS NOT NULL
  BEGIN
    SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete
  BEFORE DELETE ON audit_log
  BEGIN
    SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE');
  END;
`);

console.log(`Successfully rechained ${seq} rows. Head hash: ${prevHash}`);
