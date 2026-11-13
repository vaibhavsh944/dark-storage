import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { reconcileLedger } from '../ledger/postLedger.js';

export function createLedgerRouter(db: Database.Database): Router {
  const router = Router();

  // GET /internal/v1/ledger/reconcile
  router.get(
    ['/internal/v1/ledger/reconcile', '/api/ledger/reconcile', '/ledger/reconcile'],
    (_req: Request, res: Response, next: NextFunction) => {
      try {
        const result = reconcileLedger(db);
        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /internal/v1/ledger
  router.get(
    ['/internal/v1/ledger', '/api/ledger', '/ledger'],
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const { sku, location, orderRef, limit } = req.query as {
          sku?: string;
          location?: string;
          orderRef?: string;
          limit?: string;
        };

        const conditions: string[] = [];
        const params: any[] = [];

        if (sku) {
          conditions.push('UPPER(sku) = UPPER(?)');
          params.push(sku);
        }
        if (location) {
          conditions.push('(from_loc = ? OR to_loc = ?)');
          params.push(location, location);
        }
        if (orderRef) {
          conditions.push('order_ref = ?');
          params.push(orderRef);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const maxLimit = Math.min(Math.max(parseInt(limit || '50', 10) || 50, 1), 500);

        const rows = db.prepare(`
          SELECT id, entry_ref, ts, sku, lot_id, qty, from_loc, to_loc,
                 entry_type, ref_type, ref_id, order_ref, actor_id, reason_code, note
          FROM ledger_entries
          ${whereClause}
          ORDER BY id DESC
          LIMIT ?
        `).all(...params, maxLimit);

        // Location balances summary
        let balancesQuery = 'SELECT location_key, sku, lot_id, qty, updated_at FROM location_balances WHERE qty <> 0';
        const balParams: any[] = [];
        if (sku) {
          balancesQuery += ' AND UPPER(sku) = UPPER(?)';
          balParams.push(sku);
        }
        if (location) {
          balancesQuery += ' AND location_key = ?';
          balParams.push(location);
        }
        balancesQuery += ' ORDER BY location_key ASC LIMIT 100';

        const balances = db.prepare(balancesQuery).all(...balParams);

        res.json({
          ok: true,
          data: rows,
          count: rows.length,
          balances
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
