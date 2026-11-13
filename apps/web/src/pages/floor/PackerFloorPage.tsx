import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PackSessionDTO } from '@dark-storage/shared';
import { useAuthStore } from '../../stores/authStore.js';
import { useCan } from '../../hooks/useCan.js';

export const PackerFloorPage: React.FC = () => {
  const token = useAuthStore((s) => s.token);
  const queryClient = useQueryClient();
  const canRegenOtp = useCan('dispatch:regen_otp');

  const [activeTab, setActiveTab] = useState<'PACK' | 'DISPATCH'>('PACK');

  // Pack Bench state
  const [toteScanInput, setToteScanInput] = useState('');
  const [itemScanInput, setItemScanInput] = useState('');
  const [weightInput, setWeightInput] = useState('');
  const [slotScanInput, setSlotScanInput] = useState('');
  const [currentSession, setCurrentSession] = useState<PackSessionDTO | null>(null);
  const [flagItemTarget, setFlagItemTarget] = useState<{ sku: string; maxQty: number } | null>(null);
  const [flagKind, setFlagKind] = useState<'MISSING' | 'DAMAGED'>('DAMAGED');
  const [flagQty, setFlagQty] = useState(1);
  const [flagNote, setFlagNote] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Dispatch Handover state
  const [selectedOrderRef, setSelectedOrderRef] = useState<string | null>(null);
  const [handoverSlotScan, setHandoverSlotScan] = useState('');
  const [riderName, setRiderName] = useState('Rider');
  const [riderOtp, setRiderOtp] = useState('');
  const [demoOtpValue, setDemoOtpValue] = useState<string | null>(null);
  const [dispatchFeedback, setDispatchFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const toteInputRef = useRef<HTMLInputElement>(null);
  const itemInputRef = useRef<HTMLInputElement>(null);

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';

  // 1. Query Packing Queue (for helper view)
  const { data: packQueueData, refetch: refetchPackQueue } = useQuery<{ items: any[] }>({
    queryKey: ['packingQueueFloor'],
    queryFn: async () => {
      const res = await fetch('/api/packing/queue', { headers: authHeaders });
      if (!res.ok) return { items: [] };
      return res.json();
    },
    refetchInterval: 10000,
    enabled: activeTab === 'PACK' && !currentSession
  });

  // 2. Query Dispatch Queue
  const { data: dispatchQueue, refetch: refetchDispatchQueue } = useQuery<any[]>({
    queryKey: ['dispatchQueueFloor'],
    queryFn: async () => {
      const res = await fetch('/api/dispatch/queue', { headers: authHeaders });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 5000,
    enabled: activeTab === 'DISPATCH'
  });

  // Open Pack Session Mutation
  const openSessionMutation = useMutation({
    mutationFn: async (toteScan: string) => {
      const res = await fetch('/api/packing/open', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ toteScan })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Failed to open pack session (${res.status})`);
      }
      return res.json() as Promise<PackSessionDTO>;
    },
    onSuccess: (session) => {
      setCurrentSession(session);
      setToteScanInput('');
      setFeedback({ type: 'success', message: `Pack session opened for order ${session.orderRef} in ${session.toteCode}` });
      setTimeout(() => itemInputRef.current?.focus(), 100);
    },
    onError: (err: any) => {
      setFeedback({ type: 'error', message: err.message });
      toteInputRef.current?.focus();
    }
  });

  // Scan Pack Item Mutation
  const scanItemMutation = useMutation({
    mutationFn: async (scan: string) => {
      if (!currentSession) throw new Error('No active session');
      const res = await fetch(`/api/packing/sessions/${currentSession.sessionId}/scan-item`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ scan })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Item scan rejected (${res.status})`);
      }
      return res.json() as Promise<PackSessionDTO>;
    },
    onSuccess: (session) => {
      setCurrentSession(session);
      setItemScanInput('');
      setFeedback({ type: 'success', message: 'Item scanned successfully' });
      itemInputRef.current?.focus();
    },
    onError: (err: any) => {
      setFeedback({ type: 'error', message: err.message });
      itemInputRef.current?.focus();
    }
  });

  // Flag Item Mutation
  const flagItemMutation = useMutation({
    mutationFn: async (params: { sku: string; qty: number; kind: 'MISSING' | 'DAMAGED'; note?: string }) => {
      if (!currentSession) throw new Error('No active session');
      const res = await fetch(`/api/packing/sessions/${currentSession.sessionId}/flag-item`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(params)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Flagging failed (${res.status})`);
      }
      return res.json() as Promise<PackSessionDTO>;
    },
    onSuccess: (session) => {
      setCurrentSession(session);
      setFlagItemTarget(null);
      setFlagNote('');
      setFeedback({ type: 'success', message: `Item flagged as ${flagKind}. Repick task auto-created.` });
    },
    onError: (err: any) => {
      setFeedback({ type: 'error', message: err.message });
    }
  });

  // Scale Weigh Mutation
  const weighMutation = useMutation({
    mutationFn: async (grams: number) => {
      if (!currentSession) throw new Error('No active session');
      const res = await fetch(`/api/packing/sessions/${currentSession.sessionId}/weigh`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ grams })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Weight check failed (${res.status})`);
      }
      return res.json() as Promise<PackSessionDTO>;
    },
    onSuccess: (session) => {
      setCurrentSession(session);
      setFeedback({ type: 'success', message: `Scale weight verified (${session.actualWeightG}g)` });
    },
    onError: (err: any) => {
      setFeedback({ type: 'error', message: err.message });
    }
  });

  // Complete Pack Mutation
  const completePackMutation = useMutation({
    mutationFn: async (params: { slotScan: string }) => {
      if (!currentSession) throw new Error('No active session');
      const res = await fetch(`/api/packing/sessions/${currentSession.sessionId}/complete`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(params)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Complete pack failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (result) => {
      setFeedback({
        type: 'success',
        message: `Order ${result.orderRef} packed & staged in ${result.slotCode}! Tote freed. Rider OTP generated.`
      });
      setCurrentSession(null);
      setSlotScanInput('');
      setWeightInput('');
      refetchPackQueue();
      queryClient.invalidateQueries({ queryKey: ['dispatchQueueFloor'] });
    },
    onError: (err: any) => {
      setFeedback({ type: 'error', message: err.message });
    }
  });

  // Handover Mutation
  const handoverMutation = useMutation({
    mutationFn: async (params: { orderRef: string; slotScan: string; otp: string; riderName?: string }) => {
      const res = await fetch(`/api/dispatch/${params.orderRef}/handover`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(params)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Handover failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (result) => {
      setDispatchFeedback({
        type: 'success',
        message: `Order ${result.orderRef} successfully handed over to rider! Slot ${result.slotCode} is now free.`
      });
      setSelectedOrderRef(null);
      setHandoverSlotScan('');
      setRiderOtp('');
      setDemoOtpValue(null);
      refetchDispatchQueue();
    },
    onError: (err: any) => {
      setDispatchFeedback({ type: 'error', message: err.message });
      refetchDispatchQueue();
    }
  });

  // Fetch Demo OTP
  const handleFetchDemoOtp = async (orderRef: string) => {
    try {
      const res = await fetch(`/api/dispatch/demo-otp/${orderRef}`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setDemoOtpValue(data.otp);
        setRiderOtp(data.otp);
      }
    } catch {
      // Demo OTP fetch fallback
    }
  };

  // Regen OTP Mutation
  const regenOtpMutation = useMutation({
    mutationFn: async (orderRef: string) => {
      const res = await fetch(`/api/dispatch/${orderRef}/regen-otp`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ reasonCode: 'CUSTOMER_PHONE_UPDATE', note: 'Regenerated by Manager' })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || `OTP regen failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (result) => {
      setDispatchFeedback({ type: 'success', message: `Fresh OTP generated for ${result.orderRef}. Locked status reset.` });
      refetchDispatchQueue();
    },
    onError: (err: any) => {
      setDispatchFeedback({ type: 'error', message: err.message });
    }
  });

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '16px', color: '#f3f4f6' }}>
      {/* Top Banner / Tab Switcher */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #374151', paddingBottom: '12px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: '#f59e0b' }}>
            STAFF FLOOR STATION
          </h1>
          <span style={{ fontSize: '12px', color: '#9ca3af' }}>Industrial PDA Mode • Bench BENCH-1</span>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            data-testid="tab-packing-bench"
            onClick={() => setActiveTab('PACK')}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              fontWeight: 700,
              fontSize: '14px',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'PACK' ? '#f59e0b' : '#1f2937',
              color: activeTab === 'PACK' ? '#111827' : '#d1d5db'
            }}
          >
            📦 Packing Bench
          </button>
          <button
            data-testid="tab-dispatch-handover"
            onClick={() => setActiveTab('DISPATCH')}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              fontWeight: 700,
              fontSize: '14px',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'DISPATCH' ? '#10b981' : '#1f2937',
              color: activeTab === 'DISPATCH' ? '#111827' : '#d1d5db'
            }}
          >
            🛵 Dispatch Handover ({dispatchQueue?.length || 0})
          </button>
        </div>
      </div>

      {/* Feedback Toast */}
      {(feedback && activeTab === 'PACK') && (
        <div
          data-testid="pack-feedback"
          style={{
            padding: '12px 16px',
            borderRadius: '6px',
            marginBottom: '16px',
            fontWeight: 600,
            backgroundColor: feedback.type === 'success' ? '#065f46' : '#991b1b',
            color: '#ffffff'
          }}
        >
          {feedback.message}
        </div>
      )}

      {(dispatchFeedback && activeTab === 'DISPATCH') && (
        <div
          data-testid="dispatch-feedback"
          style={{
            padding: '12px 16px',
            borderRadius: '6px',
            marginBottom: '16px',
            fontWeight: 600,
            backgroundColor: dispatchFeedback.type === 'success' ? '#065f46' : '#991b1b',
            color: '#ffffff'
          }}
        >
          {dispatchFeedback.message}
        </div>
      )}

      {/* ==================== TAB 1: PACKING BENCH ==================== */}
      {activeTab === 'PACK' && (
        <div>
          {!currentSession ? (
            <div>
              {/* Scan Tote to Begin */}
              <div style={{ backgroundColor: '#111827', border: '2px solid #374151', borderRadius: '8px', padding: '24px', textAlign: 'center', marginBottom: '24px' }}>
                <h2 style={{ margin: '0 0 8px 0', fontSize: '1.25rem' }}>Scan Tote to Activate Pack Bench</h2>
                <p style={{ margin: '0 0 16px 0', color: '#9ca3af', fontSize: '14px' }}>
                  Scan barcode of a picked tote (e.g. TOTE-001) awaiting pack
                </p>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (toteScanInput.trim()) openSessionMutation.mutate(toteScanInput.trim());
                  }}
                  style={{ display: 'flex', gap: '8px', maxWidth: '440px', margin: '0 auto' }}
                >
                  <input
                    ref={toteInputRef}
                    data-testid="tote-scan-input"
                    type="text"
                    value={toteScanInput}
                    onChange={(e) => setToteScanInput(e.target.value)}
                    placeholder="Scan TOTE barcode..."
                    autoFocus
                    style={{
                      flex: 1,
                      padding: '12px 16px',
                      backgroundColor: '#1f2937',
                      border: '2px solid #4b5563',
                      borderRadius: '6px',
                      color: '#ffffff',
                      fontSize: '16px',
                      fontFamily: 'monospace'
                    }}
                  />
                  <button
                    data-testid="btn-open-pack"
                    type="submit"
                    disabled={openSessionMutation.isPending || !toteScanInput.trim()}
                    style={{
                      padding: '12px 20px',
                      backgroundColor: '#f59e0b',
                      color: '#111827',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    {openSessionMutation.isPending ? 'Opening...' : 'Open'}
                  </button>
                </form>
              </div>

              {/* Ready to Pack Queue Preview */}
              <div style={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', padding: '16px' }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: '#9ca3af', textTransform: 'uppercase' }}>
                  Orders Awaiting Packing ({packQueueData?.items?.length || 0})
                </h3>
                {(!packQueueData?.items || packQueueData.items.length === 0) ? (
                  <p style={{ color: '#6b7280', margin: 0 }}>No orders currently awaiting packing.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {packQueueData.items.map((item: any) => (
                      <div
                        key={item.order_ref}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '10px 14px',
                          backgroundColor: '#1f2937',
                          borderRadius: '6px',
                          border: '1px solid #374151'
                        }}
                      >
                        <div>
                          <strong style={{ color: '#f59e0b' }}>{item.order_ref}</strong>
                          <span style={{ marginLeft: '12px', fontSize: '13px', color: '#9ca3af' }}>
                            {item.lines?.length || 0} line(s) • Priority: {item.priority}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            // Find active tote or default
                            setToteScanInput('TOTE-001');
                            openSessionMutation.mutate('TOTE-001');
                          }}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#374151',
                            color: '#ffffff',
                            border: '1px solid #4b5563',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          Pack TOTE-001
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              {/* Active Session Info Header */}
              <div style={{ backgroundColor: '#111827', border: '2px solid #f59e0b', borderRadius: '8px', padding: '16px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontSize: '12px', color: '#9ca3af', textTransform: 'uppercase' }}>Active Pack Session #{currentSession.sessionId}</span>
                  <h2 style={{ margin: '2px 0 0 0', fontSize: '1.3rem', color: '#ffffff' }}>
                    Order: <span style={{ color: '#f59e0b' }}>{currentSession.orderRef}</span>
                  </h2>
                  <div style={{ display: 'flex', gap: '16px', marginTop: '6px', fontSize: '13px', color: '#9ca3af' }}>
                    <span>Tote: <strong style={{ color: '#ffffff' }}>{currentSession.toteCode}</strong></span>
                    <span>Bench: <strong style={{ color: '#ffffff' }}>{currentSession.benchCode}</strong></span>
                    <span>Status: <strong style={{ color: '#10b981' }}>{currentSession.status}</strong></span>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '12px', color: '#9ca3af' }}>Expected Total Weight</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: currentSession.weightOk ? '#10b981' : '#f59e0b' }}>
                    {currentSession.expectedWeightG}g
                  </div>
                  <span style={{ fontSize: '11px', color: currentSession.weightOk ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                    {currentSession.weightOk ? '✅ Weight Verified' : '⚠️ Scale Check Required'}
                  </span>
                </div>
              </div>

              {/* Order Lines Checklist */}
              <div style={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: '#9ca3af', textTransform: 'uppercase' }}>
                  Order Lines Verification
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {currentSession.lines.map((line) => {
                    const isLineComplete = line.scannedQty + line.flaggedQty === line.expectedQty;
                    return (
                      <div
                        key={line.sku}
                        data-testid={`pack-line-${line.sku}`}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '12px 16px',
                          borderRadius: '6px',
                          backgroundColor: isLineComplete ? '#064e3b' : '#1f2937',
                          border: `1px solid ${isLineComplete ? '#059669' : '#374151'}`
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '15px' }}>{line.productName}</div>
                          <div style={{ fontSize: '12px', color: '#9ca3af', fontFamily: 'monospace' }}>
                            SKU: {line.sku} • Barcode: {line.barcode}
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '16px', fontWeight: 800 }}>
                              <span style={{ color: '#10b981' }}>{line.scannedQty}</span>
                              {line.flaggedQty > 0 && <span style={{ color: '#ef4444' }}> +{line.flaggedQty} flagged</span>}
                              <span style={{ color: '#9ca3af' }}> / {line.expectedQty}</span>
                            </div>
                            <span style={{ fontSize: '11px', color: isLineComplete ? '#10b981' : '#f59e0b' }}>
                              {isLineComplete ? 'Complete' : 'Pending Scan'}
                            </span>
                          </div>

                          {!isLineComplete && (
                            <button
                              onClick={() => {
                                setFlagItemTarget({ sku: line.sku, maxQty: line.expectedQty - line.scannedQty - line.flaggedQty });
                                setFlagQty(1);
                              }}
                              style={{
                                padding: '6px 10px',
                                backgroundColor: '#7f1d1d',
                                color: '#fca5a5',
                                border: '1px solid #991b1b',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: 'pointer'
                              }}
                            >
                              Flag
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Item Barcode Scanner Input */}
              <div style={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '1rem', color: '#f59e0b' }}>Scan Item Barcode</h3>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (itemScanInput.trim()) scanItemMutation.mutate(itemScanInput.trim());
                  }}
                  style={{ display: 'flex', gap: '8px' }}
                >
                  <input
                    ref={itemInputRef}
                    data-testid="item-scan-input"
                    type="text"
                    value={itemScanInput}
                    onChange={(e) => setItemScanInput(e.target.value)}
                    placeholder="Scan product barcode / SKU..."
                    autoFocus
                    style={{
                      flex: 1,
                      padding: '12px 16px',
                      backgroundColor: '#1f2937',
                      border: '2px solid #4b5563',
                      borderRadius: '6px',
                      color: '#ffffff',
                      fontSize: '16px',
                      fontFamily: 'monospace'
                    }}
                  />
                  <button
                    data-testid="btn-scan-item"
                    type="submit"
                    disabled={scanItemMutation.isPending || !itemScanInput.trim()}
                    style={{
                      padding: '12px 20px',
                      backgroundColor: '#f59e0b',
                      color: '#111827',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    {scanItemMutation.isPending ? 'Verifying...' : 'Scan Item'}
                  </button>
                </form>
              </div>

              {/* Scale Weigh Check & Target Dispatch Slot Section */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                {/* Scale Weight */}
                <div style={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', padding: '16px' }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#9ca3af', textTransform: 'uppercase' }}>
                    Scale Weight Check
                  </h4>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      data-testid="scale-weight-input"
                      type="number"
                      value={weightInput}
                      onChange={(e) => setWeightInput(e.target.value)}
                      placeholder={`e.g. ${currentSession.expectedWeightG}`}
                      style={{
                        flex: 1,
                        padding: '10px 14px',
                        backgroundColor: '#1f2937',
                        border: '1px solid #4b5563',
                        borderRadius: '6px',
                        color: '#ffffff',
                        fontSize: '15px'
                      }}
                    />
                    <button
                      data-testid="btn-verify-weight"
                      type="button"
                      onClick={() => {
                        const grams = Number(weightInput || currentSession.expectedWeightG);
                        weighMutation.mutate(grams);
                      }}
                      style={{
                        padding: '10px 16px',
                        backgroundColor: '#2563eb',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Verify
                    </button>
                  </div>
                  <div style={{ marginTop: '8px', fontSize: '12px', color: '#9ca3af' }}>
                    Expected: {currentSession.expectedWeightG}g (includes 40g bag tare)
                  </div>
                </div>

                {/* Target Dispatch Slot */}
                <div style={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', padding: '16px' }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#9ca3af', textTransform: 'uppercase' }}>
                    Stage into Dispatch Slot
                  </h4>
                  <input
                    data-testid="dispatch-slot-scan-input"
                    type="text"
                    value={slotScanInput}
                    onChange={(e) => setSlotScanInput(e.target.value)}
                    placeholder="Scan Slot (e.g. D-1..D-8)..."
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      backgroundColor: '#1f2937',
                      border: '1px solid #4b5563',
                      borderRadius: '6px',
                      color: '#ffffff',
                      fontSize: '15px',
                      fontFamily: 'monospace',
                      boxSizing: 'border-box'
                    }}
                  />
                  <div style={{ marginTop: '8px', fontSize: '12px', color: '#9ca3af' }}>
                    Free staging slots: D-1 through D-8
                  </div>
                </div>
              </div>

              {/* Complete Pack Button */}
              <button
                data-testid="btn-complete-pack"
                disabled={!currentSession.canComplete || !slotScanInput.trim() || completePackMutation.isPending}
                onClick={() => completePackMutation.mutate({ slotScan: slotScanInput.trim() })}
                style={{
                  width: '100%',
                  padding: '16px',
                  backgroundColor: (currentSession.canComplete && slotScanInput.trim()) ? '#10b981' : '#374151',
                  color: (currentSession.canComplete && slotScanInput.trim()) ? '#111827' : '#9ca3af',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: 800,
                  cursor: (currentSession.canComplete && slotScanInput.trim()) ? 'pointer' : 'not-allowed',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}
              >
                {completePackMutation.isPending ? 'Staging & Finalizing...' : 'Complete Pack & Stage for Rider'}
              </button>
            </div>
          )}

          {/* Flag Item Dialog Modal */}
          {flagItemTarget && (
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.7)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 1000
              }}
            >
              <div style={{ backgroundColor: '#111827', border: '2px solid #ef4444', borderRadius: '8px', padding: '24px', maxWidth: '400px', width: '100%' }}>
                <h3 style={{ margin: '0 0 16px 0', color: '#ef4444' }}>Flag Item: {flagItemTarget.sku}</h3>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>Exception Reason:</label>
                  <select
                    value={flagKind}
                    onChange={(e: any) => setFlagKind(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', backgroundColor: '#1f2937', color: '#fff', border: '1px solid #4b5563', borderRadius: '4px' }}
                  >
                    <option value="DAMAGED">DAMAGED (Move to QUAR & Repick)</option>
                    <option value="MISSING">MISSING (Order shortfall & Repick)</option>
                  </select>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>Quantity (Max {flagItemTarget.maxQty}):</label>
                  <input
                    type="number"
                    min={1}
                    max={flagItemTarget.maxQty}
                    value={flagQty}
                    onChange={(e) => setFlagQty(Number(e.target.value))}
                    style={{ width: '100%', padding: '8px 12px', backgroundColor: '#1f2937', color: '#fff', border: '1px solid #4b5563', borderRadius: '4px', boxSizing: 'border-box' }}
                  />
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>Note (Optional):</label>
                  <input
                    type="text"
                    value={flagNote}
                    onChange={(e) => setFlagNote(e.target.value)}
                    placeholder="e.g. Torn box, punctured seal..."
                    style={{ width: '100%', padding: '8px 12px', backgroundColor: '#1f2937', color: '#fff', border: '1px solid #4b5563', borderRadius: '4px', boxSizing: 'border-box' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setFlagItemTarget(null)}
                    style={{ padding: '8px 16px', backgroundColor: '#374151', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      flagItemMutation.mutate({
                        sku: flagItemTarget.sku,
                        qty: flagQty,
                        kind: flagKind,
                        note: flagNote
                      });
                    }}
                    style={{ padding: '8px 16px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Confirm Flag
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 2: DISPATCH HANDOVER ==================== */}
      {activeTab === 'DISPATCH' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px', marginBottom: '24px' }}>
            {(!dispatchQueue || dispatchQueue.length === 0) ? (
              <div style={{ gridColumn: '1 / -1', padding: '32px', textAlign: 'center', backgroundColor: '#111827', borderRadius: '8px', color: '#9ca3af' }}>
                No packed orders staged in dispatch slots. Complete a pack session to stage for rider.
              </div>
            ) : (
              dispatchQueue.map((slot) => {
                const isSelected = selectedOrderRef === slot.orderRef;
                return (
                  <div
                    key={slot.slotCode}
                    data-testid={`dispatch-slot-${slot.slotCode}`}
                    onClick={() => {
                      setSelectedOrderRef(slot.orderRef);
                      setHandoverSlotScan(slot.slotCode);
                      setDemoOtpValue(null);
                      if (isDemo) handleFetchDemoOtp(slot.orderRef);
                    }}
                    style={{
                      padding: '16px',
                      backgroundColor: isSelected ? '#064e3b' : '#111827',
                      border: `2px solid ${isSelected ? '#10b981' : slot.locked ? '#ef4444' : '#374151'}`,
                      borderRadius: '8px',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '1.25rem', color: '#f59e0b' }}>{slot.slotCode}</strong>
                      {slot.locked ? (
                        <span style={{ fontSize: '11px', color: '#ef4444', fontWeight: 800 }}>🔒 LOCKED</span>
                      ) : (
                        <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 700 }}>STAGED</span>
                      )}
                    </div>
                    <div style={{ marginTop: '8px', fontWeight: 700, fontSize: '14px' }}>{slot.orderRef}</div>
                    <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>
                      Attempts: {slot.attempts} / 3
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Selected Order Handover Card */}
          {selectedOrderRef && (
            <div style={{ backgroundColor: '#111827', border: '2px solid #10b981', borderRadius: '8px', padding: '24px' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '1.2rem', color: '#10b981' }}>
                Rider Handover Verification: {selectedOrderRef}
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>Confirm Dispatch Slot Scan:</label>
                  <input
                    data-testid="handover-slot-input"
                    type="text"
                    value={handoverSlotScan}
                    onChange={(e) => setHandoverSlotScan(e.target.value)}
                    placeholder="Scan D-1..D-8..."
                    style={{ width: '100%', padding: '10px 14px', backgroundColor: '#1f2937', color: '#fff', border: '1px solid #4b5563', borderRadius: '6px', fontFamily: 'monospace', boxSizing: 'border-box' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>Rider Name / Partner:</label>
                  <input
                    data-testid="rider-name-input"
                    type="text"
                    value={riderName}
                    onChange={(e) => setRiderName(e.target.value)}
                    placeholder="e.g. Zepto Rider Suresh"
                    style={{ width: '100%', padding: '10px 14px', backgroundColor: '#1f2937', color: '#fff', border: '1px solid #4b5563', borderRadius: '6px', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label style={{ fontSize: '13px', color: '#9ca3af' }}>Enter 4-Digit Rider OTP:</label>
                  {isDemo && (
                    <button
                      type="button"
                      onClick={() => handleFetchDemoOtp(selectedOrderRef)}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: '#374151',
                        color: '#f59e0b',
                        border: '1px solid #f59e0b',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      💡 Show Demo Rider OTP {demoOtpValue ? `(${demoOtpValue})` : ''}
                    </button>
                  )}
                </div>
                <input
                  data-testid="rider-otp-input"
                  type="text"
                  maxLength={4}
                  value={riderOtp}
                  onChange={(e) => setRiderOtp(e.target.value)}
                  placeholder="e.g. 1234"
                  style={{
                    width: '100%',
                    padding: '14px',
                    backgroundColor: '#1f2937',
                    color: '#ffffff',
                    border: '2px solid #10b981',
                    borderRadius: '6px',
                    fontSize: '22px',
                    fontFamily: 'monospace',
                    letterSpacing: '0.25em',
                    textAlign: 'center',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  data-testid="btn-handover-order"
                  disabled={!handoverSlotScan.trim() || riderOtp.length !== 4 || handoverMutation.isPending}
                  onClick={() => {
                    handoverMutation.mutate({
                      orderRef: selectedOrderRef,
                      slotScan: handoverSlotScan.trim(),
                      otp: riderOtp.trim(),
                      riderName
                    });
                  }}
                  style={{
                    flex: 1,
                    padding: '14px',
                    backgroundColor: (handoverSlotScan.trim() && riderOtp.length === 4) ? '#10b981' : '#374151',
                    color: (handoverSlotScan.trim() && riderOtp.length === 4) ? '#111827' : '#9ca3af',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '16px',
                    fontWeight: 800,
                    cursor: (handoverSlotScan.trim() && riderOtp.length === 4) ? 'pointer' : 'not-allowed',
                    textTransform: 'uppercase'
                  }}
                >
                  {handoverMutation.isPending ? 'Validating Handover...' : 'Handover Order to Rider'}
                </button>

                {canRegenOtp && (
                  <button
                    type="button"
                    onClick={() => regenOtpMutation.mutate(selectedOrderRef)}
                    style={{
                      padding: '14px 16px',
                      backgroundColor: '#4b5563',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    Regen OTP
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
