import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, DomainError, StateError } from '@dark-storage/shared';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  const requestId = req.requestId || (req.headers['x-request-id'] as string) || 'unknown';

  if (err instanceof StateError) {
    res.status(409).json({
      error: err.message,
      code: err.code,
      details: err.details
    });
    return;
  }

  if (err instanceof AppError && err.constructor.name === 'AppError') {
    res.status(err.httpStatus).json({
      error: err.message,
      code: err.code,
      details: err.details
    });
    return;
  }

  if (err instanceof DomainError) {
    res.status(err.httpStatus).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        request_id: requestId
      },
      code: err.code,
      details: err.details
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: { issues: err.issues },
        request_id: requestId
      },
      code: 'VALIDATION_ERROR',
      details: { issues: err.issues }
    });
    return;
  }

  // Check for SQLite trigger error codes matching DomainError codes
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: string }).message === 'string') {
    const msg = (err as { message: string }).message;
    const match = msg.match(/\b(CAPACITY_EXCEEDED|SKU_CONFLICT|BIN_NOT_RECEIVABLE|STORAGE_CLASS_MISMATCH|AUDIT_LOG_IS_APPEND_ONLY|STOCK_MOVEMENTS_ARE_APPEND_ONLY)\b/);
    if (match) {
      const code = match[1];
      if (code === 'CAPACITY_EXCEEDED' || code === 'SKU_CONFLICT' || code === 'BIN_NOT_RECEIVABLE' || code === 'STORAGE_CLASS_MISMATCH') {
        res.status(409).json({
          error: {
            code,
            message: msg,
            request_id: requestId
          },
          code
        });
        return;
      }
    }
  }

  console.error(`[Internal Error] [${requestId}]`, err);

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      request_id: requestId
    },
    code: 'INTERNAL_ERROR'
  });
}
