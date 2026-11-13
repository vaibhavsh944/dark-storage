import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { useCan } from '../hooks/useCan.js';
import { PickExceptionDto } from '@dark-storage/shared';
import { StatusBadge } from '../components/StatusBadge.js';
import { Link } from 'react-router-dom';

export const ExceptionsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const canResolve = useCan('exception:resolve');

  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'RESOLVED'>('OPEN');
  const [missionFilter, setMissionFilter] = useState('');
  const [page, setPage] = useState(1);

  // Modal state
  const [selectedExc, setSelectedExc] = useState<PickExceptionDto | null>(null);
  const [resolveNotes, setResolveNotes] = useState('');
  const [recountQty, setRecountQty] = useState<string>('');
  const [resolveError, setResolveError] = useState('');
  const [resolveKey, setResolveKey] = useState<string>('');

  const queryParams = new URLSearchParams();
  if (statusFilter !== 'ALL') {
    queryParams.set('status', statusFilter);
  }
  if (missionFilter.trim()) {
    queryParams.set('mission', missionFilter.trim());
  }
  queryParams.set('page', String(page));
  queryParams.set('page_size', '25');

  const { data, isLoading } = useQuery<{
    exceptions: PickExceptionDto[];
    total: number;
    page: number;
    page_size: number;
  }>({
    queryKey: ['exceptions', statusFilter, missionFilter, page],
    queryFn: () => apiFetch(`/api/exceptions?${queryParams.toString()}`),
    refetchInterval: 5000
  });

  const exceptions = data?.exceptions || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / 25));

  const resolveMutation = useMutation({
    mutationFn: (body: any) =>
      apiFetch(`/api/exceptions/${selectedExc!.ref}/resolve`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': resolveKey
        },
        body: JSON.stringify(body)
      }),
    onSuccess: () => {
      setSelectedExc(null);
      setResolveError('');
      queryClient.invalidateQueries({ queryKey: ['exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['mission'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (err: any) => {
      setResolveError(err.message || 'Failed to resolve exception');
    }
  });

  const openResolveDialog = (exc: PickExceptionDto) => {
    setSelectedExc(exc);
    setResolveNotes('');
    setRecountQty('');
    setResolveError('');
    setResolveKey(`resolve-${exc.ref}-${Date.now()}`);
  };

  const handleResolve = (action: 'REALLOCATE' | 'ACCEPT_SHORT') => {
    if (!selectedExc) return;

    const payload: any = {
      action,
      notes: resolveNotes.trim() || undefined
    };

    if (recountQty !== '') {
      const q = Number(recountQty);
      if (!isNaN(q) && q >= 0) {
        payload.recount = { counted_qty: q };
      }
    }

    resolveMutation.mutate(payload);
  };

  return (
    <div className="m3-page">
      <div className="m3-page-header">
        <div>
          <h1>Pick Exceptions</h1>
          <p className="m3-subtitle">
            Review and resolve picking problems, missing stock, and damaged items.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="m3-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label className="form-label" style={{ margin: 0 }}>Status:</label>
          <select
            className="select"
            style={{ width: '160px' }}
            value={statusFilter}
            onChange={(e: any) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            data-testid="status-filter"
          >
            <option value="OPEN">Open Only</option>
            <option value="RESOLVED">Resolved Only</option>
            <option value="ALL">All Statuses</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 240px' }}>
          <label className="form-label" style={{ margin: 0 }}>Mission:</label>
          <input
            type="text"
            className="input-field"
            placeholder="Search mission ref..."
            value={missionFilter}
            onChange={(e) => {
              setMissionFilter(e.target.value);
              setPage(1);
            }}
            data-testid="mission-filter"
          />
        </div>

        <div style={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--text-secondary)' }}>
          Total Exceptions: <strong style={{ color: 'var(--text-primary)' }}>{total}</strong>
        </div>
      </div>

      {/* Exceptions Table */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Ref</th>
              <th>Status</th>
              <th>Type</th>
              <th>Mission / Order</th>
              <th>Location</th>
              <th>Product</th>
              <th>Expected / Actual</th>
              <th>Reported By</th>
              <th>Resolution</th>
              {canResolve && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                  Loading exceptions...
                </td>
              </tr>
            ) : exceptions.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                  No exceptions matching criteria.
                </td>
              </tr>
            ) : (
              exceptions.map((exc) => (
                <tr key={exc.id} data-testid={`exc-row-${exc.ref}`}>
                  <td>
                    <span style={{ fontWeight: 700, color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>{exc.ref}</span>
                  </td>
                  <td>
                    <StatusBadge status={exc.status} />
                  </td>
                  <td>
                    <span className="badge badge-warning">{exc.type}</span>
                  </td>
                  <td>
                    <div>
                      <Link to={`/picking/${exc.mission_ref}`} style={{ color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>
                        {exc.mission_ref}
                      </Link>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      <Link to={`/orders/${exc.order_ref}`} style={{ color: 'inherit', fontFamily: 'var(--font-mono)' }}>
                        {exc.order_ref}
                      </Link>
                    </div>
                  </td>
                  <td>
                    <strong style={{ fontFamily: 'var(--font-mono)' }}>{exc.bin_code}</strong>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{exc.product_name || exc.sku}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {exc.sku}
                    </div>
                  </td>
                  <td>
                    <div>
                      Req: <strong>{exc.expected_qty}</strong> | Picked: <strong>{exc.actual_qty}</strong>
                    </div>
                    {exc.notes && (
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: '4px' }}>
                        "{exc.notes}"
                      </div>
                    )}
                  </td>
                  <td>
                    <div>{exc.reported_by?.name || `User #${exc.reported_by?.id || exc.reported_by}`}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {new Date(exc.reported_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </td>
                  <td>
                    {exc.resolution ? (
                      <div>
                        <span className="badge badge-info">{exc.resolution}</span>
                        {exc.resolution_notes && (
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            {exc.resolution_notes}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>—</span>
                    )}
                  </td>
                  {canResolve && (
                    <td>
                      {exc.status === 'OPEN' ? (
                        <button
                          className="btn btn-secondary btn-sm"
                          data-testid={`resolve-exc-btn-${exc.ref}`}
                          onClick={() => openResolveDialog(exc)}
                        >
                          Resolve
                        </button>
                      ) : (
                        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Done</span>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', padding: '16px 20px', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface)' }}>
            <button
              className="btn btn-secondary btn-sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <span style={{ alignSelf: 'center', fontSize: '13px', color: 'var(--text-secondary)', padding: '0 8px' }}>
              Page {page} of {totalPages}
            </span>
            <button
              className="btn btn-secondary btn-sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Resolve Dialog Modal */}
      {selectedExc && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '580px' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '1.25rem', fontWeight: 800 }}>Resolve Exception <span style={{ fontFamily: 'var(--font-mono)' }}>{selectedExc.ref}</span></h3>

            {resolveError && (
              <div className="banner banner-error" style={{ marginBottom: '16px' }}>
                {resolveError}
              </div>
            )}

            {/* Facts Card */}
            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: '16px',
                marginBottom: '18px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                fontSize: '13px'
              }}
            >
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Mission / Order:</span>
                <div>
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>{selectedExc.mission_ref}</strong> / <span style={{ fontFamily: 'var(--font-mono)' }}>{selectedExc.order_ref}</span>
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Stop Ref:</span>
                <div style={{ fontFamily: 'var(--font-mono)' }}>{selectedExc.stop_ref}</div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Location / Bin:</span>
                <div>
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>{selectedExc.bin_code}</strong>
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Product (SKU):</span>
                <div>
                  {selectedExc.product_name} (<span style={{ fontFamily: 'var(--font-mono)' }}>{selectedExc.sku}</span>)
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Problem Type:</span>
                <div>
                  <span className="badge badge-warning">{selectedExc.type}</span>
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Quantities:</span>
                <div>
                  Expected: <strong>{selectedExc.expected_qty}</strong> | Picked: <strong>{selectedExc.actual_qty}</strong>
                </div>
              </div>
              {selectedExc.notes && (
                <div style={{ gridColumn: 'span 2' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Picker Notes:</span>
                  <div style={{ fontStyle: 'italic', marginTop: '2px' }}>"{selectedExc.notes}"</div>
                </div>
              )}
            </div>

            {/* Form Inputs */}
            <div className="form-group">
              <label className="form-label">
                Resolution Notes
              </label>
              <textarea
                className="input-field"
                rows={2}
                data-testid="resolve-notes-input"
                placeholder="Details of manager inspection..."
                value={resolveNotes}
                onChange={(e) => setResolveNotes(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label className="form-label">
                Physical Count of Bin (Optional Recount)
              </label>
              <input
                type="number"
                className="input-field"
                data-testid="exc-resolve-recount"
                placeholder="e.g. 0 if bin is truly empty"
                value={recountQty}
                onChange={(e) => setRecountQty(e.target.value)}
                min={0}
              />
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginTop: '6px' }}>
                Providing a count clears the bin's quarantine recount flag and adjusts inventory.
              </span>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSelectedExc(null)}
                disabled={resolveMutation.isPending}
              >
                Cancel
              </button>

              <button
                type="button"
                className="btn btn-warning"
                data-testid="exc-resolve-accept-short"
                onClick={() => handleResolve('ACCEPT_SHORT')}
                disabled={resolveMutation.isPending}
              >
                {resolveMutation.isPending ? 'Resolving...' : 'Accept Short'}
              </button>

              <button
                type="button"
                className="btn btn-primary"
                data-testid="exc-resolve-reallocate"
                onClick={() => handleResolve('REALLOCATE')}
                disabled={resolveMutation.isPending}
              >
                {resolveMutation.isPending ? 'Resolving...' : 'Reallocate from Other Bins'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
