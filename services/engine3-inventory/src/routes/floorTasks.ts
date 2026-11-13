import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import {
  listFloorTasks,
  claimFloorTask,
  heartbeatFloorTask,
  releaseFloorTask
} from '../domain/floorTasksRepo.js';

export function createFloorTasksRouter(db: Database.Database): Router {
  const router = Router();

  // GET /internal/v1/floor-tasks
  router.get('/internal/v1/floor-tasks', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor || req.body?.actor || { id: 1, role: 'SYSTEM' };
      const tasks = listFloorTasks(db, actor, req.query);
      res.json(tasks);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/floor-tasks/:ref/claim
  router.post('/internal/v1/floor-tasks/:ref/claim', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor || req.body?.actor || { id: 1, role: 'OPERATOR' };
      const task = claimFloorTask(db, req.params.ref, actor);
      res.json(task);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/floor-tasks/:ref/heartbeat
  router.post('/internal/v1/floor-tasks/:ref/heartbeat', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor || req.body?.actor || { id: 1, role: 'OPERATOR' };
      const result = heartbeatFloorTask(db, req.params.ref, actor);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/floor-tasks/:ref/release
  router.post('/internal/v1/floor-tasks/:ref/release', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor || req.body?.actor || { id: 1, role: 'OPERATOR' };
      const result = releaseFloorTask(db, req.params.ref, actor);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
