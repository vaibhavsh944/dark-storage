import { Router, Request, Response, NextFunction } from 'express';
import { DomainError, resolveExceptionSchema, exceptionQuerySchema } from '@dark-storage/shared';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { runViaEngine1 } from '../clients/engine1.js';
import { callEngine2 } from '../clients/engine2.js';
import { callEngine3 } from '../clients/engine3.js';

export const exceptionsRouter = Router();

exceptionsRouter.use(authMiddleware);

// GET /api/exceptions?status=&mission=&page= (exception:view)
exceptionsRouter.get('/', requirePerm('exception:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const queryParams = new URLSearchParams(req.query as Record<string, string>);

    if (req.user!.role === 'PICKER') {
      queryParams.set('picker_id', String(req.user!.id));
    }

    const result = await callEngine3({
      method: 'GET',
      path: `/internal/v1/exceptions?${queryParams.toString()}`,
      requestId: req.requestId
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// GET /api/exceptions/:ref (exception:view)
exceptionsRouter.get('/:ref', requirePerm('exception:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await callEngine3<any>({
      method: 'GET',
      path: `/internal/v1/exceptions/${req.params.ref}`,
      requestId: req.requestId
    });

    const exc = result.data;
    if (!exc) {
      throw new DomainError('NOT_FOUND', `Exception ${req.params.ref} not found`);
    }

    if (req.user!.role === 'PICKER' && exc.reported_by !== req.user!.id) {
      throw new DomainError('FORBIDDEN', 'Access denied to this exception');
    }

    res.status(result.status).json(result.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/exceptions/:ref/resolve (exception:resolve) - ORCH + E1
exceptionsRouter.post(
  '/:ref/resolve',
  requirePerm('exception:resolve'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = (req.headers['idempotency-key'] as string) || (req.headers['x-idempotency-key'] as string);
      if (!key) {
        throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
      }

      const parsed = resolveExceptionSchema.parse(req.body);

      // Load exception to find SKU and mission
      const excRes = await callEngine3<any>({
        method: 'GET',
        path: `/internal/v1/exceptions/${req.params.ref}`,
        requestId: req.requestId
      });

      const exc = excRes.data;
      if (!exc) {
        throw new DomainError('NOT_FOUND', `Exception ${req.params.ref} not found`);
      }

      const sku = exc.sku.toUpperCase();

      const actor = {
        id: req.user!.id,
        role: req.user!.role,
        display_name: req.user!.name,
        name: req.user!.name
      };

      const result = await runViaEngine1({
        type: 'EXCEPTION_RESOLVE',
        priority: 2,
        key,
        actor,
        payload: {
          ...parsed,
          exception_ref: req.params.ref
        },
        resources: [`sku:${sku}`]
      });

      // Best-effort reroute if REALLOCATE created new stops
      const resData = result.data as any;
      if (
        result.status >= 200 &&
        result.status < 300 &&
        parsed.action === 'REALLOCATE' &&
        resData?.new_stops?.length > 0
      ) {
        try {
          const missionRef = exc.mission_ref;
          const inputRes = await callEngine3<any>({
            method: 'GET',
            path: `/internal/v1/missions/${missionRef}/reroute-input`,
            requestId: req.requestId
          });

          if (inputRes.status === 200 && inputRes.data?.pending?.length > 0) {
            const planStops = inputRes.data.pending.map((p: any) => ({
              key: p.key,
              bin_code: p.bin_code,
              node: p.node,
              shelf_code: p.shelf_code,
              level: p.level
            }));

            const routeRes = await callEngine2<any>({
              method: 'POST',
              path: '/internal/v1/routes/plan',
              body: {
                start: inputRes.data.start_node || 'DOCK',
                end: 'PACK',
                stops: planStops
              },
              requestId: req.requestId
            });

            if (routeRes.status === 200 && routeRes.data?.order) {
              await callEngine3({
                method: 'POST',
                path: `/internal/v1/missions/${missionRef}/reroute`,
                body: {
                  route: routeRes.data,
                  ordered_stop_ids: routeRes.data.order.map((k: any) => Number(k))
                },
                requestId: req.requestId
              });
            }
          }
        } catch {
          // Best-effort: skip silently on failure
        }
      }

      res.status(result.status).json(result.data);
    } catch (err) {
      next(err);
    }
  }
);
