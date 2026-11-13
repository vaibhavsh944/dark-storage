import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { callEngine3 } from '../clients/engine3.js';

export const usersRouter = Router();

usersRouter.use(authMiddleware);

// GET /api/users?role=PICKER (user:manage)
usersRouter.get('/', requirePerm('user:manage'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = req.query.role as string;
    if (role === 'PICKER') {
      const result = await callEngine3<any>({
        method: 'GET',
        path: '/internal/v1/pickers',
        requestId: req.requestId
      });
      res.json({ users: result.data.pickers, pickers: result.data.pickers });
      return;
    }

    res.json({ users: [] });
  } catch (err) {
    next(err);
  }
});
