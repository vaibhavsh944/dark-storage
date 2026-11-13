import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { DomainError, reportProblemSchema, exceptionQuerySchema } from '@dark-storage/shared';
import { runIdempotent } from '../domain/idempotency.js';
import {
  executeReportProblem,
  getException,
  listExceptions,
  getRerouteInput,
  rerouteMission
} from '../domain/pickingRepo.js';
import { scanBin, scanItem, scanTote } from '../domain/scanPickRepo.js';

export function createPickingRouter(db: Database.Database): Router {
  const router = Router();

  // GET /internal/v1/pick-stops/:ref
  router.get('/internal/v1/pick-stops/:ref', (req: Request, res: Response, next: NextFunction) => {
    try {
      const stop = db
        .prepare(
          `
        SELECT
          ps.*,
          b.shelf_code,
          p.name AS product_name,
          m.picker_id,
          m.ref AS mission_ref,
          m.status AS mission_status
        FROM pick_stops ps
        JOIN bins b ON b.code = ps.bin_code
        JOIN products p ON p.sku = ps.sku COLLATE NOCASE
        JOIN missions m ON m.id = ps.mission_id
        WHERE ps.stop_ref = ?
      `
        )
        .get(req.params.ref) as any;

      if (!stop) {
        throw new DomainError('NOT_FOUND', `Stop ${req.params.ref} not found`);
      }

      res.json(stop);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/pick-stops/:ref/scan-bin
  router.post('/internal/v1/pick-stops/:ref/scan-bin', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor || req.body?.actor || { id: 1, role: 'PICKER' };
      const { scan } = req.body || {};
      const result = scanBin(db, req.params.ref, scan, actor);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/pick-stops/:ref/scan-item
  router.post('/internal/v1/pick-stops/:ref/scan-item', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor || req.body?.actor || { id: 1, role: 'PICKER' };
      const { scan, qty } = req.body || {};
      const result = scanItem(db, req.params.ref, scan, qty, actor);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/pick-stops/:ref/scan-tote
  router.post('/internal/v1/pick-stops/:ref/scan-tote', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor || req.body?.actor || { id: 1, role: 'PICKER' };
      const { scan } = req.body || {};
      const result = scanTote(db, req.params.ref, scan, actor);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/pick-stops/:ref/exception
  router.post('/internal/v1/pick-stops/:ref/exception', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ref } = req.params;
      const key =
        (req.headers['x-idempotency-key'] as string) ||
        (req.headers['idempotency-key'] as string) ||
        req.body?.idempotency_key;

      if (!key) {
        throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
      }

      const parsed = reportProblemSchema.parse(req.body);
      const actor = req.actor || req.body?.actor || { id: 1, role: 'PICKER' };

      const result = runIdempotent(
        db,
        {
          key,
          scope: `stop:exception:${ref}`,
          body: parsed,
          actor
        },
        (txDb) => {
          const exc = executeReportProblem(txDb, {
            stop_ref: ref,
            type: parsed.type,
            notes: parsed.notes,
            actor
          });
          return { status: 201, body: exc };
        }
      );

      res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/exceptions
  router.get('/internal/v1/exceptions', (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = exceptionQuerySchema.parse(req.query);
      const pickerId = req.query.picker_id ? Number(req.query.picker_id) : undefined;
      const data = listExceptions(db, { ...parsed, picker_id: pickerId });
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/exceptions/:ref
  router.get('/internal/v1/exceptions/:ref', (req: Request, res: Response, next: NextFunction) => {
    try {
      const exc = getException(db, req.params.ref);
      if (!exc) {
        throw new DomainError('NOT_FOUND', `Exception ${req.params.ref} not found`);
      }
      res.json(exc);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/missions/:ref/reroute-input
  router.get('/internal/v1/missions/:ref/reroute-input', (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = getRerouteInput(db, req.params.ref);
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/missions/:ref/reroute
  router.post('/internal/v1/missions/:ref/reroute', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { route, ordered_stop_ids } = req.body;
      if (!route || !Array.isArray(ordered_stop_ids)) {
        throw new DomainError('VALIDATION_ERROR', 'route and ordered_stop_ids are required');
      }

      rerouteMission(db, req.params.ref, route, ordered_stop_ids);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
