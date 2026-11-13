import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useCan } from '../hooks/useCan.js';
import { useAuthStore } from '../stores/authStore.js';

interface RequirePermProps {
  perm: string | readonly string[];
  children: React.ReactNode;
}

export function getRoleWorkspace(role?: string): string {
  switch (role) {
    case 'MANAGER':
      return '/';
    case 'OPERATOR':
      return '/receiving';
    case 'PICKER':
      return '/picking';
    case 'STAFF':
      return '/packing';
    default:
      return '/';
  }
}

export const RequirePerm: React.FC<RequirePermProps> = ({ perm, children }) => {
  const allowed = useCan(perm);
  const { user } = useAuthStore();
  const navigate = useNavigate();

  if (!allowed) {
    const workspace = getRoleWorkspace(user?.role);
    return (
      <div style={{ padding: '2rem', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div
          data-testid="sod-403-card"
          style={{
            maxWidth: '520px',
            width: '100%',
            backgroundColor: 'var(--color-surface, #1e1e1e)',
            border: '2px solid var(--color-error, #cf6679)',
            borderRadius: '8px',
            padding: '24px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            fontFamily: 'monospace'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <span style={{ fontSize: '24px', color: 'var(--color-error, #cf6679)' }}>⚠</span>
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--color-error, #cf6679)', textTransform: 'uppercase' }}>
              403 — Segregation of Duties Restriction
            </h2>
          </div>
          <p style={{ color: 'var(--color-on-surface, #e0e0e0)', lineHeight: '1.5', marginBottom: '16px' }}>
            Your role <strong>({user?.role || 'ANONYMOUS'})</strong> does not have permission to access this floor or management resource.
          </p>
          <div style={{ backgroundColor: 'rgba(255,255,255,0.05)', padding: '10px 14px', borderRadius: '4px', marginBottom: '20px', fontSize: '0.85rem' }}>
            <div>Required Permission: <code>{Array.isArray(perm) ? perm.join(' OR ') : perm}</code></div>
          </div>
          <button
            type="button"
            data-testid="go-to-workspace-btn"
            onClick={() => navigate(workspace)}
            style={{
              width: '100%',
              padding: '12px 20px',
              backgroundColor: 'var(--color-primary, #6200ee)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              fontWeight: 'bold',
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}
          >
            Go to My Workspace
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
