import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { DomainError, AppError, missionQuerySchema, reassignMissionSchema } from '@dark-storage/shared';
import { runIdempotent } from '../domain/idempotency.js';
import {
  getPickPlan,
  assignMission,
  reassignMission,
  startMission,
  getMission,
  listMissions,
  getActivePickers
} from '../domain/missionsRepo.js';
import {
  claimNextMission,
  heartbeatMission,
  releaseMission,
  forceUnassignMission,
  getPickerActiveMission
} from '../domain/missionsClaimRepo.js';

export function createMissionsRouter(db: Database.Database): Router {
  const router = Router();

  // GET /internal/v1/orders/:ref/pick-plan
  router.get('/internal/v1/orders/:ref/pick-plan', (req: Request, res: Response, next: NextFunction) => {
    try {
      const plan = getPickPlan(db, req.params.ref);
      res.json(plan);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/orders/:ref/assign
  router.post('/internal/v1/orders/:ref/assign', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ref } = req.params;
      const key =
        (req.headers['x-idempotency-key'] as string) ||
        (req.headers['idempotency-key'] as string) ||
        req.body?.idempotency_key;

      if (!key) {
        throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
      }

      const { picker_id, plan_token, route } = req.body;
      const actor = req.actor || req.body?.actor || { id: 1, role: 'MANAGER' };

      if (!picker_id || !plan_token || !route) {
        throw new DomainError('VALIDATION_ERROR', 'picker_id, plan_token, and route are required');
      }

      const result = runIdempotent(
        db,
        {
          key,
          scope: `order:assign:${ref}`,
          body: { picker_id, plan_token, route_total: route.total_distance },
          actor
        },
        (txDb) => {
          const mission = assignMission(txDb, {
            order_ref: ref,
            picker_id,
            plan_token,
            route,
            actor
          });
          return { status: 201, body: mission };
        }
      );

      res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/orders/:ref/reassign
  router.post('/internal/v1/orders/:ref/reassign', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ref } = req.params;
      const key =
        (req.headers['x-idempotency-key'] as string) ||
        (req.headers['idempotency-key'] as string) ||
        req.body?.idempotency_key;

      if (!key) {
        throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
      }

      const parsed = reassignMissionSchema.parse(req.body);
      const actor = req.actor || req.body?.actor || { id: 1, role: 'MANAGER' };

      const result = runIdempotent(
        db,
        {
          key,
          scope: `order:reassign:${ref}`,
          body: parsed,
          actor
        },
        (txDb) => {
          const mission = reassignMission(txDb, ref, parsed.picker_id, actor);
          return { status: 200, body: mission };
        }
      );

      res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/missions/:ref/start
  router.post('/internal/v1/missions/:ref/start', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ref } = req.params;
      const key =
        (req.headers['x-idempotency-key'] as string) ||
        (req.headers['idempotency-key'] as string) ||
        req.body?.idempotency_key;

      if (!key) {
        throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
      }

      const actor = req.actor || req.body?.actor || { id: 1, role: 'PICKER' };

      const result = runIdempotent(
        db,
        {
          key,
          scope: `mission:start:${ref}`,
          body: {},
          actor
        },
        (txDb) => {
          const mission = startMission(txDb, ref, actor);
          return { status: 200, body: mission };
        }
      );

      res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/missions
  router.get('/internal/v1/missions', (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = missionQuerySchema.parse(req.query);
      const data = listMissions(db, parsed);
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/missions/:ref
  router.get('/internal/v1/missions/:ref', (req: Request, res: Response, next: NextFunction) => {
    try {
      const mission = getMission(db, req.params.ref);
      if (!mission) {
        throw new DomainError('NOT_FOUND', `Mission ${req.params.ref} not found`);
      }
      res.json(mission);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/pickers
  router.get('/internal/v1/pickers', (_req: Request, res: Response, next: NextFunction) => {
    try {
      const pickers = getActivePickers(db);
      res.json({ pickers });
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/missions/claim-next
  router.post('/internal/v1/missions/claim-next', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor || req.body?.actor || { id: 1, role: 'PICKER' };
      const mission = claimNextMission(db, actor);
      res.json(mission);
    } catch (err) {
      next(err);
    }
  });

  // GET /internal/v1/picker/mission
  router.get('/internal/v1/picker/mission', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor || req.body?.actor || { id: 1, role: 'PICKER' };
      const mission = getPickerActiveMission(db, actor);
      res.json(mission);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/missions/:ref/heartbeat
  router.post('/internal/v1/missions/:ref/heartbeat', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor || req.body?.actor || { id: 1, role: 'PICKER' };
      const result = heartbeatMission(db, req.params.ref, actor);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/missions/:ref/release
  router.post('/internal/v1/missions/:ref/release', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor || req.body?.actor || { id: 1, role: 'PICKER' };
      const result = releaseMission(db, req.params.ref, actor);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /internal/v1/missions/:ref/force-unassign
  router.post('/internal/v1/missions/:ref/force-unassign', (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.actor || req.body?.actor || { id: 1, role: 'MANAGER' };
      const { reasonCode, note } = req.body || {};
      if (!reasonCode) {
        throw new AppError('REASON_REQUIRED', 422, 'reasonCode is required');
      }
      const result = forceUnassignMission(db, req.params.ref, actor, reasonCode, note);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
