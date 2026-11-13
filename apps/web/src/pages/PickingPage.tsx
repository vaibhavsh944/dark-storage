import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { useCan } from '../hooks/useCan.js';
import { MissionDto } from '@dark-storage/shared';
import { StatusBadge } from '../components/StatusBadge.js';

export const PickingPage: React.FC = () => {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const canPick = useCan('pick:execute');
  const canControl = useCan('control:view');

  const { data, isLoading } = useQuery<{ missions: MissionDto[]; total: number; page: number; page_size: number }>({
    queryKey: ['missions', statusFilter, page],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('page_size', '25');
      if (statusFilter) params.set('status', statusFilter);
      return apiFetch(`/api/missions?${params.toString()}`);
    },
    refetchInterval: 10000
  });

  const missions = data?.missions || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="m3-page">
      <div className="m3-page-header">
        <div>
          <h1>
            {canPick ? 'My Picking Missions' : 'Picking Missions'}
          </h1>
          <p className="m3-subtitle">
            {canPick
              ? 'View assigned picking missions and execute optimized pick routes'
              : 'Monitor warehouse picking routes, assignments, and mission progress'}
          </p>
        </div>

        {canControl && (
          <div style={{ width: '200px' }}>
            <select
              className="select"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Statuses</option>
              <option value="ASSIGNED">ASSIGNED</option>
              <option value="IN_PROGRESS">IN_PROGRESS</option>
              <option value="COMPLETED">COMPLETED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          Loading missions...
        </div>
      ) : missions.length === 0 ? (
        <div className="card" style={{ padding: '3.5rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '15px' }}>
            {canPick ? 'No active picking missions assigned to you.' : 'No missions found.'}
          </p>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Mission Ref</th>
                <th>Order Ref</th>
                {!canPick && <th>Picker</th>}
                <th>Algorithm</th>
                <th>Distance</th>
                <th>Stops</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {missions.map((m) => (
                <tr key={m.id} data-testid={`mission-row-${m.ref}`}>
                  <td>
                    <span style={{ fontWeight: 700, color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>{m.ref}</span>
                  </td>
                  <td><span style={{ fontFamily: 'var(--font-mono)' }}>{m.order_ref}</span></td>
                  {!canPick && <td style={{ fontWeight: 600 }}>{m.picker.name}</td>}
                  <td>
                    <span className="badge badge-info">{m.route.algorithm}</span>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{m.route.total_distance.toFixed(1)} u</td>
                  <td>
                    <span style={{ fontWeight: 600 }}>{m.progress.finished_stops}</span> / {m.progress.total_stops}
                  </td>
                  <td>
                    <StatusBadge status={m.status} />
                  </td>
                  <td>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => navigate(`/picking/${m.ref}`)}
                    >
                      View Mission
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 20px',
                borderTop: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-surface)'
              }}
            >
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Page {page} of {totalPages} ({total} missions)
              </span>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
