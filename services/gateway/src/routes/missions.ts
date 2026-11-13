import { Router, Request, Response, NextFunction } from 'express';
import { DomainError } from '@dark-storage/shared';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { callEngine3 } from '../clients/engine3.js';

export const missionsRouter = Router();

missionsRouter.use(authMiddleware);

// POST /api/missions/claim-next (mission:claim - PICKER only)
missionsRouter.post('/claim-next', requirePerm('mission:claim'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = {
      id: req.user!.id,
      name: req.user!.name,
      role: req.user!.role,
      permissions: req.user!.permissions
    };

    const result = await callEngine3({
      method: 'POST',
      path: '/internal/v1/missions/claim-next',
      requestId: req.requestId,
      actor
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/missions/:ref/heartbeat (pick:execute)
missionsRouter.post('/:ref/heartbeat', requirePerm('pick:execute'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = {
      id: req.user!.id,
      name: req.user!.name,
      role: req.user!.role
    };

    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/missions/${req.params.ref}/heartbeat`,
      requestId: req.requestId,
      actor
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/missions/:ref/release (mission:claim)
missionsRouter.post('/:ref/release', requirePerm('mission:claim'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = {
      id: req.user!.id,
      name: req.user!.name,
      role: req.user!.role
    };

    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/missions/${req.params.ref}/release`,
      requestId: req.requestId,
      actor
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/missions/:ref/force-unassign (mission:reassign - MANAGER only)
missionsRouter.post('/:ref/force-unassign', requirePerm('mission:reassign'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = {
      id: req.user!.id,
      name: req.user!.name,
      role: req.user!.role
    };

    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/missions/${req.params.ref}/force-unassign`,
      requestId: req.requestId,
      actor,
      body: req.body
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/missions/:ref/start (pick:execute - PICKER only)
missionsRouter.post('/:ref/start', requirePerm('pick:execute'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
    if (!key) {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    }

    const actor = {
      id: req.user!.id,
      role: req.user!.role,
      display_name: req.user!.name
    };

    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/missions/${req.params.ref}/start`,
      requestId: req.requestId,
      actor,
      idempotencyKey: key
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/missions?status=&picker_id=&page= (order:view or pick:execute)
missionsRouter.get('/', requirePerm(['order:view', 'pick:execute']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const queryParams = new URLSearchParams(req.query as Record<string, string>);

    // If caller has pick:execute and lacks order:view, restrict to own missions
    const perms = req.user?.permissions || [];
    if (perms.includes('pick:execute') && !perms.includes('order:view')) {
      queryParams.set('picker_id', String(req.user!.id));
    }

    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/missions?${queryParams.toString()}`,
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/missions/:ref (order:view or pick:execute)
missionsRouter.get('/:ref', requirePerm(['order:view', 'pick:execute']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3<any>({
      method: 'GET',
      path: `/internal/v1/missions/${req.params.ref}`,
      requestId: req.requestId
    });

    const perms = req.user?.permissions || [];
    if (perms.includes('pick:execute') && !perms.includes('order:view') && result.data?.picker?.id !== req.user!.id) {
      throw new DomainError('NOT_YOUR_MISSION', 'You do not have access to this mission');
    }

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});
