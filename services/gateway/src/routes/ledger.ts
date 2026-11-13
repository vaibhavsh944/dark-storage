import { Router, Request, Response, NextFunction } from 'express';
import { callEngine3 } from '../clients/engine3.js';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';

export const ledgerRouter = Router();

ledgerRouter.use(authMiddleware);

// GET /api/ledger/reconcile
ledgerRouter.get('/reconcile', requirePerm('inventory:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.user ? { id: req.user.id, role: req.user.role } : null;
    const result = await callEngine3({
      method: 'GET',
      path: '/internal/v1/ledger/reconcile',
      requestId: req.requestId,
      actor
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/ledger?sku&location&orderRef&limit
ledgerRouter.get('/', requirePerm('inventory:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = new URLSearchParams(req.query as Record<string, string>).toString();
    const actor = req.user ? { id: req.user.id, role: req.user.role } : null;
    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/ledger?${query}`,
      requestId: req.requestId,
      actor
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});
