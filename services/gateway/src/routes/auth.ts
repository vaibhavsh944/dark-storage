import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { loginRequestSchema, ROLE_PERMISSIONS, Role } from '@dark-storage/shared';
import { config } from '../config.js';
import { callEngine3 } from '../clients/engine3.js';
import { authMiddleware } from '../middleware/auth.js';

export const authRouter = Router();

authRouter.post('/api/auth/login', async (req, res, next) => {
  try {
    const { username, password } = loginRequestSchema.parse(req.body);

    const { data: user } = await callEngine3<{
      id: number;
      username: string;
      display_name: string;
      role: Role;
      zones?: string[];
      shift?: string;
      permissions?: string[];
    }>({
      method: 'POST',
      path: '/internal/v1/auth/verify',
      body: { username, password },
      requestId: req.requestId
    });

    const role = user.role as Role;
    const permissions = user.permissions ?? (role && ROLE_PERMISSIONS[role] ? [...ROLE_PERMISSIONS[role]] : []);
    const zones = user.zones ?? [];
    const shift = user.shift ?? 'MORNING';

    const token = jwt.sign(
      {
        sub: user.id,
        role: user.role,
        name: user.display_name,
        permissions,
        zones,
        shift
      },
      config.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        zones,
        shift
      },
      permissions
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/api/auth/dev-switch', async (req, res, next) => {
  try {
    if (process.env.DEMO_MODE !== 'true' || process.env.NODE_ENV === 'production') {
      res.status(403).json({
        error: 'Dev switch disabled',
        code: 'FORBIDDEN',
        details: { reason: 'DEMO_MODE not enabled' }
      });
      return;
    }

    const { username } = req.body;
    if (!username) {
      res.status(400).json({ error: 'Username required', code: 'VALIDATION_FAILED' });
      return;
    }

    const { data: user } = await callEngine3<{
      id: number;
      username: string;
      display_name: string;
      role: Role;
      zones?: string[];
      shift?: string;
      permissions?: string[];
    }>({
      method: 'POST',
      path: '/internal/v1/auth/user-by-username',
      body: { username },
      requestId: req.requestId
    });

    const role = user.role as Role;
    const permissions = user.permissions ?? (role && ROLE_PERMISSIONS[role] ? [...ROLE_PERMISSIONS[role]] : []);
    const zones = user.zones ?? [];
    const shift = user.shift ?? 'MORNING';

    const token = jwt.sign(
      {
        sub: user.id,
        role: user.role,
        name: user.display_name,
        permissions,
        zones,
        shift
      },
      config.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        zones,
        shift
      },
      permissions
    });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/api/auth/me', authMiddleware, (req, res) => {
  const role = req.user!.role as Role;
  const permissions = req.user!.permissions ?? (role && ROLE_PERMISSIONS[role] ? [...ROLE_PERMISSIONS[role]] : []);

  res.json({
    id: req.user!.id,
    display_name: req.user!.name,
    role: req.user!.role,
    user: {
      id: req.user!.id,
      username: req.user!.name,
      display_name: req.user!.name,
      role: req.user!.role,
      zones: req.user!.zones ?? [],
      shift: req.user!.shift ?? 'MORNING'
    },
    permissions
  });
});
