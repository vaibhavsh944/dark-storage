import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { useCan } from '../hooks/useCan.js';
import { PackingQueueItemDto, PackingResultDto } from '@dark-storage/shared';
import { StatusBadge } from '../components/StatusBadge.js';

export const PackingPage: React.FC = () => {
  const { user } = useAuthStore();
  const canPack = useCan('pack:execute');
  const canDispatchView = useCan('dispatch:view');

  const [selectedOrderRef, setSelectedOrderRef] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ items: PackingQueueItemDto[] }>({
    queryKey: ['packing-queue'],
    queryFn: () => apiFetch('/api/packing/queue'),
    refetchInterval: 5000
  });

  const queue = data?.items || [];
  const selectedOrder = queue.find((o) => o.order_ref === selectedOrderRef) || queue[0] || null;

  const handleSelectOrder = (order: PackingQueueItemDto) => {
    setSelectedOrderRef(order.order_ref);
  };

  const isPartial = selectedOrder?.fulfilment_preview === 'PARTIAL';

  return (
    <div className="m3-page">
      <div className="m3-page-header">
        <div>
          <h1>Packing & Dispatch</h1>
          <p className="m3-subtitle">
            Inspect picked units, handle shortfalls, and complete packing.
          </p>
        </div>
      </div>

      {/* Main Grid: Left Queue, Right Detail */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px', alignItems: 'start' }}>
        {/* Left Column: Packing Queue */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-surface)' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Ready to Pack</h3>
            <span className="badge badge-info">{queue.length}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '640px', overflowY: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Loading queue...
              </div>
            ) : queue.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                No orders waiting for packing.
              </div>
            ) : (
              queue.map((item) => {
                const isSelected = selectedOrder?.order_ref === item.order_ref;
                return (
                  <div
                    key={item.order_ref}
                    onClick={() => handleSelectOrder(item)}
                    data-testid={`pack-queue-${item.order_ref}`}
                    style={{
                      padding: '16px 20px',
                      borderBottom: '1px solid var(--border-color)',
                      cursor: 'pointer',
                      backgroundColor: isSelected ? 'var(--accent-primary-container)' : 'transparent',
                      borderLeft: isSelected ? '4px solid var(--accent-primary)' : '4px solid transparent',
                      transition: 'background-color 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontWeight: 700, color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>{item.order_ref}</span>
                      <StatusBadge status={item.priority} />
                    </div>

                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                      {item.customer_ref || 'Standard Customer'}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        Units: <strong style={{ color: 'var(--text-primary)' }}>{item.total_picked}</strong> / {item.total_ordered}
                      </span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {item.fulfilment_preview === 'PARTIAL' ? (
                          <span className="badge badge-warning">PARTIAL</span>
                        ) : (
                          <span className="badge badge-success">FULL</span>
                        )}
                        {item.needs_manager_approval && (
                          <span className="badge badge-danger">Needs Manager</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Order Detail & Pack Confirmation */}
        {selectedOrder ? (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800 }}>Packing <span style={{ fontFamily: 'var(--font-mono)' }}>{selectedOrder.order_ref}</span></h2>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Customer: <strong style={{ color: 'var(--text-primary)' }}>{selectedOrder.customer_ref || 'Standard'}</strong> • Mission: <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{selectedOrder.mission_ref || 'N/A'}</strong>
                </span>
              </div>
              <div>
                {selectedOrder.fulfilment_preview === 'PARTIAL' ? (
                  <span className="badge badge-warning" style={{ fontSize: '12px' }}>PARTIAL FULFILMENT</span>
                ) : (
                  <span className="badge badge-success" style={{ fontSize: '12px' }}>FULL FULFILMENT</span>
                )}
              </div>
            </div>

            {/* Lines Table */}
            <div>
              <h4 style={{ margin: '0 0 10px', fontSize: '1rem', fontWeight: 700 }}>Order Lines Verification</h4>
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Ordered</th>
                      <th>Picked</th>
                      <th>Short</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedOrder.lines.map((l) => {
                      const isComplete = l.qty_picked === l.qty_ordered;
                      return (
                        <tr key={l.sku}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{l.product_name}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{l.sku}</div>
                          </td>
                          <td style={{ fontWeight: 600 }}>{l.qty_ordered}</td>
                          <td style={{ fontWeight: 700, color: isComplete ? 'inherit' : 'var(--accent-warning)' }}>{l.qty_picked}</td>
                          <td style={{ fontWeight: 600 }}>{l.qty_short}</td>
                          <td>
                            {isComplete ? (
                              <span style={{ color: 'var(--accent-success)', fontWeight: 700 }}>✓ Complete</span>
                            ) : (
                              <span style={{ color: 'var(--accent-warning)', fontWeight: 700 }}>⚠ Short ({l.qty_short} short)</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Exceptions */}
            {selectedOrder.exceptions.length > 0 && (
              <div>
                <h4 style={{ margin: '0 0 10px', fontSize: '1rem', fontWeight: 700 }}>Resolved Exceptions</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {selectedOrder.exceptions.map((exc) => (
                    <div
                      key={exc.ref}
                      style={{
                        padding: '10px 14px',
                        backgroundColor: 'var(--bg-surface)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '13px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div>
                        <strong style={{ fontFamily: 'var(--font-mono)' }}>{exc.ref}</strong> — <span className="badge badge-warning">{exc.type}</span> {exc.notes ? `("${exc.notes}")` : ''}
                      </div>
                      <span className="badge badge-info">{exc.resolution || 'RESOLVED'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 16, padding: '12px 16px', backgroundColor: 'var(--bg-surface)', borderRadius: 6, border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {canPack ? 'Active packing execution is conducted at the packing bench (/floor/pack).' : 'Read-only packing queue inspection. Physical packing is restricted to Staff.'}
              </span>
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Select an order from the queue to start packing.
          </div>
        )}
      </div>
    </div>
  );
};
