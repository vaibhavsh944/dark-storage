import jwt from 'jsonwebtoken';
import { ROLE_PERMISSIONS, Role } from '@dark-storage/shared';
import { config } from '../../services/gateway/src/config.js';

export function makeToken(role: Role, id: number = 1, name: string = role.toLowerCase()): string {
  return jwt.sign(
    {
      sub: id,
      role,
      name,
      permissions: [...ROLE_PERMISSIONS[role]],
      zones: ['A', 'B'],
      shift: 'MORNING'
    },
    config.JWT_SECRET,
    { expiresIn: '1h' }
  );
}
