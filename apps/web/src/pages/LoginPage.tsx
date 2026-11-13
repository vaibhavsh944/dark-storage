import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { AuthResponse } from '@dark-storage/shared';
import { getRoleWorkspace } from '../components/RequirePerm.js';

export const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Username and password are required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const resp = await apiFetch<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      login(resp.token, resp.user, resp.permissions);
      navigate(getRoleWorkspace(resp.user.role));
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'UNAUTHENTICATED') {
          setError('Wrong username or password');
        } else {
          setError(err.message);
        }
      } else {
        setError('Login failed. Please check connection.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (user: string) => {
    setUsername(user);
    setLoading(true);
    setError(null);

    try {
      const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';
      const endpoint = isDemo ? '/api/auth/dev-switch' : '/api/auth/login';
      const body = isDemo ? JSON.stringify({ username: user }) : JSON.stringify({ username: user, password: '' });
      const resp = await apiFetch<AuthResponse>(endpoint, {
        method: 'POST',
        body
      });
      login(resp.token, resp.user, resp.permissions);
      navigate(getRoleWorkspace(resp.user.role));
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'UNAUTHENTICATED') {
          setError('Wrong username or password');
        } else {
          setError(err.message);
        }
      } else {
        setError('Login failed. Please check connection.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div className="card" style={{ width: '100%', maxWidth: '420px', padding: '36px 32px' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ display: 'inline-flex', marginBottom: '12px' }}>
            <span className="header-brand-icon" style={{ width: '48px', height: '48px', fontSize: '20px', borderRadius: '16px' }}>DS</span>
          </div>
          <h2 style={{ fontSize: '1.45rem', fontWeight: 800 }}>Dark Storage WMS</h2>
          <p className="m3-subtitle" style={{ fontSize: '0.88rem' }}>Warehouse Operations & Inventory Control</p>
        </div>

        {/* 4 Quick Role Login Buttons */}
        <div style={{ marginBottom: '20px' }}>
          <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '10px', fontWeight: 700 }}>
            Quick 1-Click Role Login
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '9px 12px', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              onClick={() => handleQuickLogin('manager1')}
              disabled={loading}
              data-testid="role-login-manager"
            >
              <span>👔</span> Manager
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '9px 12px', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              onClick={() => handleQuickLogin('operator1')}
              disabled={loading}
              data-testid="role-login-operator"
            >
              <span>⚙️</span> Operator
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '9px 12px', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              onClick={() => handleQuickLogin('picker1')}
              disabled={loading}
              data-testid="role-login-picker"
            >
              <span>📦</span> Picker
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '9px 12px', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              onClick={() => handleQuickLogin('staff1')}
              disabled={loading}
              data-testid="role-login-staff"
            >
              <span>📋</span> Staff
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '16px 0 20px' }}>
          <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }} />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>or sign in manually</span>
          <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }} />
        </div>

        {error && (
          <div
            data-testid="login-error"
            className="banner banner-error"
            style={{ marginBottom: '18px', textAlign: 'center', padding: '10px 14px' }}
          >
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="username">Username</label>
            <input
              id="username"
              data-testid="login-username"
              type="text"
              className="input-field"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input
              id="password"
              data-testid="login-password"
              type="password"
              className="input-field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '14px', height: '44px' }}
            disabled={loading}
            data-testid="login-submit"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};
