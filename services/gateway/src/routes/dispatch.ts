import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { callEngine3 } from '../clients/engine3.js';

export const dispatchRouter = Router();

dispatchRouter.use(authMiddleware);

// GET /api/dispatch/queue (dispatch:view or pack:execute)
dispatchRouter.get('/queue', requirePerm(['dispatch:view', 'pack:execute']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'GET',
      path: '/internal/v1/dispatch/queue',
      requestId: req.requestId
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/dispatch/:orderRef/handover (dispatch:handover - STAFF only)
dispatchRouter.post('/:orderRef/handover', requirePerm('dispatch:handover'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.user ? { id: req.user.id, username: req.user.name, role: req.user.role } : undefined;
    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/dispatch/${req.params.orderRef}/handover`,
      body: { ...req.body, actor },
      requestId: req.requestId
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/dispatch/:orderRef/regen-otp (dispatch:regen_otp - MANAGER only)
dispatchRouter.post('/:orderRef/regen-otp', requirePerm('dispatch:regen_otp'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = req.user ? { id: req.user.id, username: req.user.name, role: req.user.role } : undefined;
    const result = await callEngine3({
      method: 'POST',
      path: `/internal/v1/dispatch/${req.params.orderRef}/regen-otp`,
      body: { ...req.body, actor },
      requestId: req.requestId
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/dispatch/demo-otp/:orderRef (DEMO_MODE=true presentation helper)
dispatchRouter.get('/demo-otp/:orderRef', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/dispatch/demo-otp/${req.params.orderRef}`,
      requestId: req.requestId
    });
    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});
