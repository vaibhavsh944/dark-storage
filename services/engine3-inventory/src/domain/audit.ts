import Database from 'better-sqlite3';
import { appendAudit, AppendAuditInput, appendOrderEvent, ensureAuditChain, verifyAuditChain } from '../audit/appendAudit.js';

export { appendAudit, appendOrderEvent, ensureAuditChain, verifyAuditChain };
export type { AppendAuditInput };

export interface AuditParams {
  actor: { id: number | string; role?: string; username?: string } | null;
  action: string;
  entity_type: string;
  entity_id: string;
  details?: Record<string, unknown> | string;
  request_id?: string;
}

export function audit(db: Database.Database, params: AuditParams): void {
  appendAudit(db, {
    actorId: params.actor?.id ?? null,
    actorRole: params.actor?.role ?? null,
    action: params.action,
    entityType: params.entity_type,
    entityId: params.entity_id,
    details: params.details,
    requestId: params.request_id
  });
}

export function recordAudit(
  db: Database.Database,
  opts: {
    entity_type: string;
    entity_id: string;
    action: string;
    before?: unknown;
    after?: unknown;
    actor_id?: number | string | null;
    actor_role?: string | null;
    request_id?: string;
  }
): void {
  appendAudit(db, {
    actorId: opts.actor_id ?? null,
    actorRole: opts.actor_role ?? null,
    action: opts.action,
    entityType: opts.entity_type,
    entityId: opts.entity_id,
    before: opts.before,
    after: opts.after,
    requestId: opts.request_id
  });
}
