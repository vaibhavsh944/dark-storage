import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { callEngine3 } from '../clients/engine3.js';

export const pickerRouter = Router();

pickerRouter.use(authMiddleware);

// GET /api/picker/mission (pick:execute)
pickerRouter.get('/mission', requirePerm('pick:execute'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = {
      id: req.user!.id,
      name: req.user!.name,
      role: req.user!.role,
      permissions: req.user!.permissions
    };

    const result = await callEngine3({
      method: 'GET',
      path: '/internal/v1/picker/mission',
      requestId: req.requestId,
      actor
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});
