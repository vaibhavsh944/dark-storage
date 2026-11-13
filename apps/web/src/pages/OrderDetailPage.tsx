import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { useCan } from '../hooks/useCan.js';
import { OrderDto, MissionDto } from '@dark-storage/shared';
import { StatusBadge } from '../components/StatusBadge.js';

export const OrderDetailPage: React.FC = () => {
  const { ref } = useParams<{ ref: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const canCancelOrder = useCan('order:cancel');
  const canReassign = useCan('mission:reassign');

  // Modal states
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [isReassign, setIsReassign] = useState(false);
  const [selectedPickerId, setSelectedPickerId] = useState<number | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  const [expandedLines, setExpandedLines] = useState<Record<number, boolean>>({});
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  // Fetch order
  const { data: order, isLoading, error } = useQuery<OrderDto>({
    queryKey: ['order', ref],
    queryFn: () => apiFetch(`/api/orders/${ref}`),
    refetchInterval: 5000,
    enabled: !!ref
  });

  // Fetch available pickers for assign modal
  const { data: pickersData } = useQuery<{ pickers: Array<{ id: number; username: string; display_name: string; open_missions: number }> }>({
    queryKey: ['pickers'],
    queryFn: () => apiFetch('/api/users?role=PICKER'),
    enabled: assignModalOpen && canReassign
  });
  const pickers = pickersData?.pickers || [];

  // Fetch associated mission if order is ASSIGNED/PICKING/PICKED/COMPLETED
  const { data: missionsData } = useQuery<{ missions?: any[] }>({
    queryKey: ['missions'],
    queryFn: () => apiFetch('/api/missions'),
    enabled: !!ref && order?.status !== 'RESERVED' && order?.status !== 'CANCELLED'
  });
  const mission = missionsData?.missions?.find((m: any) => m.order_ref === ref);

  // Assign mutation
  const assignMutation = useMutation({
    mutationFn: async (pickerId: number) => {
      setAssignError(null);
      return apiFetch(`/api/orders/${ref}/assign`, {
        method: 'POST',
        idempotencyKey: `assign-${ref}-${Date.now()}`,
        body: JSON.stringify({ picker_id: pickerId })
      });
    },
    onSuccess: () => {
      setAssignModalOpen(false);
      setBannerMessage('Picker assigned successfully. Mission created.');
      queryClient.invalidateQueries({ queryKey: ['order', ref] });
      queryClient.invalidateQueries({ queryKey: ['missions'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setAssignError(err.message);
      } else {
        setAssignError('Failed to assign picker');
      }
    }
  });

  // Reassign mutation
  const reassignMutation = useMutation({
    mutationFn: async (pickerId: number) => {
      setAssignError(null);
      return apiFetch(`/api/orders/${ref}/reassign`, {
        method: 'POST',
        idempotencyKey: `reassign-${ref}-${Date.now()}`,
        body: JSON.stringify({ picker_id: pickerId })
      });
    },
    onSuccess: () => {
      setAssignModalOpen(false);
      setBannerMessage('Order reassigned successfully.');
      queryClient.invalidateQueries({ queryKey: ['order', ref] });
      queryClient.invalidateQueries({ queryKey: ['missions'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setAssignError(err.message);
      } else {
        setAssignError('Failed to reassign picker');
      }
    }
  });

  // Cancel mutation
  const cancelMutation = useMutation({
    mutationFn: async (reason: string) => {
      setCancelError(null);
      return apiFetch(`/api/orders/${ref}/cancel`, {
        method: 'POST',
        idempotencyKey: `cancel-${ref}-${Date.now()}`,
        body: JSON.stringify({ reason })
      });
    },
    onSuccess: () => {
      setCancelModalOpen(false);
      setBannerMessage('Order cancelled and reserved stock released.');
      queryClient.invalidateQueries({ queryKey: ['order', ref] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setCancelError(err.message);
      } else {
        setCancelError('Failed to cancel order');
      }
    }
  });

  if (isLoading) {
    return <div className="card" style={{ padding: '3rem', textAlign: 'center', margin: '2rem auto', maxWidth: '600px' }}>Loading order {ref}...</div>;
  }

  if (error || !order) {
    return (
      <div className="card" style={{ padding: '3rem', textAlign: 'center', margin: '2rem auto', maxWidth: '600px' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/orders')} style={{ marginBottom: '1rem' }}>
          ← Back to Orders
        </button>
        <p style={{ color: 'var(--accent-danger)' }}>Order not found or error loading.</p>
      </div>
    );
  }

  const cancellableStatuses = ['RESERVED', 'ASSIGNED', 'PICKING'];
  const totalPicked = order.lines.reduce((acc, l) => acc + l.qty_picked, 0);
  const isCancellable =
    canCancelOrder &&
    (cancellableStatuses.includes(order.status) || (order.status === 'PICKED' && totalPicked === 0));

  const toggleLine = (lineNo: number) => {
    setExpandedLines((prev) => ({ ...prev, [lineNo]: !prev[lineNo] }));
  };

  return (
    <div className="m3-page" style={{ maxWidth: '1100px' }}>
      {/* Navigation & Header */}
      <div>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/orders')} style={{ marginBottom: '12px' }}>
          ← Back to Orders
        </button>
        <div className="m3-page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>{order.ref}</h1>
            <StatusBadge status={order.status} />
            <span className={`badge badge-${order.priority === 'URGENT' ? 'danger' : order.priority === 'HIGH' ? 'warning' : 'secondary'}`}>
              {order.priority}
            </span>
            <span className="badge badge-info">{order.order_type}</span>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {canReassign && order.status === 'ASSIGNED' && (
              <button
                className="btn btn-secondary"
                data-testid="reassign-picker-btn"
                onClick={() => {
                  setIsReassign(true);
                  setSelectedPickerId(pickers[0]?.id ?? null);
                  setAssignModalOpen(true);
                }}
              >
                Reassign
              </button>
            )}
            {isCancellable && (
              <button
                className="btn btn-danger"
                data-testid="order-cancel-btn"
                onClick={() => setCancelModalOpen(true)}
              >
                Cancel Order
              </button>
            )}
          </div>
        </div>
      </div>

      {bannerMessage && (
        <div className="banner banner-success">
          ✓ {bannerMessage}
        </div>
      )}

      {order.status === 'CANCELLED' && (
        <div className="banner banner-error">
          This order was cancelled. Reason: {order.cancelled_reason || 'No reason provided'}
        </div>
      )}

      {/* Facts Card */}
      <div
        className="card"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px'
        }}
      >
        <div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Customer Ref</span>
          <p style={{ margin: '6px 0 0', fontWeight: 600 }}>{order.customer_ref || '—'}</p>
        </div>
        <div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Requested By</span>
          <p style={{ margin: '6px 0 0', fontWeight: 600 }}>{order.requested_by}</p>
        </div>
        <div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Assigned Picker</span>
          <p style={{ margin: '6px 0 0', fontWeight: 600 }}>
            {typeof order.assigned_picker === 'object' && order.assigned_picker
              ? (order.assigned_picker as any).name
              : order.assigned_picker || 'Unassigned'}
          </p>
        </div>
        {mission && (
          <div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Active Mission</span>
            <p style={{ margin: '6px 0 0', fontWeight: 600 }}>
              <Link to={`/picking/${mission.ref}`} style={{ color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>
                {mission.ref}
              </Link>{' '}
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                ({mission.route.total_distance.toFixed(1)} u · {mission.route.algorithm})
              </span>
            </p>
          </div>
        )}
        <div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Created At</span>
          <p style={{ margin: '6px 0 0', fontWeight: 600, fontSize: '13px' }}>{new Date(order.created_at).toLocaleString()}</p>
        </div>
        {order.notes && (
          <div style={{ gridColumn: '1 / -1' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Notes</span>
            <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)' }}>{order.notes}</p>
          </div>
        )}
      </div>

      {/* Reservation Summary Strip */}
      <div
        className="card"
        style={{
          display: 'flex',
          gap: '16px',
          padding: '16px 20px',
          alignItems: 'center',
          flexWrap: 'wrap'
        }}
      >
        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Reservation Summary:</span>
        <span className="badge badge-warning">
          Held: {order.reservation_summary.held_units} units
        </span>
        <span className="badge badge-success">
          Consumed: {order.reservation_summary.consumed_units} units
        </span>
        <span className="badge badge-secondary">
          Released: {order.reservation_summary.released_units} units
        </span>
      </div>

      {/* Order Lines with Expandable Reservations */}
      <div className="table-container">
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface)' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Order Lines & Bin Reservations</h3>
        </div>

        <table className="table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ width: '40px' }}></th>
              <th>Line #</th>
              <th>Product</th>
              <th>Ordered</th>
              <th>Picked</th>
              <th>Short</th>
              <th>Reserved Bins</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => {
              const isExpanded = expandedLines[l.line_no] ?? true;
              return (
                <React.Fragment key={l.line_no}>
                  <tr
                    onClick={() => toggleLine(l.line_no)}
                    style={{ cursor: 'pointer', backgroundColor: 'var(--bg-secondary)' }}
                  >
                    <td style={{ color: 'var(--text-muted)' }}>{isExpanded ? '▼' : '▶'}</td>
                    <td style={{ fontWeight: 700 }}>{l.line_no}</td>
                    <td>
                      <strong style={{ color: 'var(--text-primary)' }}>{l.product_name}</strong> · <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)' }}>{l.sku}</span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{l.qty_ordered}</td>
                    <td style={{ fontWeight: 600 }}>{l.qty_picked}</td>
                    <td style={{ fontWeight: 600, color: l.qty_short > 0 ? 'var(--accent-warning)' : 'inherit' }}>{l.qty_short}</td>
                    <td>
                      <span className="badge badge-info">{l.reservations.length} bin(s)</span>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr>
                      <td colSpan={7} style={{ padding: '14px 20px 18px 48px', backgroundColor: 'var(--bg-surface)' }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '8px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Allocated Bin Reservations:
                        </div>
                        <div className="table-container" style={{ margin: 0 }}>
                          <table className="table" style={{ margin: 0, backgroundColor: 'var(--bg-secondary)' }}>
                            <thead>
                              <tr>
                                <th>Bin Location</th>
                                <th>Reserved Qty</th>
                                <th>Consumed</th>
                                <th>Released</th>
                                <th>Outstanding</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {l.reservations.map((r) => (
                                <tr key={r.id}>
                                  <td style={{ fontWeight: 700, color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>{r.bin_code}</td>
                                  <td style={{ fontWeight: 600 }}>{r.qty}</td>
                                  <td>{r.consumed_qty}</td>
                                  <td>{r.released_qty}</td>
                                  <td style={{ fontWeight: 700 }}>{r.outstanding}</td>
                                  <td>
                                    <StatusBadge status={r.status} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Audit Timeline */}
      <div className="card">
        <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem', fontWeight: 700 }}>Audit Timeline</h3>
        {order.audit.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', margin: 0 }}>No audit logs recorded yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {order.audit.map((a, idx) => (
              <div
                key={idx}
                style={{
                  padding: '12px 16px',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '13px'
                }}
              >
                <div>
                  <span className="badge badge-info" style={{ marginRight: '10px' }}>{a.action}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>by {a.by}</span>
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {new Date(a.at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assign Modal */}
      {assignModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '1.25rem', fontWeight: 800 }}>
              {isReassign ? 'Reassign Picker' : 'Assign Picker to Order'}
            </h3>

            {assignError && <p style={{ color: 'var(--accent-danger)', fontSize: '13px', marginBottom: '12px' }}>{assignError}</p>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              {pickers.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)' }}>No active pickers available.</p>
              ) : (
                pickers.map((p) => (
                  <label
                    key={p.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      backgroundColor: 'var(--bg-surface)',
                      border: '1.5px solid',
                      borderColor: selectedPickerId === p.id ? 'var(--accent-primary)' : 'var(--border-color)',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <input
                        type="radio"
                        name="picker"
                        checked={selectedPickerId === p.id}
                        onChange={() => setSelectedPickerId(p.id)}
                      />
                      <span style={{ fontWeight: 600 }}>{p.display_name}</span>
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {p.open_missions} active mission{p.open_missions === 1 ? '' : 's'}
                    </span>
                  </label>
                ))
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setAssignModalOpen(false)}
                disabled={assignMutation.isPending || reassignMutation.isPending}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                data-testid="order-assign-confirm"
                onClick={() => {
                  if (!selectedPickerId) return;
                  if (isReassign) {
                    reassignMutation.mutate(selectedPickerId);
                  } else {
                    assignMutation.mutate(selectedPickerId);
                  }
                }}
                disabled={!selectedPickerId || assignMutation.isPending || reassignMutation.isPending}
              >
                {assignMutation.isPending || reassignMutation.isPending ? 'Assigning...' : isReassign ? 'Reassign' : 'Assign Mission'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {cancelModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '1.25rem', fontWeight: 800 }}>Cancel Order <span style={{ fontFamily: 'var(--font-mono)' }}>{order.ref}</span></h3>
            <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Cancelling will release all outstanding reserved units back to available inventory.
            </p>

            {cancelError && <p style={{ color: 'var(--accent-danger)', fontSize: '13px', marginBottom: '12px' }}>{cancelError}</p>}

            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label className="form-label">Reason for cancellation</label>
              <textarea
                className="input-field"
                rows={3}
                placeholder="e.g. Customer cancelled order"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setCancelModalOpen(false)}
                disabled={cancelMutation.isPending}
              >
                Keep Order
              </button>
              <button
                className="btn btn-danger"
                data-testid="order-cancel-confirm"
                onClick={() => cancelMutation.mutate(cancelReason)}
                disabled={cancelReason.trim().length < 3 || cancelMutation.isPending}
              >
                {cancelMutation.isPending ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
