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

  console.error(`[Gateway Error] [${requestId}]`, err);

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      request_id: requestId
    },
    code: 'INTERNAL_ERROR'
  });
}
