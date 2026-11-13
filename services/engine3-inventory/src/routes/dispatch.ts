import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import {
  getDispatchQueue,
  handoverDispatchOrder,
  regenDispatchOtp,
  getDemoOtp
} from '../domain/dispatchRepo.js';

export function createDispatchRouter(db: Database.Database): Router {
  const router = Router();

  // GET /internal/v1/dispatch/queue
  router.get('/internal/v1/dispatch/queue', (_req: Request, res: Response, next: NextFunction) => {
    try {
      const queue = getDispatchQueue(db);
      res.json(queue);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/dispatch/:orderRef/handover
  router.post('/internal/v1/dispatch/:orderRef/handover', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderRef } = req.params;
      const actor = req.body.actor || { id: 1, username: 'staff1', role: 'STAFF' };
      const result = handoverDispatchOrder(db, orderRef, {
        slotScan: req.body.slotScan,
        otp: req.body.otp,
        riderName: req.body.riderName,
        actor
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/dispatch/:orderRef/regen-otp
  router.post('/internal/v1/dispatch/:orderRef/regen-otp', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderRef } = req.params;
      const actor = req.body.actor || { id: 1, username: 'manager1', role: 'MANAGER' };
      const result = regenDispatchOtp(db, orderRef, {
        reasonCode: req.body.reasonCode,
        note: req.body.note,
        actor
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/dispatch/demo-otp/:orderRef
  router.get('/internal/v1/dispatch/demo-otp/:orderRef', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderRef } = req.params;
      const result = getDemoOtp(orderRef);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
