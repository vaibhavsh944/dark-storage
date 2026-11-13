import Database from 'better-sqlite3';
import crypto from 'node:crypto';

export interface AuditActor {
  id?: number | string | null;
  username?: string | null;
  role?: string | null;
}

export interface AppendAuditInput {
  actorId?: string | number | null;
  actorRole?: string | null;
  actor?: AuditActor | null;
  action: string;
  entityType: string;
  entityId?: string;
  entityRef?: string;
  details?: Record<string, unknown> | string | null;
  before?: unknown;
  after?: unknown;
  reasonCode?: string | null;
  note?: string;
  ip?: string;
  requestId?: string;
  at?: string;
  occurredAt?: string;
}

export interface AppendOrderEventInput {
  orderRef: string;
  event: string;
  actorId?: string | number | null;
  actorRole?: string | null;
  actor?: AuditActor | null;
  payload?: unknown;
  at?: string;
}

export function canonicalJson(obj: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return JSON.stringify(sorted);
}

export function appendAudit(
  db: Database.Database,
  input: AppendAuditInput
): { id: number; seq: number; row_hash: string; prev_hash: string; at: string } {
  const at = input.at || input.occurredAt || new Date().toISOString();

  // Extract actor
  let actorId: string | number | null = null;
  if (input.actorId !== undefined && input.actorId !== null) {
    actorId = input.actorId;
  } else if (input.actor?.id !== undefined && input.actor?.id !== null) {
    actorId = input.actor.id;
  }

  const actorRole = input.actorRole ?? input.actor?.role ?? null;
  const entityId = input.entityId ?? input.entityRef ?? '';
  const reasonCode = input.reasonCode ?? null;
  const requestId = input.requestId ?? null;

  // Format details
  let detailsStr: string | null = null;
  if (input.details !== undefined && input.details !== null) {
    detailsStr = typeof input.details === 'string' ? input.details : JSON.stringify(input.details);
  } else if (input.before !== undefined || input.after !== undefined || input.note !== undefined || input.ip !== undefined) {
    const detailsObj: Record<string, unknown> = {};
    if (input.before !== undefined) detailsObj.before = input.before;
    if (input.after !== undefined) detailsObj.after = input.after;
    if (reasonCode) detailsObj.reason_code = reasonCode;
    if (input.note !== undefined) detailsObj.note = input.note;
    if (input.ip !== undefined) detailsObj.ip = input.ip;
    if (input.actor?.username) detailsObj.username = input.actor.username;
    detailsStr = JSON.stringify(detailsObj);
  }

  const actorStr = actorId != null ? String(actorId) : 'system';
  const roleStr = actorRole != null ? String(actorRole) : null;
  const numericActorId = typeof actorId === 'number' ? actorId : (Number(actorId) || null);

  // Read head
  const head = db.prepare('SELECT last_seq, last_hash FROM audit_head WHERE id = 1').get() as {
    last_seq: number;
    last_hash: string;
  } | undefined;

  const lastSeq = head ? head.last_seq : 0;
  const prevHash = head ? head.last_hash : 'GENESIS';
  const seq = lastSeq + 1;

  const canonical = canonicalJson({
    action: input.action,
    actor: actorStr,
    at,
    details: detailsStr,
    entity_id: entityId,
    entity_type: input.entityType,
    reason_code: reasonCode,
    role: roleStr,
    seq
  });

  const rowHash = crypto.createHash('sha256').update(prevHash + canonical).digest('hex');

  const insertStmt = db.prepare(`
    INSERT INTO audit_log (
      occurred_at, at,
      actor_user_id, actor,
      actor_role, role,
      action,
      entity_type,
      entity_id,
      details_json, details,
      request_id,
      seq,
      prev_hash,
      row_hash,
      reason_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const info = insertStmt.run(
    at, at,
    numericActorId, actorStr,
    roleStr, roleStr,
    input.action,
    input.entityType,
    entityId,
    detailsStr ?? '{}', detailsStr,
    requestId,
    seq,
    prevHash,
    rowHash,
    reasonCode
  );

  db.prepare(`
    UPDATE audit_head
    SET last_seq = ?, last_hash = ?
    WHERE id = 1
  `).run(seq, rowHash);

  return {
    id: Number(info.lastInsertRowid),
    seq,
    row_hash: rowHash,
    prev_hash: prevHash,
    at
  };
}

export function appendOrderEvent(
  db: Database.Database,
  input: AppendOrderEventInput
): number {
  const at = input.at || new Date().toISOString();
  let actorId: string | null = null;
  if (input.actorId !== undefined && input.actorId !== null) {
    actorId = String(input.actorId);
  } else if (input.actor?.id !== undefined && input.actor?.id !== null) {
    actorId = String(input.actor.id);
  }

  const actorRole = input.actorRole ?? input.actor?.role ?? null;
  const payloadStr = input.payload !== undefined && input.payload !== null
    ? (typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload))
    : null;

  const res = db.prepare(`
    INSERT INTO order_events (order_ref, event, actor_id, actor_role, payload, at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(input.orderRef, input.event, actorId, actorRole, payloadStr, at);

  return Number(res.lastInsertRowid);
}

export function ensureAuditChain(db: Database.Database): { backfilled: number } {
  // Ensure audit_head exists
  db.prepare(`
    INSERT OR IGNORE INTO audit_head (id, last_seq, last_hash) VALUES (1, 0, 'GENESIS')
  `).run();

  const unhashedRows = db.prepare(`
    SELECT id, occurred_at, at, actor_user_id, actor, actor_role, role, action, entity_type, entity_id, details_json, details, request_id, reason_code
    FROM audit_log
    WHERE row_hash IS NULL
    ORDER BY id ASC
  `).all() as any[];

  if (unhashedRows.length === 0) {
    return { backfilled: 0 };
  }

  const head = db.prepare('SELECT last_seq, last_hash FROM audit_head WHERE id = 1').get() as {
    last_seq: number;
    last_hash: string;
  } || { last_seq: 0, last_hash: 'GENESIS' };

  let currentSeq = head.last_seq;
  let currentHash = head.last_hash;

  const updateStmt = db.prepare(`
    UPDATE audit_log
    SET seq = ?, prev_hash = ?, row_hash = ?, at = ?, actor = ?, role = ?, details = ?, reason_code = ?
    WHERE id = ?
  `);

  const tx = db.transaction(() => {
    for (const row of unhashedRows) {
      currentSeq += 1;
      const prevHash = currentHash;
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
        seq: currentSeq
      });

      const rowHash = crypto.createHash('sha256').update(prevHash + canonical).digest('hex');

      updateStmt.run(currentSeq, prevHash, rowHash, at, actor, role, details, reasonCode, row.id);
      currentHash = rowHash;
    }

    db.prepare(`
      UPDATE audit_head
      SET last_seq = ?, last_hash = ?
      WHERE id = 1
    `).run(currentSeq, currentHash);
  });

  tx();
  return { backfilled: unhashedRows.length };
}

export interface AuditVerifyResult {
  ok: boolean;
  checked: number;
  brokenAtSeq: number | null;
  headHash: string;
  head: {
    last_seq: number;
    last_hash: string;
  } | null;
}

export function verifyAuditChain(db: Database.Database): AuditVerifyResult {
  const head = db.prepare('SELECT last_seq, last_hash FROM audit_head WHERE id = 1').get() as {
    last_seq: number;
    last_hash: string;
  } | undefined;

  const headHash = head?.last_hash ?? 'GENESIS';

  const rows = db.prepare(`
    SELECT seq, prev_hash, row_hash, occurred_at, at, actor_user_id, actor, actor_role, role, action, entity_type, entity_id, details_json, details, reason_code
    FROM audit_log
    WHERE seq IS NOT NULL
    ORDER BY seq ASC
  `).all() as any[];

  if (rows.length === 0) {
    const isOk = !head || head.last_seq === 0;
    return {
      ok: isOk,
      checked: 0,
      brokenAtSeq: isOk ? null : 1,
      headHash,
      head: head || null
    };
  }

  let expectedPrevHash = 'GENESIS';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const expectedSeq = i + 1;

    if (row.seq !== expectedSeq) {
      return { ok: false, checked: i, brokenAtSeq: expectedSeq, headHash, head: head || null };
    }

    if (row.prev_hash !== expectedPrevHash) {
      return { ok: false, checked: i, brokenAtSeq: row.seq, headHash, head: head || null };
    }

    const at = row.at || row.occurred_at;
    const actor = row.actor != null ? String(row.actor) : (row.actor_user_id != null ? String(row.actor_user_id) : 'system');
    const role = row.role || row.actor_role || null;
    const details = row.details != null ? row.details : (row.details_json && row.details_json !== '{}' ? row.details_json : null);

    const canonical = canonicalJson({
      action: row.action,
      actor,
      at,
      details,
      entity_id: String(row.entity_id),
      entity_type: String(row.entity_type),
      reason_code: row.reason_code ?? null,
      role,
      seq: row.seq
    });

    const computedHash = crypto.createHash('sha256').update(expectedPrevHash + canonical).digest('hex');

    if (row.row_hash !== computedHash) {
      return { ok: false, checked: i, brokenAtSeq: row.seq, headHash, head: head || null };
    }

    expectedPrevHash = row.row_hash;
  }

  if (head && (head.last_seq !== rows.length || head.last_hash !== expectedPrevHash)) {
    return { ok: false, checked: rows.length, brokenAtSeq: rows.length, headHash, head };
  }

  return {
    ok: true,
    checked: rows.length,
    brokenAtSeq: null,
    headHash: expectedPrevHash,
    head: head || null
  };
}
