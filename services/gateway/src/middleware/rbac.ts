import { Request, Response, NextFunction } from 'express';
import { can, type Role, ROLE_PERMISSIONS } from '@dark-storage/shared';

export function requirePerm(perm: string | readonly string[]): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
        details: { required: perm }
      });
      return;
    }

    const userWithPerms = {
      role: req.user.role as Role,
      permissions: req.user.permissions ?? (req.user.role ? (ROLE_PERMISSIONS[req.user.role as Role] as readonly string[]) : [])
    };

    const perms = Array.isArray(perm) ? perm : [perm];
    const allowed = perms.some((p) => can(userWithPerms, p));

    if (!allowed) {
      res.status(403).json({
        error: 'Forbidden',
        code: 'FORBIDDEN',
        details: { required: perm }
      });
      return;
    }

    next();
  };
}

export function rbacMiddleware(allowedRoles: Role[]): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role as Role)) {
      res.status(403).json({
        error: `Role ${req.user.role} not permitted for this action`,
        code: 'FORBIDDEN',
        details: { allowedRoles }
      });
      return;
    }

    next();
  };
}
