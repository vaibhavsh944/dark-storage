import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PickerMissionDTO } from '@dark-storage/shared';
import { useAuthStore } from '../../stores/authStore.js';

export const PickerFloorPage: React.FC = () => {
  const token = useAuthStore((s) => s.token);
  const queryClient = useQueryClient();

  const [scanInput, setScanInput] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // 1. Query active mission
  const {
    data: mission,
    isLoading: isMissionLoading,
    refetch: refetchMission
  } = useQuery<PickerMissionDTO | null>({
    queryKey: ['pickerActiveMission'],
    queryFn: async () => {
      const res = await fetch('/api/picker/mission', { headers: authHeaders });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    refetchInterval: 10000
  });

  // 2. Query claimable picker floor tasks (REPICK, PUTBACK) when idle
  const { data: floorTasks, refetch: refetchTasks } = useQuery<any[]>({
    queryKey: ['pickerFloorTasks'],
    queryFn: async () => {
      const res = await fetch('/api/floor-tasks?status=OPEN', { headers: authHeaders });
      if (!res.ok) return [];
      const all = await res.json();
      return (all || []).filter((t: any) => ['REPICK', 'PUTBACK'].includes(t.type));
    },
    enabled: !mission
  });

  // 3. Heartbeat loop (every 15s when active mission exists)
  useEffect(() => {
    if (!mission || !mission.missionRef) return;

    const timer = setInterval(async () => {
      try {
        await fetch(`/api/missions/${mission.missionRef}/heartbeat`, {
          method: 'POST',
          headers: authHeaders
        });
      } catch (e) {
        console.error('Heartbeat failed:', e);
      }
    }, 15000);

    return () => clearInterval(timer);
  }, [mission?.missionRef, token]);

  // 4. Lease countdown timer
  useEffect(() => {
    if (!mission?.leaseExpiresAt) {
      setRemainingSec(null);
      return;
    }

    const updateTimer = () => {
      const diff = Math.max(0, Math.floor((new Date(mission.leaseExpiresAt!).getTime() - Date.now()) / 1000));
      setRemainingSec(diff);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [mission?.leaseExpiresAt]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, [mission]);

  // Claim next mission mutation
  const claimMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/missions/claim-next', {
        method: 'POST',
        headers: authHeaders
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || err.message || 'Failed to claim mission');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setFeedback({ type: 'success', message: `Mission ${data.missionRef} claimed!` });
      queryClient.setQueryData(['pickerActiveMission'], data);
    },
    onError: (err: any) => {
      setFeedback({ type: 'error', message: err.message });
    }
  });

  // Scan mutations
  const scanMutation = useMutation({
    mutationFn: async ({ stopRef, step, scan, qty }: { stopRef: string; step: string; scan: string; qty?: number }) => {
      let endpoint = '';
      let body: any = { scan };

      if (step === 'PENDING') {
        endpoint = `/api/pick-stops/${stopRef}/scan-bin`;
      } else if (step === 'BIN_OK') {
        endpoint = `/api/pick-stops/${stopRef}/scan-item`;
        body.qty = qty || 1;
      } else if (step === 'ITEM_OK') {
        endpoint = `/api/pick-stops/${stopRef}/scan-tote`;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Idempotency-Key': `scan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || err.message || 'Scan failed');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setScanInput('');
      setFeedback({ type: 'success', message: `Step verified: ${data.step}` });
      if (data.mission) {
        queryClient.setQueryData(['pickerActiveMission'], data.mission);
      } else {
        refetchMission();
      }
      inputRef.current?.focus();
    },
    onError: (err: any) => {
      setScanInput('');
      setFeedback({ type: 'error', message: err.message });
      inputRef.current?.focus();
    }
  });

  // Active stop in mission
  const activeStop = mission?.stops.find((s) => !['DONE', 'SHORT', 'CANCELLED'].includes(s.step));

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanInput.trim() || !activeStop) return;

    scanMutation.mutate({
      stopRef: activeStop.stopRef || String(activeStop.stopId),
      step: activeStop.step,
      scan: scanInput.trim(),
      qty: activeStop.qtyToPick
    });
  };

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', padding: '1rem', fontFamily: 'system-ui, sans-serif' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #333', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800 }}>FLOOR PICKING PDA</h1>
        {mission && (
          <span style={{ background: '#222', color: '#fff', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.85rem', fontWeight: 'bold' }}>
            {remainingSec !== null ? `Lease: ${Math.floor(remainingSec / 60)}m ${remainingSec % 60}s` : ''}
          </span>
        )}
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div style={{
          padding: '0.75rem 1rem',
          borderRadius: '4px',
          marginBottom: '1rem',
          fontWeight: 700,
          background: feedback.type === 'success' ? '#e6f4ea' : '#fce8e6',
          color: feedback.type === 'success' ? '#137333' : '#c5221f',
          border: `1px solid ${feedback.type === 'success' ? '#34a853' : '#ea4335'}`
        }}>
          {feedback.message}
        </div>
      )}

      {/* Case 1: No Active Mission */}
      {!mission && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ padding: '2rem 1rem', background: '#f8f9fa', border: '2px dashed #bbb', borderRadius: '8px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 1.5rem 0', fontSize: '1.1rem', color: '#555' }}>No active mission assigned to your device.</p>
            <button
              onClick={() => claimMutation.mutate()}
              disabled={claimMutation.isPending}
              style={{
                width: '100%',
                padding: '1.25rem',
                fontSize: '1.25rem',
                fontWeight: 900,
                color: '#fff',
                backgroundColor: '#1a73e8',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer'
              }}
            >
              {claimMutation.isPending ? 'CLAIMING MISSION...' : 'CLAIM NEXT ORDER MISSION'}
            </button>
          </div>

          {/* Urgent Floor Tasks */}
          {floorTasks && floorTasks.length > 0 && (
            <div>
              <h3 style={{ fontSize: '1.1rem', borderBottom: '1px solid #ddd', paddingBottom: '0.5rem' }}>Urgent Floor Tasks (Repick / Putback)</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {floorTasks.map((t) => (
                  <div key={t.taskRef} style={{ border: '1px solid #ccc', borderRadius: '6px', padding: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ background: '#f2994a', color: '#fff', padding: '0.2rem 0.4rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', marginRight: '0.5rem' }}>{t.type}</span>
                      <strong>{t.taskRef}</strong> ({t.sku} - Qty: {t.qty})
                      <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.25rem' }}>Bin: {t.binCode}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Case 2: Mission Active */}
      {mission && (
        <div>
          {/* Mission & Tote Info */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', background: '#f1f3f4', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem' }}>
            <div>
              <span style={{ fontSize: '0.75rem', color: '#666', display: 'block' }}>MISSION / ORDER</span>
              <strong>{mission.missionRef}</strong> ({mission.orderRef})
            </div>
            <div>
              <span style={{ fontSize: '0.75rem', color: '#666', display: 'block' }}>TOTE</span>
              <strong>{mission.toteCode || 'Scan any FREE tote at Step 3'}</strong>
            </div>
          </div>

          {/* Serpentine Progress */}
          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>
              <span>Progress: Stop {mission.doneStops + 1} of {mission.totalStops}</span>
              <span>{Math.round((mission.doneStops / mission.totalStops) * 100)}%</span>
            </div>
            <div style={{ width: '100%', height: '8px', background: '#e0e0e0', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: `${(mission.doneStops / mission.totalStops) * 100}%`, height: '100%', background: '#34a853' }} />
            </div>
          </div>

          {/* Active Stop Card */}
          {activeStop ? (
            <div style={{ border: '3px solid #1a73e8', borderRadius: '8px', padding: '1rem', background: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,0.1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span style={{ background: '#1a73e8', color: '#fff', padding: '0.2rem 0.6rem', borderRadius: '4px', fontWeight: 'bold', fontSize: '0.85rem' }}>
                  STOP #{activeStop.seq}
                </span>
                <span style={{ fontSize: '1.2rem', fontWeight: 900, color: '#137333' }}>
                  PICK QTY: {activeStop.qtyToPick}
                </span>
              </div>

              {/* Big Location Banner */}
              <div style={{ background: '#202124', color: '#fff', padding: '1rem', borderRadius: '6px', textAlign: 'center', marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.9rem', color: '#9aa0a6' }}>AISLE {activeStop.aisleLabel} - GO TO BIN</div>
                <div style={{ fontSize: '2.4rem', fontWeight: 900, letterSpacing: '2px', color: '#8ab4f8' }}>{activeStop.binCode}</div>
              </div>

              {/* Product Info */}
              <div style={{ marginBottom: '1rem', borderBottom: '1px solid #eee', paddingBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.85rem', color: '#666' }}>SKU: {activeStop.sku}</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{activeStop.productName}</div>
                <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.25rem' }}>Barcode: {activeStop.barcode}</div>
              </div>

              {/* 3-Step Visual Stepper */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '1.25rem' }}>
                <div style={{
                  padding: '0.5rem',
                  borderRadius: '4px',
                  textAlign: 'center',
                  background: activeStop.step === 'PENDING' ? '#1a73e8' : (activeStop.step === 'BIN_OK' || activeStop.step === 'ITEM_OK' ? '#e6f4ea' : '#f1f3f4'),
                  color: activeStop.step === 'PENDING' ? '#fff' : (activeStop.step === 'BIN_OK' || activeStop.step === 'ITEM_OK' ? '#137333' : '#666'),
                  fontWeight: 700,
                  fontSize: '0.85rem'
                }}>
                  1. SCAN BIN
                </div>
                <div style={{
                  padding: '0.5rem',
                  borderRadius: '4px',
                  textAlign: 'center',
                  background: activeStop.step === 'BIN_OK' ? '#1a73e8' : (activeStop.step === 'ITEM_OK' ? '#e6f4ea' : '#f1f3f4'),
                  color: activeStop.step === 'BIN_OK' ? '#fff' : (activeStop.step === 'ITEM_OK' ? '#137333' : '#666'),
                  fontWeight: 700,
                  fontSize: '0.85rem'
                }}>
                  2. SCAN ITEM
                </div>
                <div style={{
                  padding: '0.5rem',
                  borderRadius: '4px',
                  textAlign: 'center',
                  background: activeStop.step === 'ITEM_OK' ? '#1a73e8' : '#f1f3f4',
                  color: activeStop.step === 'ITEM_OK' ? '#fff' : '#666',
                  fontWeight: 700,
                  fontSize: '0.85rem'
                }}>
                  3. SCAN TOTE
                </div>
              </div>

              {/* Barcode Input Form */}
              <form onSubmit={handleScanSubmit}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                  {activeStop.step === 'PENDING' && `Scan Bin Barcode (${activeStop.binCode}):`}
                  {activeStop.step === 'BIN_OK' && `Scan Product Barcode (${activeStop.sku}):`}
                  {activeStop.step === 'ITEM_OK' && (mission.toteCode ? `Scan Tote Barcode (${mission.toteCode}):` : 'Scan Any Free Tote Barcode (e.g. TOTE-001):')}
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    ref={inputRef}
                    type="text"
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    placeholder="Scan barcode or type here..."
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      fontSize: '1.1rem',
                      borderRadius: '6px',
                      border: '2px solid #1a73e8'
                    }}
                    disabled={scanMutation.isPending}
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={scanMutation.isPending || !scanInput.trim()}
                    style={{
                      padding: '0.75rem 1.25rem',
                      fontSize: '1rem',
                      fontWeight: 700,
                      color: '#fff',
                      backgroundColor: '#1a73e8',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                  >
                    VERIFY
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', background: '#e6f4ea', borderRadius: '8px', color: '#137333' }}>
              <h2>All Stops Completed!</h2>
              <p>Tote is now awaiting pack bench. Mission marked COMPLETED.</p>
              <button
                onClick={() => refetchMission()}
                style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', fontWeight: 700, color: '#fff', backgroundColor: '#34a853', border: 'none', borderRadius: '6px' }}
              >
                RETURN TO QUEUE
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
