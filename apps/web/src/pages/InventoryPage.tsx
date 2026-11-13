import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { useCan } from '../hooks/useCan.js';
import { ProductLabel } from '../components/ProductLabel.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { LabelPrintModal } from '../components/LabelPrintModal.js';

interface SummaryItem {
  sku: string;
  product_name: string;
  category: string;
  stored_qty: number;
  reserved_qty: number;
  available_to_promise: number;
  unavailable_qty: number;
  staged_qty: number;
  bins_used: number;
}

interface BinItem {
  bin_code: string;
  shelf_code: string;
  level: number;
  capacity: number;
  status: string;
  recount_required: boolean;
  sku: string | null;
  product_name: string | null;
  qty: number;
  reserved_qty: number;
  available_qty: number;
  free_capacity: number;
}

interface MovementItem {
  ref: string;
  type: string;
  sku: string;
  product_name: string;
  qty: number;
  from_label: string;
  to_label: string;
  related_ref: string | null;
  performed_by_name: string | null;
  created_at: string;
}

export const InventoryPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'summary' | 'bins' | 'ledger'>('summary');
  const [search, setSearch] = useState('');
  const [selectedSku, setSelectedSku] = useState('');
  const [selectedShelf, setSelectedShelf] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedOccupied, setSelectedOccupied] = useState('');
  const [selectedBinCode, setSelectedBinCode] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Relocate modal state
  const [relocateModalOpen, setRelocateModalOpen] = useState(false);
  const [relocateQty, setRelocateQty] = useState(1);
  const [relocateDestBin, setRelocateDestBin] = useState('');
  const [relocateValidation, setRelocateValidation] = useState<{ valid: boolean; message: string } | null>(null);
  const [relocateSubmitting, setRelocateSubmitting] = useState(false);

  // Label print modal state
  const [labelModalOpen, setLabelModalOpen] = useState(false);
  const [printValue, setPrintValue] = useState('');
  const [printTab, setPrintTab] = useState<'sku' | 'bin' | 'receipt'>('sku');

  const canResolveException = useCan('exception:resolve');
  const canRelocate = useCan('relocate:execute');
  const queryClient = useQueryClient();


  // Queries
  const { data: summaryData, isLoading: summaryLoading } = useQuery<{ items: SummaryItem[] }>({
    queryKey: ['inventory', 'summary', search],
    queryFn: () => apiFetch(`/api/inventory/summary?search=${encodeURIComponent(search)}&limit=100`),
    enabled: activeTab === 'summary'
  });

  const { data: binsData, isLoading: binsLoading } = useQuery<{ items: BinItem[] }>({
    queryKey: ['inventory', 'bins', selectedSku, selectedShelf, selectedStatus, selectedOccupied],
    queryFn: () => {
      const p = new URLSearchParams();
      if (selectedSku) p.set('sku', selectedSku);
      if (selectedShelf) p.set('shelf', selectedShelf);
      if (selectedStatus) p.set('status', selectedStatus);
      if (selectedOccupied) p.set('occupied', selectedOccupied);
      p.set('limit', '100');
      return apiFetch(`/api/inventory/bins?${p.toString()}`);
    },
    enabled: activeTab === 'bins'
  });

  const { data: binDetail, refetch: refetchBinDetail } = useQuery<{
    bin_code: string;
    shelf_code: string;
    level: number;
    capacity: number;
    status: string;
    recount_required: boolean;
    storage_class: string;
    sku: string | null;
    product_name: string | null;
    qty: number;
    reserved_qty: number;
    available_qty: number;
    free_capacity: number;
    recent_movements: MovementItem[];
  }>({
    queryKey: ['inventory', 'bin', selectedBinCode],
    queryFn: () => apiFetch(`/api/inventory/bins/${encodeURIComponent(selectedBinCode!)}`),
    enabled: Boolean(selectedBinCode)
  });

  const { data: ledgerData, isLoading: ledgerLoading } = useQuery<{ items: MovementItem[] }>({
    queryKey: ['inventory', 'movements'],
    queryFn: () => apiFetch('/api/inventory/movements?limit=100'),
    enabled: activeTab === 'ledger'
  });

  // Mutations
  const statusMutation = useMutation({
    mutationFn: async ({ code, status, reason }: { code: string; status: string; reason: string }) => {
      return apiFetch(`/api/inventory/bins/${encodeURIComponent(code)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status, reason })
      });
    },
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      refetchBinDetail();
    },
    onError: (err: any) => {
      setActionError(err.message || 'Failed to update status');
    }
  });

  const getFillClass = (qty: number, cap: number) => {
    if (qty === 0) return 'empty';
    const pct = (qty / cap) * 100;
    if (pct < 25) return 'low';
    if (pct < 75) return 'med';
    if (pct < 100) return 'high';
    return 'full';
  };

  return (
    <div className="m3-page">
      <div className="m3-page-header">
        <div>
          <h1>Inventory Management</h1>
          <p className="m3-subtitle">Real-time stock balance, bin capacity inspection, recount, and relocation</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs" role="tablist" aria-label="Inventory sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'summary'}
          className={`tab-btn ${activeTab === 'summary' ? 'active' : ''}`}
          onClick={() => setActiveTab('summary')}
          data-testid="inv-tab-summary"
        >
          Summary
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'bins'}
          className={`tab-btn ${activeTab === 'bins' ? 'active' : ''}`}
          onClick={() => setActiveTab('bins')}
          data-testid="inv-tab-bins"
        >
          Bins
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'ledger'}
          className={`tab-btn ${activeTab === 'ledger' ? 'active' : ''}`}
          onClick={() => setActiveTab('ledger')}
          data-testid="inv-tab-ledger"
        >
          Ledger
        </button>
      </div>

      {/* Tab 1: Summary */}
      {activeTab === 'summary' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ maxWidth: 360, flex: 1 }}>
              <input
                type="text"
                placeholder="Search by name or SKU..."
                className="input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="inv-search"
              />
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setPrintTab('sku');
                setPrintValue('');
                setLabelModalOpen(true);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              🏷️ Print Labels
            </button>
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Stored</th>
                  <th>Reserved</th>
                  <th>Available</th>
                  <th>Staged</th>
                  <th>Bins Used</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {summaryLoading ? (
                  <tr><td colSpan={8}>Loading summary...</td></tr>
                ) : summaryData?.items.length === 0 ? (
                  <tr><td colSpan={8}>No products found.</td></tr>
                ) : (
                  summaryData?.items.map((item) => (
                    <tr
                      key={item.sku}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        setSelectedSku(item.sku);
                        setActiveTab('bins');
                      }}
                    >
                      <td><ProductLabel sku={item.sku} name={item.product_name} /></td>
                      <td>{item.category}</td>
                      <td>{item.stored_qty}</td>
                      <td>{item.reserved_qty}</td>
                      <td><strong>{item.available_to_promise}</strong></td>
                      <td>{item.staged_qty}</td>
                      <td>{item.bins_used}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPrintTab('sku');
                            setPrintValue(item.sku);
                            setLabelModalOpen(true);
                          }}
                          title="Print SKU label"
                          style={{ fontSize: '11px', padding: '2px 8px' }}
                        >
                          🏷️ Print
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Bins */}
      {activeTab === 'bins' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Filter by SKU..."
              className="input"
              style={{ width: 160 }}
              value={selectedSku}
              onChange={(e) => setSelectedSku(e.target.value)}
            />
            <input
              type="text"
              placeholder="Shelf (e.g. A-01-L)..."
              className="input"
              style={{ width: 160 }}
              value={selectedShelf}
              onChange={(e) => setSelectedShelf(e.target.value)}
            />
            <select
              className="select"
              style={{ width: 140 }}
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
            >
              <option value="">All Statuses</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="BLOCKED">BLOCKED</option>
              <option value="DAMAGED">DAMAGED</option>
            </select>
            <select
              className="select"
              style={{ width: 140 }}
              value={selectedOccupied}
              onChange={(e) => setSelectedOccupied(e.target.value)}
            >
              <option value="">All Bins</option>
              <option value="true">Occupied Only</option>
              <option value="false">Empty Only</option>
            </select>
            {(selectedSku || selectedShelf || selectedStatus || selectedOccupied) && (
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setSelectedSku('');
                  setSelectedShelf('');
                  setSelectedStatus('');
                  setSelectedOccupied('');
                }}
              >
                Clear Filters
              </button>
            )}
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Bin</th>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Reserved</th>
                  <th>Available</th>
                  <th>Capacity</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {binsLoading ? (
                  <tr><td colSpan={7}>Loading bins...</td></tr>
                ) : binsData?.items.length === 0 ? (
                  <tr><td colSpan={7}>No bins match filters.</td></tr>
                ) : (
                  binsData?.items.map((bin) => {
                    const fillCls = getFillClass(bin.qty, bin.capacity);
                    const pct = Math.min(100, Math.round((bin.qty / bin.capacity) * 100));
                    return (
                      <tr
                        key={bin.bin_code}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelectedBinCode(bin.bin_code)}
                        data-testid={`inv-bin-row-${bin.bin_code}`}
                      >
                        <td><strong>{bin.bin_code}</strong></td>
                        <td>
                          {bin.sku ? (
                            <ProductLabel sku={bin.sku} name={bin.product_name || bin.sku} />
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>Empty</span>
                          )}
                        </td>
                        <td>{bin.qty}</td>
                        <td>{bin.reserved_qty}</td>
                        <td><strong>{bin.available_qty}</strong></td>
                        <td>
                          <div className="fill-bar-container">
                            <div className="fill-bar">
                              <div
                                className={`fill-bar-inner ${fillCls}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {bin.qty}/{bin.capacity}
                            </span>
                          </div>
                        </td>
                        <td>
                          <StatusBadge status={bin.status} />
                          {bin.recount_required && (
                            <span className="badge badge-warning" style={{ marginLeft: 4 }}>
                              RECOUNT
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Ledger */}
      {activeTab === 'ledger' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Type</th>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Related</th>
                  <th>Performed By</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {ledgerLoading ? (
                  <tr><td colSpan={9}>Loading ledger movements...</td></tr>
                ) : ledgerData?.items.length === 0 ? (
                  <tr><td colSpan={9}>No stock movements recorded yet.</td></tr>
                ) : (
                  ledgerData?.items.map((m) => (
                    <tr key={m.ref}>
                      <td><span style={{ fontFamily: 'var(--font-mono)' }}>{m.ref}</span></td>
                      <td><StatusBadge status={m.type} /></td>
                      <td><ProductLabel sku={m.sku} name={m.product_name} /></td>
                      <td><strong>{m.qty}</strong></td>
                      <td>{m.from_label}</td>
                      <td>{m.to_label}</td>
                      <td>{m.related_ref || '—'}</td>
                      <td>{m.performed_by_name || 'System'}</td>
                      <td>{new Date(m.created_at).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bin Detail Drawer */}
      {selectedBinCode && binDetail && (
        <div className="drawer-backdrop" onClick={() => setSelectedBinCode(null)}>
          <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Bin Detail: {binDetail.bin_code}</h3>
              <button className="btn btn-secondary" onClick={() => setSelectedBinCode(null)}>
                Close
              </button>
            </div>

            {actionError && (
              <div style={{ color: 'var(--accent-danger)', backgroundColor: 'rgba(239,68,68,0.1)', padding: 10, borderRadius: 4 }}>
                {actionError}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><strong>Shelf:</strong> {binDetail.shelf_code}</div>
              <div><strong>Level:</strong> {binDetail.level}</div>
              <div><strong>Status:</strong> <StatusBadge status={binDetail.status} /></div>
              <div><strong>Storage Class:</strong> {binDetail.storage_class}</div>
              <div><strong>Capacity:</strong> {binDetail.capacity}</div>
              <div><strong>Free Capacity:</strong> {binDetail.free_capacity}</div>
              <div><strong>Total Qty:</strong> {binDetail.qty}</div>
              <div><strong>Reserved:</strong> {binDetail.reserved_qty}</div>
              <div><strong>Available:</strong> {binDetail.available_qty}</div>
              <div><strong>Recount Req:</strong> {binDetail.recount_required ? 'YES' : 'NO'}</div>
            </div>

            {binDetail.sku && (
              <div style={{ padding: 12, backgroundColor: 'var(--bg-surface)', borderRadius: 6 }}>
                <div><strong>Product:</strong></div>
                <ProductLabel sku={binDetail.sku} name={binDetail.product_name || binDetail.sku} />
              </div>
            )}

            {/* Manager Actions */}
            {canResolveException && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                {binDetail.status === 'ACTIVE' ? (
                  <>
                    <button
                      className="btn btn-secondary"
                      onClick={() => statusMutation.mutate({ code: binDetail.bin_code, status: 'BLOCKED', reason: 'Manager blocked bin' })}
                      data-testid="bin-status-btn"
                    >
                      Block Bin
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => statusMutation.mutate({ code: binDetail.bin_code, status: 'DAMAGED', reason: 'Bin damaged' })}
                    >
                      Mark Damaged
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-primary"
                    onClick={() => statusMutation.mutate({ code: binDetail.bin_code, status: 'ACTIVE', reason: 'Manager reactivated bin' })}
                    data-testid="bin-status-btn"
                  >
                    Reactivate Bin
                  </button>
                )}
              </div>
            )}

            {canRelocate && binDetail.sku && binDetail.available_qty > 0 && (
              <div style={{ marginTop: 12 }}>
                <button
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                  onClick={() => {
                    setRelocateQty(1);
                    setRelocateDestBin('');
                    setRelocateValidation(null);
                    setActionError(null);
                    setRelocateModalOpen(true);
                  }}
                  data-testid="bin-relocate-btn"
                >
                  Relocate Stock
                </button>
              </div>
            )}


            {/* Recent Movements */}
            <div style={{ marginTop: 20 }}>
              <h4>Recent Movements (last 10)</h4>
              {binDetail.recent_movements.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>No recent movements for this bin.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  {binDetail.recent_movements.map((m) => (
                    <div
                      key={m.ref}
                      style={{
                        padding: 10,
                        backgroundColor: 'var(--bg-surface)',
                        borderRadius: 6,
                        fontSize: 12
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span><strong>{m.ref}</strong> ({m.type})</span>
                        <span>{new Date(m.created_at).toLocaleTimeString()}</span>
                      </div>
                      <div>Qty: <strong>{m.qty}</strong> · {m.from_label} → {m.to_label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Relocate Modal (Phase 5) */}
      {relocateModalOpen && binDetail && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: 500 }}>
            <h3>Relocate Stock: {binDetail.bin_code}</h3>
            {actionError && (
              <div style={{ color: 'var(--accent-danger)', marginBottom: 12 }}>{actionError}</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
              <div style={{ fontSize: 13 }}>
                <div>Product: <strong>{binDetail.product_name}</strong> ({binDetail.sku})</div>
                <div>Available to Relocate: <strong>{binDetail.available_qty}</strong> units</div>
              </div>

              <div>
                <label>Quantity to Relocate:</label>
                <input
                  type="number"
                  min="1"
                  max={binDetail.available_qty}
                  className="input"
                  value={relocateQty}
                  onChange={(e) => {
                    const q = parseInt(e.target.value, 10) || 1;
                    setRelocateQty(q);
                    if (relocateDestBin) {
                      // Trigger validation
                      apiFetch('/api/placement/validate', {
                        method: 'POST',
                        body: JSON.stringify({ dest_bin: relocateDestBin.trim(), qty: q, sku: binDetail.sku })
                      }).then((res: any) => {
                        setRelocateValidation(res.valid ? { valid: true, message: `Valid — free capacity ${res.free_capacity}` } : { valid: false, message: `Invalid: ${res.reason}` });
                      }).catch((e: any) => setRelocateValidation({ valid: false, message: e.message }));
                    }
                  }}
                  data-testid="relocate-qty-input"
                />
              </div>

              <div>
                <label>Destination Bin Code:</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. A-01-L-2"
                  value={relocateDestBin}
                  onChange={(e) => {
                    const dest = e.target.value;
                    setRelocateDestBin(dest);
                    if (dest.trim().length >= 5) {
                      apiFetch('/api/placement/validate', {
                        method: 'POST',
                        body: JSON.stringify({ dest_bin: dest.trim(), qty: relocateQty, sku: binDetail.sku })
                      }).then((res: any) => {
                        setRelocateValidation(res.valid ? { valid: true, message: `Valid — free capacity ${res.free_capacity}` } : { valid: false, message: `Invalid: ${res.reason}` });
                      }).catch((e: any) => setRelocateValidation({ valid: false, message: e.message }));
                    } else {
                      setRelocateValidation(null);
                    }
                  }}
                  data-testid="relocate-dest-bin-input"
                />
              </div>

              {relocateValidation && (
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: 4,
                    fontSize: 12,
                    backgroundColor: relocateValidation.valid ? 'rgba(74, 222, 128, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: relocateValidation.valid ? '#4ade80' : '#ef4444',
                    border: `1px solid ${relocateValidation.valid ? '#4ade80' : '#ef4444'}`
                  }}
                  data-testid="relocate-validation-status"
                >
                  {relocateValidation.message}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button
                  className="btn btn-secondary"
                  disabled={relocateSubmitting}
                  onClick={() => setRelocateModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  disabled={
                    relocateSubmitting ||
                    !relocateDestBin ||
                    relocateValidation?.valid !== true ||
                    relocateQty <= 0 ||
                    relocateQty > binDetail.available_qty
                  }
                  onClick={async () => {
                    setRelocateSubmitting(true);
                    setActionError(null);
                    try {
                      const idemKey = crypto.randomUUID();
                      await apiFetch('/api/inventory/relocate', {
                        method: 'POST',
                        idempotencyKey: idemKey,
                        body: JSON.stringify({
                          from_bin: binDetail.bin_code,
                          to_bin: relocateDestBin.trim(),
                          qty: relocateQty
                        })
                      });

                      setRelocateModalOpen(false);
                      queryClient.invalidateQueries({ queryKey: ['inventory'] });
                      refetchBinDetail();
                    } catch (err: any) {
                      setActionError(err.message || 'Relocation failed');
                    } finally {
                      setRelocateSubmitting(false);
                    }
                  }}
                  data-testid="bin-relocate-submit"
                >
                  {relocateSubmitting ? 'Relocating…' : 'Confirm Relocation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Label Print Modal */}
      <LabelPrintModal
        isOpen={labelModalOpen}
        onClose={() => setLabelModalOpen(false)}
        initialTab={printTab}
        initialValue={printValue}
      />
    </div>
  );
};
