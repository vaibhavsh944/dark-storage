import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { config } from '../config.js';
import { callEngine3 } from '../clients/engine3.js';

export const dashboardRouter = Router();

// GET /api/dashboard (all authenticated roles)
dashboardRouter.get('/dashboard', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const e3Res = await callEngine3<any>({
      method: 'GET',
      path: '/internal/v1/dashboard',
      requestId: req.requestId
    });

    let engineStats = null;
    try {
      const e1Url = `${config.ENGINE1_URL}/internal/v1/stats`;
      const e1Res = await fetch(e1Url, {
        headers: {
          'x-internal-token': config.INTERNAL_TOKEN,
          Authorization: `Bearer ${config.INTERNAL_TOKEN}`
        }
      });
      if (e1Res.ok) {
        engineStats = await e1Res.json();
      }
    } catch {
      engineStats = null;
    }

    res.json({
      ...e3Res.data,
      engine: engineStats
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/audit/verify (audit:verify)
dashboardRouter.get('/audit/verify', authMiddleware, requirePerm('audit:verify'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'GET',
      path: '/internal/v1/audit/verify',
      requestId: req.requestId,
      actor: { id: req.user!.id, role: req.user!.role, username: req.user!.name }
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/audit/export (audit:export)
dashboardRouter.get('/audit/export', authMiddleware, requirePerm('audit:export'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const queryParams = new URLSearchParams(req.query as Record<string, string>);
    const result = await callEngine3<string>({
      method: 'GET',
      path: `/internal/v1/audit/export?${queryParams.toString()}`,
      requestId: req.requestId,
      actor: { id: req.user!.id, role: req.user!.role, username: req.user!.name }
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit_log.csv"');
    res.status(result.status).send(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/audit (audit:view)
dashboardRouter.get('/audit', authMiddleware, requirePerm('audit:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const queryParams = new URLSearchParams(req.query as Record<string, string>);
    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/audit?${queryParams.toString()}`,
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/integrity (audit:view)
dashboardRouter.get('/admin/integrity', authMiddleware, requirePerm('audit:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3({
      method: 'GET',
      path: '/internal/v1/integrity',
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});
