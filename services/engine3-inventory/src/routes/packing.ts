import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { getPackingQueue } from '../domain/packingRepo.js';
import {
  openPackSession,
  getPackSession,
  scanPackItem,
  flagPackItem,
  weighPackSession,
  completePackSession
} from '../domain/packingBenchRepo.js';

export function createPackingRouter(db: Database.Database): Router {
  const router = Router();

  // GET /internal/v1/packing/queue
  router.get('/internal/v1/packing/queue', (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = getPackingQueue(db);
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/packing/open
  router.post('/internal/v1/packing/open', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.body.actor || { id: 1, username: 'staff1', role: 'STAFF' };
      const session = openPackSession(db, {
        toteScan: req.body.toteScan,
        benchCode: req.body.benchCode,
        actor
      });
      res.json(session);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/packing/sessions/:id
  router.get('/internal/v1/packing/sessions/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      const session = getPackSession(db, id);
      res.json(session);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/packing/sessions/:id/scan-item
  router.post('/internal/v1/packing/sessions/:id/scan-item', (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      const actor = req.body.actor || { id: 1, username: 'staff1', role: 'STAFF' };
      const session = scanPackItem(db, id, {
        scan: req.body.scan,
        actor
      });
      res.json(session);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/packing/sessions/:id/flag-item
  router.post('/internal/v1/packing/sessions/:id/flag-item', (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      const actor = req.body.actor || { id: 1, username: 'staff1', role: 'STAFF' };
      const session = flagPackItem(db, id, {
        sku: req.body.sku,
        qty: req.body.qty,
        kind: req.body.kind,
        note: req.body.note,
        actor
      });
      res.json(session);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/packing/sessions/:id/weigh
  router.post('/internal/v1/packing/sessions/:id/weigh', (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      const actor = req.body.actor || { id: 1, username: 'staff1', role: 'STAFF' };
      const session = weighPackSession(db, id, {
        grams: req.body.grams,
        actor
      });
      res.json(session);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/packing/sessions/:id/complete
  router.post('/internal/v1/packing/sessions/:id/complete', (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      const actor = req.body.actor || { id: 1, username: 'staff1', role: 'STAFF' };
      const result = completePackSession(db, id, {
        slotScan: req.body.slotScan,
        cartonType: req.body.cartonType,
        actor
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
