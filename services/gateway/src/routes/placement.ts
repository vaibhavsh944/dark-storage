import { Router, Request, Response, NextFunction } from 'express';
import {
  RecommendPlacementSchema,
  ValidatePlacementSchema,
  DomainError
} from '@dark-storage/shared';
import { callEngine3 } from '../clients/engine3.js';
import { callEngine2 } from '../clients/engine2.js';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';

export const placementRouter = Router();

placementRouter.use(authMiddleware);

// POST /api/placement/recommend (putaway:execute - OPERATOR only)
placementRouter.post('/recommend', requirePerm('putaway:execute'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = RecommendPlacementSchema.parse(req.body);

    // 1. Load staged line from Engine 3
    const lineRes = await callEngine3<any>({
      method: 'GET',
      path: `/internal/v1/receipts/lines/${parsed.receipt_line_id}`,
      requestId: req.requestId
    });

    const line = lineRes.data;

    // 2. Validate qty
    const requestedQty = parsed.qty ?? line.qty_staged;
    if (requestedQty <= 0 || requestedQty > line.qty_staged) {
      throw new DomainError('QUANTITY_INVALID', `Quantity ${requestedQty} exceeds staged quantity of ${line.qty_staged}`, {
        requested_qty: requestedQty,
        qty_staged: line.qty_staged
      });
    }

    // 3. Call Engine 2
    const engine2Res = await callEngine2<any>({
      method: 'POST',
      path: '/internal/v1/placement/recommend',
      body: {
        sku: line.sku,
        qty: requestedQty,
        allow_partial: true,
        include_all: parsed.include_all,
        max_alternatives: 10
      },
      requestId: req.requestId
    });

    // 4. Merge response
    res.json({
      receipt_line: {
        line_id: line.line_id,
        receipt_ref: line.receipt_ref,
        sku: line.sku,
        product_name: line.product_name,
        qty_staged: line.qty_staged
      },
      ...engine2Res.data
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/placement/validate (putaway:execute - OPERATOR only)
placementRouter.post('/validate', requirePerm('putaway:execute'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ValidatePlacementSchema.parse(req.body);
    let effectiveSku = parsed.sku;

    if (parsed.receipt_line_id !== undefined) {
      const lineRes = await callEngine3<any>({
        method: 'GET',
        path: `/internal/v1/receipts/lines/${parsed.receipt_line_id}`,
        requestId: req.requestId
      });
      const line = lineRes.data;
      if (parsed.qty > line.qty_staged) {
        throw new DomainError('QUANTITY_INVALID', `Quantity exceeds staged quantity of ${line.qty_staged}`);
      }
      effectiveSku = line.sku;
    }

    if (!effectiveSku) {
      throw new DomainError('VALIDATION_ERROR', 'SKU or valid receipt_line_id required');
    }

    const e2Res = await callEngine2<any>({
      method: 'POST',
      path: '/internal/v1/placement/validate',
      body: {
        bin: parsed.dest_bin,
        sku: effectiveSku,
        qty: parsed.qty,
        allow_partial: true
      },
      requestId: req.requestId
    });

    res.json(e2Res.data);
  } catch (err) {
    next(err);
  }
});

// POST /api/placement/evaluate (putaway:execute - alias to validate)
placementRouter.post('/evaluate', requirePerm('putaway:execute'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ValidatePlacementSchema.parse(req.body);
    let effectiveSku = parsed.sku;

    if (parsed.receipt_line_id !== undefined) {
      const lineRes = await callEngine3<any>({
        method: 'GET',
        path: `/internal/v1/receipts/lines/${parsed.receipt_line_id}`,
        requestId: req.requestId
      });
      const line = lineRes.data;
      if (parsed.qty > line.qty_staged) {
        throw new DomainError('QUANTITY_INVALID', `Quantity exceeds staged quantity of ${line.qty_staged}`);
      }
      effectiveSku = line.sku;
    }

    if (!effectiveSku) {
      throw new DomainError('VALIDATION_ERROR', 'SKU or valid receipt_line_id required');
    }

    const e2Res = await callEngine2<any>({
      method: 'POST',
      path: '/internal/v1/placement/validate',
      body: {
        bin: parsed.dest_bin,
        sku: effectiveSku,
        qty: parsed.qty,
        allow_partial: true
      },
      requestId: req.requestId
    });

    res.json(e2Res.data);
  } catch (err) {
    next(err);
  }
});
