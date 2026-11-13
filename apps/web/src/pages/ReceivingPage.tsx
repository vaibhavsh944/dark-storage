import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { ProductLabel } from '../components/ProductLabel.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { AllocationModal } from '../components/AllocationModal.js';
import { LabelPrintModal } from '../components/LabelPrintModal.js';
import { useCan } from '../hooks/useCan.js';

interface ProductItem {
  sku: string;
  name: string;
  category: string;
  storage_class: string;
  max_receive_qty: number;
}

interface PutawayItem {
  id: number;
  ref: string;
  receipt_ref: string;
  receipt_line_id: number;
  sku: string;
  product_name: string;
  qty: number;
  source: string;
  dest_shelf: string;
  dest_bin: string;
  selection_mode: 'RECOMMENDED' | 'MANUAL';
  movement_ref: string;
  performed_by: string;
  status: string;
  created_at: string;
  receipt_status: string;
}

interface IntakeLine {

  sku: string;
  name: string;
  category: string;
  storage_class: string;
  max_receive_qty: number;
  qty: number;
}

interface StagedLineItem {
  line_id: number;
  receipt_ref: string;
  sku: string;
  product_name: string;
  category: string;
  storage_class: string;
  qty_received: number;
  qty_put_away: number;
  qty_staged: number;
  received_at: string;
}

interface ReceiptSummary {
  id: number;
  ref: string;
  status: string;
  supplier: string | null;
  reference_no: string | null;
  notes: string | null;
  received_at: string;
  received_by_name: string;
  line_count: number;
  total_units: number;
}

interface ReceiptDetail {
  ref: string;
  status: string;
  supplier: string | null;
  reference_no: string | null;
  notes: string | null;
  received_at: string;
  received_by: { id: number; name: string };
  lines: Array<{
    line_id: number;
    line_no: number;
    sku: string;
    product_name: string;
    category: string;
    storage_class: string;
    qty_received: number;
    qty_put_away: number;
    qty_staged: number;
    movement_ref: string;
  }>;
  audit_log: Array<{
    id: number;
    occurred_at: string;
    action: string;
    actor_name: string | null;
    details_json: string;
  }>;
}

export const ReceivingPage: React.FC = () => {
  const canReceive = useCan('inbound:receive');
  const canPutaway = useCan('putaway:execute');
  const [activeTab, setActiveTab] = useState<'new' | 'staged' | 'receipts' | 'putaways'>(canReceive ? 'new' : 'staged');
  const queryClient = useQueryClient();


  // Intake Form State
  const [supplier, setSupplier] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<IntakeLine[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => `rcv-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  // Product Picker Line State
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null);
  const [lineQty, setLineQty] = useState<string>('1');
  const [formError, setFormError] = useState<string | null>(null);
  const [successReceipt, setSuccessReceipt] = useState<string | null>(null);

  // Receipts tab state
  const [receiptsSearch, setReceiptsSearch] = useState('');
  const [selectedReceiptRef, setSelectedReceiptRef] = useState<string | null>(null);
  const [selectedLineForAlloc, setSelectedLineForAlloc] = useState<StagedLineItem | null>(null);

  // Label print modal state
  const [labelModalOpen, setLabelModalOpen] = useState(false);
  const [printReceiptRef, setPrintReceiptRef] = useState('');

  // Queries
  const cleanedSearch = React.useMemo(() => {
    const raw = productSearch.trim();
    if (!raw) return '';
    const skuMatch = raw.match(/\b(SKU\d{3,})\b/i);
    if (skuMatch) return skuMatch[1];
    return raw.split(/[-–—(]/)[0].trim();
  }, [productSearch]);

  const { data: searchProducts } = useQuery<{ items: ProductItem[] }>({
    queryKey: ['products', 'search', cleanedSearch],
    queryFn: () => apiFetch(`/api/products?search=${encodeURIComponent(cleanedSearch)}&limit=10`),
    enabled: cleanedSearch.length > 0
  });

  const { data: stagedLines, isLoading: stagedLoading } = useQuery<StagedLineItem[]>({
    queryKey: ['receipts', 'staged'],
    queryFn: () => apiFetch('/api/receipts/staged'),
    enabled: activeTab === 'staged'
  });

  const { data: receiptsData, isLoading: receiptsLoading } = useQuery<{ items: ReceiptSummary[] }>({
    queryKey: ['receipts', 'list', receiptsSearch],
    queryFn: () => apiFetch(`/api/receipts?search=${encodeURIComponent(receiptsSearch)}&limit=50`),
    enabled: activeTab === 'receipts'
  });

  const { data: putawaysData, isLoading: putawaysLoading } = useQuery<{ putaways: PutawayItem[] }>({
    queryKey: ['putaways'],
    queryFn: () => apiFetch('/api/putaways'),
    enabled: activeTab === 'putaways'
  });


  const { data: receiptDetail } = useQuery<ReceiptDetail>({
    queryKey: ['receipts', 'detail', selectedReceiptRef],
    queryFn: () => apiFetch(`/api/receipts/${encodeURIComponent(selectedReceiptRef!)}`),
    enabled: Boolean(selectedReceiptRef)
  });

  // Submit intake mutation
  const intakeMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        supplier: supplier.trim() || undefined,
        reference_no: referenceNo.trim() || undefined,
        notes: notes.trim() || undefined,
        received_at: receivedAt ? new Date(receivedAt).toISOString() : undefined,
        lines: lines.map((l) => ({ sku: l.sku, qty: l.qty }))
      };

      return apiFetch('/api/receipts', {
        method: 'POST',
        headers: {
          'idempotency-key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });
    },
    onSuccess: (data: any) => {
      setSuccessReceipt(data.ref);
      setFormError(null);
      // Reset form with new idempotency key
      setLines([]);
      setSupplier('');
      setReferenceNo('');
      setNotes('');
      setReceivedAt('');
      setSelectedProduct(null);
      setProductSearch('');
      setLineQty('1');
      setIdempotencyKey(`rcv-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (err: any) => {
      setFormError(err.message || 'Failed to record intake');
    }
  });

  const handleAddLine = () => {
    setFormError(null);
    let prod = selectedProduct;
    if (!prod && searchProducts?.items && searchProducts.items.length > 0) {
      const raw = productSearch.trim();
      const skuMatch = raw.match(/\b(SKU\d{3,})\b/i);
      if (skuMatch) {
        prod = searchProducts.items.find((p) => p.sku.toUpperCase() === skuMatch[1].toUpperCase()) || null;
      }
      if (!prod && searchProducts.items.length === 1) {
        prod = searchProducts.items[0];
      }
    }

    if (!prod) {
      setFormError('Pick a product from the dropdown list (e.g. search "SKU001" or "Mouse" and click it)');
      return;
    }

    const qty = parseInt(lineQty, 10);
    if (isNaN(qty) || qty <= 0) {
      setFormError('Quantity must be a whole number ≥ 1');
      return;
    }

    if (qty > prod.max_receive_qty) {
      setFormError(`Quantity exceeds the limit of ${prod.max_receive_qty} for ${prod.name}`);
      return;
    }

    if (lines.some((l) => l.sku.toUpperCase() === prod!.sku.toUpperCase())) {
      setFormError('Already added — edit its quantity instead');
      return;
    }

    setLines([
      ...lines,
      {
        sku: prod.sku,
        name: prod.name,
        category: prod.category,
        storage_class: prod.storage_class,
        max_receive_qty: prod.max_receive_qty,
        qty
      }
    ]);

    setSelectedProduct(null);
    setProductSearch('');
    setLineQty('1');
  };

  const handleRemoveLine = (sku: string) => {
    setLines(lines.filter((l) => l.sku !== sku));
  };

  const totalUnits = lines.reduce((acc, l) => acc + l.qty, 0);

  return (
    <div className="m3-page">
      <div className="m3-page-header">
        <div>
          <h1>Receiving & Intake</h1>
          <p className="m3-subtitle">Inbound shipments, staged stock management, and directed putaway workflows</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs" role="tablist" aria-label="Receiving sections">
        {canReceive && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'new'}
            className={`tab-btn ${activeTab === 'new' ? 'active' : ''}`}
            onClick={() => setActiveTab('new')}
            data-testid="tab-new-intake"
          >
            New Intake
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'staged'}
          className={`tab-btn ${activeTab === 'staged' ? 'active' : ''}`}
          onClick={() => setActiveTab('staged')}
          data-testid="tab-staged-stock"
        >
          Staged Stock
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'receipts'}
          className={`tab-btn ${activeTab === 'receipts' ? 'active' : ''}`}
          onClick={() => setActiveTab('receipts')}
          data-testid="tab-receipts"
        >
          Receipts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'putaways'}
          className={`tab-btn ${activeTab === 'putaways' ? 'active' : ''}`}
          onClick={() => setActiveTab('putaways')}
          data-testid="tab-putaways"
        >
          Put-aways
        </button>
      </div>

      {/* Tab 1: New Intake */}
      {activeTab === 'new' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 800 }}>
          {successReceipt && (
            <div
              style={{
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid var(--accent-success)',
                borderRadius: 6,
                padding: 16,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
              data-testid="intake-success-banner"
            >
              <div>
                Intake recorded as <strong>{successReceipt}</strong>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setSelectedReceiptRef(successReceipt);
                    setActiveTab('receipts');
                  }}
                >
                  View receipt
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => setActiveTab('staged')}
                >
                  Go to Staged Stock
                </button>
              </div>
            </div>
          )}

          {formError && (
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid var(--accent-danger)',
                color: 'var(--accent-danger)',
                borderRadius: 6,
                padding: 12
              }}
              data-testid="receipt-error-banner"
            >
              {formError}
            </div>
          )}

          {/* Header Fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label>Supplier (optional):</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Acme Distribution"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                data-testid="intake-supplier"
              />
            </div>
            <div>
              <label>Reference No. (optional):</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. PO-88421"
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                data-testid="intake-reference"
              />
            </div>
            <div>
              <label>Received At (defaults to now):</label>
              <input
                type="datetime-local"
                className="input"
                value={receivedAt}
                onChange={(e) => setReceivedAt(e.target.value)}
                data-testid="receipt-received-at"
              />
            </div>
            <div>
              <label>Notes (optional):</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Pallet 1 of 2"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                data-testid="intake-notes"
              />
            </div>
          </div>

          {/* Product Line Addition */}
          <div
            style={{
              padding: 16,
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}
          >
            <h4>Add Intake Line</h4>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ flex: 2, position: 'relative' }}>
                <input
                  type="text"
                  className="input"
                  placeholder="Search product name or SKU..."
                  value={productSearch}
                  onChange={(e) => {
                    setProductSearch(e.target.value);
                    if (selectedProduct) setSelectedProduct(null);
                  }}
                  data-testid="receipt-line-sku"
                />
                {searchProducts && searchProducts.items.length > 0 && !selectedProduct && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 4,
                      zIndex: 10,
                      maxHeight: 200,
                      overflowY: 'auto'
                    }}
                  >
                    {searchProducts.items.map((p) => (
                      <div
                        key={p.sku}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          borderBottom: '1px solid var(--border-color)'
                        }}
                        onClick={() => {
                          setSelectedProduct(p);
                          setProductSearch(`${p.name} (${p.sku})`);
                        }}
                      >
                        <ProductLabel sku={p.sku} name={p.name} />
                        {p.storage_class === 'HAZMAT' && (
                          <span className="badge badge-danger">HAZMAT</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ flex: 1 }}>
                <input
                  type="number"
                  min="1"
                  className="input"
                  placeholder="Qty"
                  value={lineQty}
                  onChange={(e) => setLineQty(e.target.value)}
                  data-testid="receipt-line-qty"
                />
              </div>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleAddLine}
                data-testid="intake-add-line"
              >
                Add Line
              </button>
            </div>
          </div>

          {/* Lines Table */}
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Storage</th>
                  <th>Quantity</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                      No lines added yet. Add at least one product line above.
                    </td>
                  </tr>
                ) : (
                  lines.map((l, i) => (
                    <tr key={l.sku}>
                      <td data-testid={`intake-line-sku-${i}`}><ProductLabel sku={l.sku} name={l.name} /></td>
                      <td>{l.category}</td>
                      <td>
                        {l.storage_class === 'HAZMAT' ? (
                          <span className="badge badge-danger">HAZMAT</span>
                        ) : (
                          <span className="badge badge-info">STD</span>
                        )}
                      </td>
                      <td><strong data-testid={`intake-line-qty-${i}`}>{l.qty}</strong></td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '2px 8px', fontSize: 12 }}
                          onClick={() => handleRemoveLine(l.sku)}
                          data-testid={`intake-line-remove-${i}`}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Summary Strip & Submit */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 12,
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 6
            }}
          >
            <div>
              Total Lines: <strong>{lines.length}</strong> · Total Units: <strong>{totalUnits}</strong>
            </div>
            <button
              className="btn btn-primary"
              disabled={lines.length === 0 || intakeMutation.isPending}
              onClick={() => intakeMutation.mutate()}
              data-testid="intake-submit"
            >
              {intakeMutation.isPending ? 'Confirming...' : 'Confirm Intake'}
            </button>
          </div>
        </div>
      )}

      {/* Tab 2: Staged Stock */}
      {activeTab === 'staged' && (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Product</th>
                <th>Category</th>
                <th>Class</th>
                <th>Received</th>
                <th>Put Away</th>
                <th>Staged</th>
                <th>Received At</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {stagedLoading ? (
                <tr><td colSpan={9}>Loading staged stock...</td></tr>
              ) : !stagedLines || stagedLines.length === 0 ? (
                <tr><td colSpan={9}>No stock currently staged.</td></tr>
              ) : (
                stagedLines.map((row) => (
                  <tr key={row.line_id}>
                    <td><span style={{ fontFamily: 'var(--font-mono)' }}>{row.receipt_ref}</span></td>
                    <td><ProductLabel sku={row.sku} name={row.product_name} /></td>
                    <td>{row.category}</td>
                    <td>
                      {row.storage_class === 'HAZMAT' ? (
                        <span className="badge badge-danger">HAZMAT</span>
                      ) : (
                        <span className="badge badge-info">STD</span>
                      )}
                    </td>
                    <td>{row.qty_received}</td>
                    <td>{row.qty_put_away}</td>
                    <td><strong>{row.qty_staged}</strong></td>
                    <td>{new Date(row.received_at).toLocaleString()}</td>
                    <td>
                      {canPutaway ? (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '2px 8px', fontSize: 12 }}
                          onClick={() => setSelectedLineForAlloc(row)}
                          data-testid={`staged-allocate-${row.line_id}`}
                        >
                          Allocate
                        </button>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Read-only</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedLineForAlloc && (
        <AllocationModal
          receiptLine={selectedLineForAlloc}
          onClose={() => setSelectedLineForAlloc(null)}
        />
      )}

      {/* Tab 3: Receipts List */}
      {activeTab === 'receipts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ maxWidth: 360 }}>
            <input
              type="text"
              placeholder="Search receipts..."
              className="input"
              value={receiptsSearch}
              onChange={(e) => setReceiptsSearch(e.target.value)}
            />
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Status</th>
                  <th>Supplier</th>
                  <th>Ref No.</th>
                  <th>Lines</th>
                  <th>Units</th>
                  <th>Received By</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {receiptsLoading ? (
                  <tr><td colSpan={9}>Loading receipts...</td></tr>
                ) : !receiptsData || receiptsData.items.length === 0 ? (
                  <tr><td colSpan={9}>No receipts found.</td></tr>
                ) : (
                  receiptsData.items.map((r) => (
                    <tr
                      key={r.ref}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSelectedReceiptRef(r.ref)}
                    >
                      <td><strong>{r.ref}</strong></td>
                      <td><StatusBadge status={r.status} /></td>
                      <td>{r.supplier || '—'}</td>
                      <td>{r.reference_no || '—'}</td>
                      <td>{r.line_count}</td>
                      <td>{r.total_units}</td>
                      <td>{r.received_by_name}</td>
                      <td>{new Date(r.received_at).toLocaleString()}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPrintReceiptRef(r.ref);
                            setLabelModalOpen(true);
                          }}
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

      {/* Receipt Detail Drawer */}
      {selectedReceiptRef && receiptDetail && (
        <div className="drawer-backdrop" onClick={() => setSelectedReceiptRef(null)}>
          <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h3 style={{ margin: 0 }}>Receipt: {receiptDetail.ref}</h3>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setPrintReceiptRef(receiptDetail.ref);
                    setLabelModalOpen(true);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}
                >
                  🏷️ Print Label
                </button>
              </div>
              <button className="btn btn-secondary" onClick={() => setSelectedReceiptRef(null)}>
                Close
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><strong>Status:</strong> <StatusBadge status={receiptDetail.status} /></div>
              <div><strong>Supplier:</strong> {receiptDetail.supplier || '—'}</div>
              <div><strong>Ref No:</strong> {receiptDetail.reference_no || '—'}</div>
              <div><strong>Received By:</strong> {receiptDetail.received_by.name}</div>
              <div><strong>Received At:</strong> {new Date(receiptDetail.received_at).toLocaleString()}</div>
            </div>

            {receiptDetail.notes && (
              <div style={{ padding: 10, backgroundColor: 'var(--bg-surface)', borderRadius: 4, fontSize: 13 }}>
                <strong>Notes:</strong> {receiptDetail.notes}
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <h4>Lines</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {receiptDetail.lines.map((l) => (
                  <div
                    key={l.line_id}
                    style={{
                      padding: 10,
                      backgroundColor: 'var(--bg-surface)',
                      borderRadius: 6,
                      fontSize: 12
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <ProductLabel sku={l.sku} name={l.product_name} />
                      <span>{l.movement_ref}</span>
                    </div>
                    <div style={{ marginTop: 4 }}>
                      Received: <strong>{l.qty_received}</strong> · Put away: {l.qty_put_away} · Staged: <strong>{l.qty_staged}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <h4>Audit History</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {receiptDetail.audit_log.map((a) => (
                  <div key={a.id} style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {new Date(a.occurred_at).toLocaleTimeString()} · {a.action} by {a.actor_name || 'System'}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Put-aways */}
      {activeTab === 'putaways' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Completed Put-aways</h3>
            <span className="text-muted" style={{ fontSize: 13 }}>
              {putawaysData?.putaways.length || 0} records
            </span>
          </div>

          {putawaysLoading ? (
            <div style={{ padding: 24, textAlign: 'center' }}>Loading put-aways…</div>
          ) : !putawaysData || putawaysData.putaways.length === 0 ? (
            <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
              No put-aways recorded yet. Confirm allocations from Staged Stock to complete put-aways.
            </div>
          ) : (
            <div className="table-container">
              <table data-testid="putaways-table">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Receipt</th>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Destination</th>
                    <th>Mode</th>
                    <th>Operator</th>
                    <th>Time</th>
                    <th>Movement</th>
                  </tr>
                </thead>
                <tbody>
                  {putawaysData.putaways.map((p) => (
                    <tr key={p.id}>
                      <td><strong>{p.ref}</strong></td>
                      <td>{p.receipt_ref}</td>
                      <td><ProductLabel sku={p.sku} name={p.product_name} /></td>
                      <td><strong>{p.qty}</strong></td>
                      <td>{p.dest_shelf} / <strong>{p.dest_bin}</strong></td>
                      <td>
                        {p.selection_mode === 'RECOMMENDED' ? (
                          <span className="badge badge-active">RECOMMENDED</span>
                        ) : (
                          <span className="badge badge-warning">MANUAL</span>
                        )}
                      </td>
                      <td>{p.performed_by}</td>
                      <td style={{ fontSize: 12 }}>{new Date(p.created_at).toLocaleString()}</td>
                      <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{p.movement_ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Label Print Modal */}
      <LabelPrintModal
        isOpen={labelModalOpen}
        onClose={() => setLabelModalOpen(false)}
        initialTab="receipt"
        initialValue={printReceiptRef}
      />
    </div>
  );
};
