import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { callEngine3 } from '../clients/engine3.js';

export const productsRouter = Router();

productsRouter.use(authMiddleware, requirePerm('inventory:view'));

productsRouter.get('/', async (req, res, next) => {
  try {
    const qs = new URLSearchParams(req.query as Record<string, string>).toString();
    const path = `/internal/v1/products${qs ? `?${qs}` : ''}`;

    const { data } = await callEngine3({
      method: 'GET',
      path,
      requestId: req.requestId,
      actor: req.user
    });

    res.json(data);
  } catch (err) {
    next(err);
  }
});

productsRouter.get('/:sku', async (req, res, next) => {
  try {
    const { data } = await callEngine3({
      method: 'GET',
      path: `/internal/v1/products/${encodeURIComponent(req.params.sku)}`,
      requestId: req.requestId,
      actor: req.user
    });

    res.json(data);
  } catch (err) {
    next(err);
  }
});
