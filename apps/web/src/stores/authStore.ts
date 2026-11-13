import { create } from 'zustand';
import { Role, ROLE_PERMISSIONS } from '@dark-storage/shared';

export interface AuthUser {
  id: number | string;
  username: string;
  display_name: string;
  role: Role;
  zones?: string[];
  shift?: string;
  permissions?: string[];
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  permissions: string[];
  login: (token: string, user: AuthUser, permissions?: string[]) => void;
  logout: () => void;
}

const STORAGE_KEY = 'dark_storage_auth';

function getInitialState(): { token: string | null; user: AuthUser | null; permissions: string[] } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const role = parsed.user?.role as Role;
      const defaultPerms = role && ROLE_PERMISSIONS[role] ? [...ROLE_PERMISSIONS[role]] : [];
      return {
        token: parsed.token ?? null,
        user: parsed.user ?? null,
        permissions: parsed.permissions ?? parsed.user?.permissions ?? defaultPerms
      };
    }
  } catch {
    // ignore
  }
  return { token: null, user: null, permissions: [] };
}

export const useAuthStore = create<AuthState>((set) => ({
  ...getInitialState(),
  login: (token, user, explicitPermissions) => {
    const role = user.role as Role;
    const permissions = explicitPermissions ?? user.permissions ?? (role && ROLE_PERMISSIONS[role] ? [...ROLE_PERMISSIONS[role]] : []);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user, permissions }));
    set({ token, user, permissions });
  },
  logout: () => {
    sessionStorage.removeItem(STORAGE_KEY);
    set({ token: null, user: null, permissions: [] });
  }
}));
