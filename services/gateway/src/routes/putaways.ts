import { Router, Request, Response, NextFunction } from 'express';
import { DomainError, createPutawaySchema, shelfOfBin } from '@dark-storage/shared';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { runViaEngine1 } from '../clients/engine1.js';
import { callEngine3 } from '../clients/engine3.js';

export const putawaysRouter = Router();

putawaysRouter.use(authMiddleware);

// POST /api/putaways or /api/putaway (putaway:execute - OPERATOR only)
putawaysRouter.post('/', requirePerm('putaway:execute'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
    if (!key) {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    }

    const parsed = createPutawaySchema.parse(req.body);
    const destShelf = shelfOfBin(parsed.dest_bin);
    const resources = [`shelf:${destShelf}`];

    const actor = {
      id: req.user!.id,
      display_name: req.user!.name || (req.user as any).display_name || 'Operator',
      name: req.user!.name,
      role: req.user!.role
    };

    const result = await runViaEngine1({
      type: 'PUTAWAY',
      priority: 2, // NORMAL
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

// GET /api/putaways?receipt=&sku=&page= (inbound:receive or po:view)
putawaysRouter.get('/', requirePerm(['inbound:receive', 'po:view']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = new URLSearchParams(req.query as Record<string, string>).toString();
    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/putaways?${query}`,
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});
