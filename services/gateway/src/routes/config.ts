import { Router, Request, Response, NextFunction } from 'express';
import { can, Role } from '@dark-storage/shared';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { callEngine3 } from '../clients/engine3.js';

export const configRouter = Router();

configRouter.use(authMiddleware);

configRouter.get('/', requirePerm('config:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'GET',
      path: '/internal/v1/config',
      requestId: req.requestId
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

configRouter.put('/:key', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Check config key group from Engine 3
    const key = req.params.key;
    const allConfigRes = await callEngine3<Record<string, any>>({
      method: 'GET',
      path: '/internal/v1/config',
      requestId: req.requestId
    });

    const item = allConfigRes.data?.[key];
    const grp = item?.grp || 'THRESHOLD';
    const requiredPerm = grp === 'WEIGHT' ? 'config:weights' : 'config:thresholds';

    if (!can(req.user, requiredPerm)) {
      res.status(403).json({
        error: `Permission ${requiredPerm} required to modify ${grp} config`,
        code: 'FORBIDDEN',
        details: { required: requiredPerm }
      });
      return;
    }

    const result = await callEngine3({
      method: 'PUT',
      path: `/internal/v1/config/${encodeURIComponent(key)}`,
      body: {
        value: req.body?.value,
        actorId: req.user?.id
      },
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});
