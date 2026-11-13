import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { verifyAuditChain, appendAudit } from '../audit/appendAudit.js';

export function createAuditRouter(db: Database.Database): Router {
  const router = Router();

  // GET /internal/v1/audit/verify
  router.get(
    ['/internal/v1/audit/verify', '/api/audit/verify'],
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = verifyAuditChain(db);

        // Append audit row for the verification
        appendAudit(db, {
          actorId: req.actor?.id ?? (req.headers['x-actor-id'] ? String(req.headers['x-actor-id']) : null),
          actorRole: req.actor?.role ?? (req.headers['x-actor-role'] ? String(req.headers['x-actor-role']) : null),
          action: 'audit.verified',
          entityType: 'audit_log',
          entityId: 'chain',
          details: { ok: result.ok, checked: result.checked, brokenAtSeq: result.brokenAtSeq }
        });

        res.json({
          ok: result.ok,
          checked: result.checked,
          brokenAtSeq: result.brokenAtSeq,
          headHash: result.headHash
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /internal/v1/audit/export
  router.get(
    ['/internal/v1/audit/export', '/api/audit/export'],
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const from = req.query.from as string | undefined;
        const to = req.query.to as string | undefined;

        const whereClauses: string[] = ['1=1'];
        const params: any[] = [];

        if (from) {
          whereClauses.push('(a.at >= ? OR a.occurred_at >= ?)');
          params.push(from, from);
        }
        if (to) {
          whereClauses.push('(a.at <= ? OR a.occurred_at <= ?)');
          params.push(to, to);
        }

        const rows = db.prepare(`
          SELECT
            a.seq,
            COALESCE(a.at, a.occurred_at) AS at,
            COALESCE(u.username, u.display_name, a.actor, 'System') AS actor,
            COALESCE(u.role, a.role, a.actor_role, 'SYSTEM') AS role,
            a.action,
            a.entity_type,
            a.entity_id,
            a.prev_hash,
            a.row_hash,
            a.reason_code,
            COALESCE(a.details, a.details_json) AS details
          FROM audit_log a
          LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE ${whereClauses.join(' AND ')}
          ORDER BY a.seq ASC
        `).all(...params) as any[];

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="audit_log.csv"');

        // CSV Header
        res.write('seq,at,actor,role,action,entity_type,entity_id,prev_hash,row_hash,reason_code,details\n');

        for (const row of rows) {
          const safeDetails = row.details ? `"${row.details.replace(/"/g, '""')}"` : '""';
          const line = [
            row.seq ?? '',
            row.at ?? '',
            `"${(row.actor || '').replace(/"/g, '""')}"`,
            row.role ?? '',
            `"${(row.action || '').replace(/"/g, '""')}"`,
            `"${(row.entity_type || '').replace(/"/g, '""')}"`,
            `"${(row.entity_id || '').replace(/"/g, '""')}"`,
            row.prev_hash ?? '',
            row.row_hash ?? '',
            row.reason_code ?? '',
            safeDetails
          ].join(',');
          res.write(line + '\n');
        }

        res.end();
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /internal/v1/audit
  router.get(
    ['/internal/v1/audit', '/api/audit'],
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const entityType = (req.query.entityType || req.query.entity_type) as string | undefined;
        const entityRef = (req.query.entityRef || req.query.entity_id) as string | undefined;
        const action = req.query.action as string | undefined;
        const actor = req.query.actor as string | undefined;
        const cursor = req.query.cursor ? parseInt(req.query.cursor as string, 10) : undefined;
        const limit = req.query.limit
          ? parseInt(req.query.limit as string, 10)
          : (req.query.page_size ? parseInt(req.query.page_size as string, 10) : 50);

        const whereClauses: string[] = ['1=1'];
        const params: any[] = [];

        if (entityType) {
          whereClauses.push('a.entity_type = ?');
          params.push(entityType);
        }
        if (entityRef) {
          whereClauses.push('a.entity_id = ?');
          params.push(entityRef);
        }
        if (action) {
          whereClauses.push('a.action = ?');
          params.push(action);
        }
        if (actor) {
          whereClauses.push('(u.username = ? OR u.display_name = ? OR a.actor = ?)');
          params.push(actor, actor, actor);
        }
        if (cursor !== undefined) {
          whereClauses.push('a.seq < ?');
          params.push(cursor);
        }

        const whereSql = whereClauses.join(' AND ');

        const countRow = db.prepare(`
          SELECT COUNT(*) AS c
          FROM audit_log a
          LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE ${whereSql}
        `).get(...params) as { c: number };

        const rows = db.prepare(`
          SELECT
            a.id,
            a.seq,
            COALESCE(a.at, a.occurred_at) AS at,
            COALESCE(u.display_name, u.username, a.actor, 'System') AS actor,
            COALESCE(u.role, a.role, a.actor_role, 'SYSTEM') AS role,
            a.action,
            a.entity_type,
            a.entity_id,
            COALESCE(a.details, a.details_json) AS details_json,
            a.prev_hash,
            a.row_hash,
            a.reason_code
          FROM audit_log a
          LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE ${whereSql}
          ORDER BY a.seq DESC
          LIMIT ?
        `).all(...params, limit) as any[];

        const items = rows.map((r) => {
          let details: any = null;
          if (r.details_json) {
            try {
              details = JSON.parse(r.details_json);
            } catch {
              details = r.details_json;
            }
          }
          return {
            id: r.id,
            seq: r.seq,
            at: r.at,
            actor: r.actor,
            role: r.role,
            action: r.action,
            entity_type: r.entity_type,
            entity_id: r.entity_id,
            prev_hash: r.prev_hash,
            row_hash: r.row_hash,
            reason_code: r.reason_code,
            details
          };
        });

        res.json({
          items,
          total: countRow.c,
          limit,
          nextCursor: items.length === limit && items.length > 0 ? items[items.length - 1].seq : null
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /internal/v1/orders/:ref/events
  router.get(
    ['/internal/v1/orders/:ref/events', '/api/orders/:ref/events'],
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const orderRef = req.params.ref;
        const events = db.prepare(`
          SELECT id, order_ref, event, actor_id, actor_role, payload, at
          FROM order_events
          WHERE order_ref = ?
          ORDER BY id ASC
        `).all(orderRef) as any[];

        const parsedEvents = events.map((e) => ({
          id: e.id,
          order_ref: e.order_ref,
          event: e.event,
          actor_id: e.actor_id,
          actor_role: e.actor_role,
          payload: e.payload ? (() => { try { return JSON.parse(e.payload); } catch { return e.payload; } })() : {},
          at: e.at
        }));

        res.json({ events: parsedEvents });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
