import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { getAllConfig, getConfig, setConfig } from '../domain/config.js';

export function createConfigRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/internal/v1/config', (_req: Request, res: Response, next: NextFunction) => {
    try {
      const config = getAllConfig(db);
      res.json(config);
    } catch (err) {
      next(err);
    }
  });

  router.get('/internal/v1/config/:key', (req: Request, res: Response, next: NextFunction) => {
    try {
      const value = getConfig(db, req.params.key);
      res.json({ key: req.params.key, value });
    } catch (err) {
      next(err);
    }
  });

  router.put('/internal/v1/config/:key', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actorId = req.body?.actorId || (req as any).user?.id || 'system';
      const result = setConfig(db, req.params.key, req.body?.value, String(actorId));
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
