import { useAuthStore } from '../stores/authStore.js';
import { can } from '@dark-storage/shared';

export function useCan(perm: string | readonly string[]): boolean {
  const { user, permissions } = useAuthStore();
  if (!user) return false;
  const userObj = {
    role: user.role,
    permissions: permissions && permissions.length > 0 ? permissions : user.permissions
  };
  const perms = Array.isArray(perm) ? perm : [perm];
  return perms.some((p) => can(userObj, p));
}
