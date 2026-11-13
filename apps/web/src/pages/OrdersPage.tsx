import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { useCan } from '../hooks/useCan.js';
import { OrderDto } from '@dark-storage/shared';
import { StatusBadge } from '../components/StatusBadge.js';

export const OrdersPage: React.FC = () => {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');

  const canCreate = useCan('order:create');

  const { data, isLoading } = useQuery<{ items?: OrderDto[]; orders?: OrderDto[]; page: number; page_size: number; total: number }>({
    queryKey: ['orders', page, search, status, priority],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('page_size', '25');
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      if (priority) params.set('priority', priority);
      return apiFetch(`/api/orders?${params.toString()}`);
    },
    refetchInterval: 15000
  });

  const orders: OrderDto[] = data?.orders || data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="m3-page">
      <div className="m3-page-header">
        <div>
          <h1>Outbound Orders</h1>
          <p className="m3-subtitle">
            Manage customer, transfer, and production orders with atomic stock reservations
          </p>
        </div>
        {canCreate && (
          <button
            className="btn btn-primary"
            onClick={() => navigate('/orders/new')}
            data-testid="orders-new-btn"
          >
            + New Order
          </button>
        )}
      </div>

      {/* Filters Toolbar */}
      <div className="m3-toolbar">
        <div style={{ flex: '1 1 240px' }}>
          <input
            type="text"
            className="input-field"
            placeholder="Search ref, customer, SKU, name..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <div style={{ width: '220px' }}>
          <select
            className="select"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Statuses</option>
            <option value="RESERVED">Awaiting assignment (RESERVED)</option>
            <option value="ASSIGNED">ASSIGNED</option>
            <option value="PICKING">PICKING</option>
            <option value="PICKED">PICKED</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </div>

        <div style={{ width: '180px' }}>
          <select
            className="select"
            value={priority}
            onChange={(e) => {
              setPriority(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Priorities</option>
            <option value="LOW">LOW</option>
            <option value="NORMAL">NORMAL</option>
            <option value="HIGH">HIGH</option>
            <option value="URGENT">URGENT</option>
          </select>
        </div>
      </div>

      {/* Orders Table */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Order Ref</th>
              <th>Type</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Customer</th>
              <th>Lines / Units</th>
              <th>Picker</th>
              <th>Created At</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                  Loading orders...
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                  No orders found
                </td>
              </tr>
            ) : (
              orders.map((o: OrderDto) => {
                const totalUnits = o.lines.reduce((acc: number, l) => acc + l.qty_ordered, 0);
                return (
                  <tr
                    key={o.ref}
                    onClick={() => navigate(`/orders/${o.ref}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td><span style={{ fontWeight: 700, color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>{o.ref}</span></td>
                    <td><span className="badge badge-secondary">{o.order_type}</span></td>
                    <td>
                      <span className={`badge badge-${o.priority === 'URGENT' ? 'danger' : o.priority === 'HIGH' ? 'warning' : 'secondary'}`}>
                        {o.priority}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    <td style={{ fontWeight: 500 }}>{o.customer_ref || '—'}</td>
                    <td>
                      {o.lines.length} lines ({totalUnits} units)
                    </td>
                    <td>{typeof o.assigned_picker === 'object' && o.assigned_picker ? (o.assigned_picker as any).name : o.assigned_picker || '—'}</td>
                    <td style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {new Date(o.created_at).toLocaleString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Pagination */}
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
              Showing {orders.length} of {total} orders
            </span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span style={{ padding: '0 8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Page {page} of {totalPages}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
