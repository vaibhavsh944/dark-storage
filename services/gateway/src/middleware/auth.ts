import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { DomainError, ROLE_PERMISSIONS, Role } from '@dark-storage/shared';
import { config } from '../config.js';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new DomainError('UNAUTHENTICATED', 'Missing or invalid Authorization header');
  }

  const token = authHeader.substring(7).trim();
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as {
      sub: string | number;
      role: string;
      name: string;
      permissions?: string[];
      zones?: string | string[];
      shift?: string;
    };

    const role = decoded.role as Role;
    const permissions = decoded.permissions ?? (role && ROLE_PERMISSIONS[role] ? [...ROLE_PERMISSIONS[role]] : []);

    let parsedZones: string[] = [];
    if (Array.isArray(decoded.zones)) {
      parsedZones = decoded.zones;
    } else if (typeof decoded.zones === 'string') {
      try {
        parsedZones = JSON.parse(decoded.zones);
      } catch {
        parsedZones = [];
      }
    }

    req.user = {
      id: decoded.sub,
      role,
      name: decoded.name,
      permissions,
      zones: parsedZones,
      shift: decoded.shift || 'MORNING'
    };
    next();
  } catch (err) {
    throw new DomainError('UNAUTHENTICATED', 'Invalid or expired token');
  }
}
