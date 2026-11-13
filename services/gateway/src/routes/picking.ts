import { Router, Request, Response, NextFunction } from 'express';
import { DomainError, reportProblemSchema } from '@dark-storage/shared';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { callEngine3 } from '../clients/engine3.js';

export const pickStopsRouter = Router();

pickStopsRouter.use(authMiddleware);

// POST /api/pick-stops/:stop_ref/confirm - 410 ENDPOINT_REMOVED (D11 shortcut)
pickStopsRouter.post('/:stop_ref/confirm', (req: Request, res: Response) => {
  res.status(410).json({
    error: 'Endpoint removed for Segregation of Duties',
    code: 'ENDPOINT_REMOVED',
    details: { replacement: '/api/pick-stops/:stopRef/scan-bin' }
  });
});

// POST /api/pick-stops/:stop_ref/exception (exception:raise) - PROXY
pickStopsRouter.post(
  '/:stop_ref/exception',
  requirePerm('exception:raise'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
      if (!key) {
        throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
      }

      const parsed = reportProblemSchema.parse(req.body);

      // Verify ownership
      const stopRes = await callEngine3<any>({
        method: 'GET',
        path: `/internal/v1/pick-stops/${req.params.stop_ref}`,
        requestId: req.requestId
      });

      const stop = stopRes.data;
      if (!stop) {
        throw new DomainError('NOT_FOUND', `Stop ${req.params.stop_ref} not found`);
      }

      if (req.user!.role === 'PICKER' && stop.picker_id !== req.user!.id) {
        throw new DomainError('NOT_YOUR_MISSION', 'You do not own this mission');
      }

      const actor = {
        id: req.user!.id,
        role: req.user!.role,
        display_name: req.user!.name
      };

      const result = await callEngine3({
        method: 'POST',
        path: `/internal/v1/pick-stops/${req.params.stop_ref}/exception`,
        body: parsed,
        requestId: req.requestId,
        actor,
        idempotencyKey: key
      });

      res.status(result.status).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/pick-stops/:stopRef/scan-bin (pick:execute)
pickStopsRouter.post(
  '/:stopRef/scan-bin',
  requirePerm('pick:execute'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
      if (!key) {
        throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
      }

      const actor = {
        id: req.user!.id,
        name: req.user!.name,
        role: req.user!.role
      };

      const result = await callEngine3({
        method: 'POST',
        path: `/internal/v1/pick-stops/${req.params.stopRef}/scan-bin`,
        body: req.body,
        requestId: req.requestId,
        actor,
        idempotencyKey: key
      });

      res.status(result.status).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/pick-stops/:stopRef/scan-item (pick:execute)
pickStopsRouter.post(
  '/:stopRef/scan-item',
  requirePerm('pick:execute'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
      if (!key) {
        throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
      }

      const actor = {
        id: req.user!.id,
        name: req.user!.name,
        role: req.user!.role
      };

      const result = await callEngine3({
        method: 'POST',
        path: `/internal/v1/pick-stops/${req.params.stopRef}/scan-item`,
        body: req.body,
        requestId: req.requestId,
        actor,
        idempotencyKey: key
      });

      res.status(result.status).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/pick-stops/:stopRef/scan-tote (pick:execute)
pickStopsRouter.post(
  '/:stopRef/scan-tote',
  requirePerm('pick:execute'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
      if (!key) {
        throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
      }

      const actor = {
        id: req.user!.id,
        name: req.user!.name,
        role: req.user!.role
      };

      const result = await callEngine3({
        method: 'POST',
        path: `/internal/v1/pick-stops/${req.params.stopRef}/scan-tote`,
        body: req.body,
        requestId: req.requestId,
        actor,
        idempotencyKey: key
      });

      res.status(result.status).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);
