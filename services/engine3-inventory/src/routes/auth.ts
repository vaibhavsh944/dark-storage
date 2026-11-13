import { Router } from 'express';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { DomainError, loginRequestSchema, ROLE_PERMISSIONS, Role } from '@dark-storage/shared';

export function createAuthRouter(db: Database.Database): Router {
  const router = Router();

  router.post('/internal/v1/auth/verify', (req, res, next) => {
    try {
      const { username, password } = loginRequestSchema.parse(req.body);

      const cols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(c => c.name);
      const hasZones = cols.includes('zones');
      const hasShift = cols.includes('shift');

      const user = db.prepare(`
        SELECT id, username, display_name, password_hash, role, active
               ${hasZones ? ', zones' : ''}
               ${hasShift ? ', shift' : ''}
        FROM users
        WHERE username = ? COLLATE NOCASE
      `).get(username) as any;

      if (!user || user.active !== 1) {
        throw new DomainError('UNAUTHENTICATED', 'Invalid username or password');
      }

      const match = bcrypt.compareSync(password, user.password_hash);
      if (!match) {
        throw new DomainError('UNAUTHENTICATED', 'Invalid username or password');
      }

      let parsedZones: string[] = [];
      if (user.zones) {
        try {
          parsedZones = typeof user.zones === 'string' ? JSON.parse(user.zones) : user.zones;
        } catch {
          parsedZones = [];
        }
      }

      const role = user.role as Role;
      const permissions = ROLE_PERMISSIONS[role] ? [...ROLE_PERMISSIONS[role]] : [];

      res.json({
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        zones: parsedZones,
        shift: user.shift || 'MORNING',
        permissions
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/internal/v1/auth/user-by-username', (req, res, next) => {
    try {
      const { username } = req.body;
      const cols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(c => c.name);
      const hasZones = cols.includes('zones');
      const hasShift = cols.includes('shift');

      const user = db.prepare(`
        SELECT id, username, display_name, role, active
               ${hasZones ? ', zones' : ''}
               ${hasShift ? ', shift' : ''}
        FROM users
        WHERE username = ? COLLATE NOCASE
      `).get(username) as any;

      if (!user || user.active !== 1) {
        throw new DomainError('NOT_FOUND', `User ${username} not found`);
      }

      let parsedZones: string[] = [];
      if (user.zones) {
        try {
          parsedZones = typeof user.zones === 'string' ? JSON.parse(user.zones) : user.zones;
        } catch {
          parsedZones = [];
        }
      }

      const role = user.role as Role;
      const permissions = ROLE_PERMISSIONS[role] ? [...ROLE_PERMISSIONS[role]] : [];

      res.json({
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        zones: parsedZones,
        shift: user.shift || 'MORNING',
        permissions
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
