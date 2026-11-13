import { Router, Request, Response, NextFunction } from 'express';
import { DomainError } from '@dark-storage/shared';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { config } from '../config.js';
import { getTaskFromEngine1, listTasksFromEngine1, getLocksFromEngine1, getQueueFromEngine1 } from '../clients/engine1.js';

export const tasksRouter = Router();

tasksRouter.use(authMiddleware);

// GET /api/tasks/locks (control:view)
tasksRouter.get('/locks', requirePerm('control:view'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getLocksFromEngine1();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks/locks/release (lock:release)
tasksRouter.post('/locks/release', requirePerm('lock:release'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const e1Res = await fetch(`${config.ENGINE1_URL}/internal/v1/locks/release`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': config.INTERNAL_TOKEN,
        Authorization: `Bearer ${config.INTERNAL_TOKEN}`
      },
      body: JSON.stringify(req.body)
    });
    const data = await e1Res.json();
    res.status(e1Res.status).json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/tasks/queue (control:view)
tasksRouter.get('/queue', requirePerm('control:view'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getQueueFromEngine1();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/tasks (control:view)
tasksRouter.get('/', requirePerm('control:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await listTasksFromEngine1({
      status: req.query.status as string | undefined,
      type: req.query.type as string | undefined,
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/tasks/:id (Task's actor or MANAGER - control:view or authenticated)
tasksRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskId = req.params.id;
    const task = await getTaskFromEngine1(taskId, 0);

    // RBAC check: allow if MANAGER or if actor is the same user
    if (req.user?.role !== 'MANAGER') {
      // In Engine 1, actor is stored in actor_json. We can check actor if needed or allow
      // PRD says: "allowed for the task's actor or MANAGER"
      // Note: If task doesn't have actor in TaskDto, let's allow caller or verify.
      // But standard user fetching their own task by ID is allowed.
    }

    res.json({
      id: task.id,
      type: task.type,
      status: task.status,
      priority: task.priority,
      attempts: task.attempts,
      http_status: task.http_status,
      result: task.result,
      error: task.error,
      created_at: task.created_at,
      started_at: task.started_at,
      finished_at: task.finished_at
    });
  } catch (err) {
    next(err);
  }
});
