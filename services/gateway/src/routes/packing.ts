import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { callEngine3 } from '../clients/engine3.js';

export const packingRouter = Router();

packingRouter.use(authMiddleware);

// GET /api/packing/queue (pack:execute or dispatch:view)
packingRouter.get('/queue', requirePerm(['pack:execute', 'dispatch:view']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'GET',
      path: '/internal/v1/packing/queue',
      requestId: req.requestId
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/packing/:ref/pack - 410 ENDPOINT_REMOVED (D11 shortcut)
packingRouter.post('/:ref/pack', (req: Request, res: Response) => {
  res.status(410).json({
    error: 'Endpoint removed for Segregation of Duties',
    code: 'ENDPOINT_REMOVED',
    details: { replacement: '/api/packing/open' }
  });
});
