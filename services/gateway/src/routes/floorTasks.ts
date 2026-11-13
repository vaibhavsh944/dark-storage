import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { callEngine3 } from '../clients/engine3.js';

export const floorTasksRouter = Router();

floorTasksRouter.use(authMiddleware);

// GET /api/floor-tasks
floorTasksRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = {
      id: req.user!.id,
      name: req.user!.name,
      role: req.user!.role,
      permissions: req.user!.permissions
    };

    const queryParams = new URLSearchParams(req.query as Record<string, string>);

    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/floor-tasks?${queryParams.toString()}`,
      requestId: req.requestId,
      actor
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/floor-tasks/:ref/claim
floorTasksRouter.post('/:ref/claim', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = {
      id: req.user!.id,
      name: req.user!.name,
      role: req.user!.role,
      permissions: req.user!.permissions
    };

    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/floor-tasks/${req.params.ref}/claim`,
      requestId: req.requestId,
      actor
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/floor-tasks/:ref/heartbeat
floorTasksRouter.post('/:ref/heartbeat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = {
      id: req.user!.id,
      name: req.user!.name,
      role: req.user!.role,
      permissions: req.user!.permissions
    };

    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/floor-tasks/${req.params.ref}/heartbeat`,
      requestId: req.requestId,
      actor
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/floor-tasks/:ref/release
floorTasksRouter.post('/:ref/release', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = {
      id: req.user!.id,
      name: req.user!.name,
      role: req.user!.role,
      permissions: req.user!.permissions
    };

    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/floor-tasks/${req.params.ref}/release`,
      requestId: req.requestId,
      actor
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});
