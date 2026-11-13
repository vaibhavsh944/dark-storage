import React, { useState, useCallback, useRef } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore.js';
import { useRealtime } from '../hooks/useRealtime.js';
import { useRealtimeStore } from '../stores/realtimeStore.js';
import { useHotkeys } from '../hooks/useHotkeys.js';
import { useCan } from '../hooks/useCan.js';
import { getRoleWorkspace } from './RequirePerm.js';
import { apiFetch } from '../api/client.js';
import { AuthResponse } from '@dark-storage/shared';

interface AppShellProps {
  navLinks?: Array<{ to: string; label: string; testId: string; hotkey?: string }>;
}

const roleAccounts: Record<string, { username: string; label: string }> = {
  MANAGER: { username: 'manager1', label: 'Manager' },
  OPERATOR: { username: 'operator1', label: 'Operator' },
  PICKER: { username: 'picker1', label: 'Picker' },
  STAFF: { username: 'staff1', label: 'Staff' }
};

export const AppShell: React.FC<AppShellProps> = ({ navLinks }) => {
  const { user, login, logout } = useAuthStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useRealtime();
  const { connected, statusText } = useRealtimeStore();
  const [switchingRole, setSwitchingRole] = useState(false);

  // Permissions for sidebar links
  const canControl = useCan('control:view');
  const canReceive = useCan('inbound:receive');
  const canInventory = useCan('inventory:view');
  const canOrders = useCan('order:view');
  const canPick = useCan('pick:execute');
  const canPack = useCan('pack:execute');
  const canException = useCan('exception:view');
  const canAudit = useCan('audit:view');

  // Keyboard shortcut help modal & toast states
  const [helpOpen, setHelpOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimeoutRef.current = null;
    }, 2000);
  }, []);

  const handleNavigate = useCallback((path: string) => {
    navigate(path);
  }, [navigate]);

  const handleToggleHelp = useCallback(() => {
    setHelpOpen((prev) => !prev);
  }, []);

  // Bind global keyboard shortcuts
  useHotkeys({
    userRole: user?.role,
    canPick,
    onNavigate: handleNavigate,
    onShowToast: showToast,
    onToggleHelp: handleToggleHelp
  });

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleRoleSwitch = async (targetRole: string) => {
    const account = roleAccounts[targetRole];
    if (!account || account.username === user?.username || switchingRole) return;
    setSwitchingRole(true);
    try {
      const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';
      const endpoint = isDemo ? '/api/auth/dev-switch' : '/api/auth/login';
      const body = isDemo
        ? JSON.stringify({ username: account.username })
        : JSON.stringify({ username: account.username, password: '' });

      const resp = await apiFetch<AuthResponse>(endpoint, {
        method: 'POST',
        body
      });
      login(resp.token, resp.user, resp.permissions);
      queryClient.clear();
      navigate(getRoleWorkspace(resp.user.role));
    } catch (err) {
      console.error('Role switch failed:', err);
    } finally {
      setSwitchingRole(false);
    }
  };

  const defaultLinks = [
    ...(canControl ? [{ to: '/', label: 'Home', testId: 'nav-home', hotkey: 'Alt+H' }] : []),
    ...(canReceive ? [{ to: '/receiving', label: 'Receiving', testId: 'nav-receiving' }] : []),
    ...(canInventory ? [{ to: '/inventory', label: 'Inventory', testId: 'nav-inventory', hotkey: 'Alt+I' }] : []),
    ...(canOrders ? [{ to: '/orders', label: 'Orders', testId: 'nav-orders', hotkey: 'Alt+O' }] : []),
    ...(canPick ? [{ to: '/picking', label: 'Picking', testId: 'nav-picking', hotkey: 'Alt+P' }] : []),
    ...(canPack ? [{ to: '/packing', label: 'Packing', testId: 'nav-packing' }] : []),
    ...(canException ? [{ to: '/exceptions', label: 'Exceptions', testId: 'nav-exceptions' }] : []),
    ...(canInventory ? [{ to: '/warehouse', label: 'Warehouse', testId: 'nav-warehouse', hotkey: 'Alt+W' }] : []),
    ...(canControl ? [{ to: '/tasks', label: 'Tasks', testId: 'nav-tasks' }] : []),
    ...(canAudit ? [{ to: '/admin', label: 'Admin', testId: 'nav-admin' }] : [])
  ];

  const links = navLinks || defaultLinks;

  return (
    <div className="app-container">
      <header className="header">
        <div className="header-brand">
          <span className="header-brand-icon">DS</span>
          <span>Dark Storage WMS</span>
        </div>
        <div className="header-actions">
          <span
            className={`badge ${connected ? 'badge-ok' : 'badge-warning'}`}
            data-testid="ws-status"
          >
            {connected ? 'Live' : statusText || 'Reconnecting…'}
          </span>

          {/* Quick Top Bar Role Switcher - Demo Mode Only */}
          {import.meta.env.VITE_DEMO_MODE === 'true' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>
                Role:
              </span>
              <select
                className="select"
                value={user?.role || 'MANAGER'}
                onChange={(e) => handleRoleSwitch(e.target.value)}
                disabled={switchingRole}
                style={{
                  padding: '4px 10px',
                  fontSize: '12px',
                  height: '32px',
                  borderRadius: 'var(--radius-pill)',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
                title="Switch role instantly"
                data-testid="header-role-switcher"
              >
                <option value="MANAGER">👔 Manager</option>
                <option value="OPERATOR">⚙️ Operator</option>
                <option value="PICKER">📦 Picker</option>
                <option value="STAFF">📋 Staff</option>
              </select>
            </div>
          )}

          {/* Keyboard Shortcuts Trigger Button */}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setHelpOpen(true)}
            title="Keyboard Shortcuts (Alt+/ or ?)"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              padding: 0,
              borderRadius: 'var(--radius-full, 9999px)',
              fontWeight: 700,
              fontSize: '14px'
            }}
          >
            ?
          </button>

          {user && (
            <span className="user-badge" data-testid="header-user">
              {user.display_name} · {user.role}
            </span>
          )}
          <button className="btn btn-secondary" onClick={handleLogout} data-testid="logout-btn">
            Logout
          </button>
        </div>
      </header>
      <div className="main-body">
        <aside className="sidebar">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              data-testid={link.testId}
              aria-keyshortcuts={link.hotkey}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <span>{link.label}</span>
              {link.hotkey && (
                <kbd className="nav-kbd">{link.hotkey}</kbd>
              )}
            </NavLink>
          ))}
        </aside>
        <main className="content-area">
          <Outlet />
        </main>
      </div>

      {/* 2-Second Toast for Unauthorized Roles */}
      {toastMessage && (
        <div className="hotkey-toast" role="alert">
          <span>⚠</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Shortcut Help Dialog */}
      {helpOpen && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 10000,
            backdropFilter: 'blur(2px)'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setHelpOpen(false);
          }}
        >
          <div
            className="modal-card"
            data-testid="shortcut-help"
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg, 12px)',
              width: '90%',
              maxWidth: '480px',
              padding: '24px',
              boxShadow: 'var(--shadow-lg)'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid var(--border-color)',
                paddingBottom: '12px',
                marginBottom: '16px'
              }}
            >
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>
                ⌨️ Keyboard Shortcuts
              </h3>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setHelpOpen(false)}
                style={{ padding: '4px 8px' }}
              >
                ✕
              </button>
            </div>

            <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              Press the combination below from anywhere to navigate quickly without using the mouse:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: '6px'
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: 600 }}>Warehouse (3D Twin / Cards)</span>
                <kbd className="nav-kbd" style={{ fontSize: '11px', padding: '3px 8px' }}>Alt+W</kbd>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: '6px'
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: 600 }}>Inventory Management</span>
                <kbd className="nav-kbd" style={{ fontSize: '11px', padding: '3px 8px' }}>Alt+I</kbd>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: '6px'
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: 600 }}>Orders &amp; Allocations</span>
                <kbd className="nav-kbd" style={{ fontSize: '11px', padding: '3px 8px' }}>Alt+O</kbd>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: '6px'
                }}
              >
                <div>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>Picking Operations</span>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Managers &amp; Pickers only</div>
                </div>
                <kbd className="nav-kbd" style={{ fontSize: '11px', padding: '3px 8px' }}>Alt+P</kbd>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: '6px'
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: 600 }}>Home Operations Dashboard</span>
                <kbd className="nav-kbd" style={{ fontSize: '11px', padding: '3px 8px' }}>Alt+H</kbd>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: '6px'
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: 600 }}>Toggle Shortcut Cheat Sheet</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <kbd className="nav-kbd" style={{ fontSize: '11px', padding: '3px 8px' }}>?</kbd>
                  <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>or</span>
                  <kbd className="nav-kbd" style={{ fontSize: '11px', padding: '3px 8px' }}>Alt+/</kbd>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '20px', textAlign: 'right' }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setHelpOpen(false)}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
