import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import type { Role } from '@dark-storage/shared';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: {
        id: number | string;
        role: Role;
        name: string;
        permissions?: readonly string[];
        zones?: string[] | null;
        shift?: string | null;
      } | null;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const reqId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  req.requestId = reqId;
  res.setHeader('X-Request-Id', reqId);
  next();
}
