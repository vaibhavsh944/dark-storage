import { Router, Request, Response, NextFunction } from 'express';
import { DomainError, createOrderSchema, cancelOrderSchema, reassignMissionSchema } from '@dark-storage/shared';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { runViaEngine1 } from '../clients/engine1.js';
import { callEngine3 } from '../clients/engine3.js';

export const ordersRouter = Router();

ordersRouter.use(authMiddleware);

// POST /api/orders (order:create) - E1
ordersRouter.post('/', requirePerm('order:create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
    if (!key) {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    }

    const parsed = createOrderSchema.parse(req.body);
    const resources = Array.from(new Set(parsed.lines.map((l) => `sku:${l.sku.toUpperCase()}`))).sort();

    const priorityMap: Record<string, number> = {
      LOW: 1,
      NORMAL: 2,
      HIGH: 3,
      URGENT: 4
    };
    const priority = priorityMap[parsed.priority] || 2;

    const actor = {
      id: req.user!.id,
      display_name: req.user!.name,
      name: req.user!.name,
      role: req.user!.role
    };

    const result = await runViaEngine1({
      type: 'RESERVE_ORDER',
      priority,
      key,
      actor,
      payload: parsed,
      resources
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/orders/:ref/cancel (order:cancel) - PROXY
ordersRouter.post('/:ref/cancel', requirePerm('order:cancel'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
    if (!key) {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    }

    const parsed = cancelOrderSchema.parse(req.body);

    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/orders/${req.params.ref}/cancel`,
      body: parsed,
      requestId: req.requestId,
      actor: { id: req.user!.id, role: req.user!.role },
      idempotencyKey: key
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/orders/:ref/assign - 410 ENDPOINT_REMOVED (D11 shortcut)
ordersRouter.post('/:ref/assign', (req: Request, res: Response) => {
  res.status(410).json({
    error: 'Endpoint removed for Segregation of Duties',
    code: 'ENDPOINT_REMOVED',
    details: { replacement: '/api/missions/claim-next' }
  });
});

// POST /api/orders/:ref/reassign (mission:reassign)
ordersRouter.post('/:ref/reassign', requirePerm('mission:reassign'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
    if (!key) {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    }

    const parsed = reassignMissionSchema.parse(req.body);
    const actor = { id: req.user!.id, role: req.user!.role, display_name: req.user!.name };

    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/orders/${req.params.ref}/reassign`,
      body: parsed,
      requestId: req.requestId,
      actor,
      idempotencyKey: key
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/orders (order:view)
ordersRouter.get('/', requirePerm('order:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = new URLSearchParams(req.query as Record<string, string>).toString();
    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/orders?${query}`,
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/orders/:ref (order:view)
ordersRouter.get('/:ref', requirePerm('order:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/orders/${req.params.ref}`,
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/orders/:ref/pack - 410 ENDPOINT_REMOVED (D11 shortcut)
ordersRouter.post('/:ref/pack', (req: Request, res: Response) => {
  res.status(410).json({
    error: 'Endpoint removed for Segregation of Duties',
    code: 'ENDPOINT_REMOVED',
    details: { replacement: '/api/packing/open' }
  });
});
