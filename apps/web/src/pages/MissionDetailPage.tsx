import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../api/client.js';
import { useAuthStore } from '../stores/authStore.js';
import { useCan } from '../hooks/useCan.js';
import { MissionDto, PickStopDto } from '@dark-storage/shared';
import { StatusBadge } from '../components/StatusBadge.js';
import { BarcodeSvg } from '../components/BarcodeSvg.js';

export const MissionDetailPage: React.FC = () => {
  const { ref } = useParams<{ ref: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const canPick = useCan('pick:execute');
  const canControl = useCan('control:view');

  const [startError, setStartError] = useState<string | null>(null);

  // Active pick execution states
  const [scannedBin, setScannedBin] = useState('');
  const [scannedSku, setScannedSku] = useState('');
  const [pickedQty, setPickedQty] = useState<string>('');
  const [exceptionType, setExceptionType] = useState<'SHORT_PICK' | 'DAMAGED' | 'OTHER'>('DAMAGED');
  const [exceptionNotes, setExceptionNotes] = useState('');
  const [pickError, setPickError] = useState<string | null>(null);
  const [pickKey, setPickKey] = useState<string>(() => crypto.randomUUID());

  // Problem modal state
  const [showProblemModal, setShowProblemModal] = useState(false);
  const [problemType, setProblemType] = useState<'BIN_EMPTY' | 'DAMAGED' | 'WRONG_PRODUCT' | 'OTHER'>('BIN_EMPTY');
  const [problemNotes, setProblemNotes] = useState('');
  const [problemError, setProblemError] = useState<string | null>(null);
  const [problemKey, setProblemKey] = useState<string>(() => crypto.randomUUID());

  const { data: mission, isLoading, error } = useQuery<MissionDto>({
    queryKey: ['mission', ref],
    queryFn: () => apiFetch(`/api/missions/${ref}`),
    refetchInterval: 5000,
    enabled: !!ref
  });

  // Start mission mutation
  const startMutation = useMutation({
    mutationFn: async () => {
      setStartError(null);
      return apiFetch(`/api/missions/${ref}/start`, { method: 'POST' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mission', ref] });
      queryClient.invalidateQueries({ queryKey: ['missions'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setStartError(err.message);
      } else {
        setStartError('Failed to start mission');
      }
    }
  });

  // Confirm pick stop mutation
  const confirmMutation = useMutation({
    mutationFn: async (payload: any) => {
      setPickError(null);
      const idemKey = `pick-${currentStop!.stop_ref}-${Date.now()}`;
      return apiFetch(`/api/pick-stops/${currentStop!.stop_ref}/confirm`, {
        method: 'POST',
        idempotencyKey: idemKey,
        body: JSON.stringify(payload)
      });
    },
    onSuccess: () => {
      setScannedBin('');
      setScannedSku('');
      setPickedQty('');
      setExceptionNotes('');
      setPickKey(crypto.randomUUID());
      queryClient.invalidateQueries({ queryKey: ['mission', ref] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
      queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setPickError(err.message);
      } else {
        setPickError('Failed to confirm pick stop');
      }
    }
  });

  // Report problem (zero pick exception) mutation
  const reportProblemMutation = useMutation({
    mutationFn: async (payload: any) => {
      setProblemError(null);
      return apiFetch(`/api/pick-stops/${currentStop!.stop_ref}/exception`, {
        method: 'POST',
        headers: { 'Idempotency-Key': problemKey },
        body: JSON.stringify(payload)
      });
    },
    onSuccess: () => {
      setShowProblemModal(false);
      setProblemNotes('');
      setProblemKey(crypto.randomUUID());
      queryClient.invalidateQueries({ queryKey: ['mission', ref] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
      queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setProblemError(err.message);
      } else {
        setProblemError('Failed to report exception');
      }
    }
  });

  // Find lowest seq PENDING stop
  const pendingStops = (mission?.stops || []).filter((s) => s.status === 'PENDING');
  pendingStops.sort((a, b) => a.seq - b.seq);
  const currentStop: PickStopDto | undefined = pendingStops[0];

  useEffect(() => {
    if (currentStop && pickedQty === '') {
      setPickedQty(String(currentStop.qty_required));
    }
  }, [currentStop?.id, currentStop?.qty_required]);

  if (isLoading) {
    return <div className="card" style={{ padding: '3rem', textAlign: 'center', margin: '2rem auto', maxWidth: '600px' }}>Loading mission {ref}...</div>;
  }

  if (error || !mission) {
    return (
      <div className="card" style={{ padding: '3rem', textAlign: 'center', margin: '2rem auto', maxWidth: '600px' }}>
        <h2 style={{ color: 'var(--accent-danger)', marginBottom: '1rem' }}>Mission Not Found</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          {error instanceof ApiError ? error.message : `Mission ${ref} does not exist.`}
        </p>
        <button className="btn btn-primary" onClick={() => navigate('/picking')}>
          Back to Missions
        </button>
      </div>
    );
  }

  const isAssignedToMe = canPick && user && mission?.picker.id === user.id;
  const canStart = mission?.status === 'ASSIGNED' && Boolean(isAssignedToMe);
  const isPickingActive = false;

  // Progress metrics
  const totalStops = mission.progress.total_stops;
  const stopsFinished = mission.progress.finished_stops;
  const stopsPct = totalStops > 0 ? Math.round((stopsFinished / totalStops) * 100) : 0;

  const unitsRequired = mission.progress.units_required;
  const unitsPicked = mission.progress.units_picked;
  const unitsPct = unitsRequired > 0 ? Math.round((unitsPicked / unitsRequired) * 100) : 0;

  const numericPickedQty = pickedQty === '' ? 0 : parseInt(pickedQty, 10);
  const isShortPick = currentStop ? numericPickedQty > 0 && numericPickedQty < currentStop.qty_required : false;

  const isConfirmDisabled =
    !currentStop ||
    !scannedBin.trim() ||
    !scannedSku.trim() ||
    numericPickedQty <= 0 ||
    numericPickedQty > currentStop.qty_required ||
    (isShortPick && !exceptionNotes.trim()) ||
    confirmMutation.isPending;

  const handleConfirmPick = () => {
    if (!currentStop) return;
    confirmMutation.mutate({
      scanned_bin: scannedBin.trim(),
      scanned_sku: scannedSku.trim(),
      picked_qty: numericPickedQty,
      exception: isShortPick
        ? {
            type: exceptionType,
            notes: exceptionNotes.trim()
          }
        : undefined
    });
  };

  const handleReportProblem = () => {
    if (!currentStop || problemNotes.trim().length < 3) return;
    reportProblemMutation.mutate({
      exception_type: problemType,
      notes: problemNotes.trim()
    });
  };

  return (
    <div className="m3-page" style={{ maxWidth: '1100px' }}>
      {/* Navigation & Header */}
      <div>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/picking')} style={{ marginBottom: '12px' }}>
          ← Back to Missions
        </button>
        <div className="m3-page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>{mission.ref}</h1>
            <StatusBadge status={mission.status} />
            <span className="badge badge-info">{mission.route.algorithm}</span>
            <Link
              to={`/warehouse?view=map&mission=${mission.ref}`}
              className="btn btn-secondary btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              View route on map ↗
            </Link>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {canStart && (
              <button
                className="btn btn-primary"
                data-testid="mission-start-btn"
                onClick={() => startMutation.mutate()}
                disabled={startMutation.isPending}
              >
                {startMutation.isPending ? 'Starting...' : 'Start Mission'}
              </button>
            )}
          </div>
        </div>
      </div>

      {startError && (
        <div className="banner banner-error">
          {startError}
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
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Associated Order</span>
          <p style={{ margin: '6px 0 0', fontWeight: 600 }}>
            <Link to={`/orders/${mission.order_ref}`} style={{ color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>
              {mission.order_ref}
            </Link>
          </p>
        </div>
        <div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Assigned Picker</span>
          <p style={{ margin: '6px 0 0', fontWeight: 600 }}>{mission.picker.name}</p>
        </div>
        <div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Assigned By</span>
          <p style={{ margin: '6px 0 0', fontWeight: 600 }}>{mission.assigned_by.name}</p>
        </div>
        <div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Assigned At</span>
          <p style={{ margin: '6px 0 0', fontWeight: 600, fontSize: '13px' }}>{new Date(mission.assigned_at).toLocaleString()}</p>
        </div>
        {mission.started_at && (
          <div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Started At</span>
            <p style={{ margin: '6px 0 0', fontWeight: 600, fontSize: '13px' }}>{new Date(mission.started_at).toLocaleString()}</p>
          </div>
        )}
      </div>

      {/* Progress Strip with visual progress bars */}
      <div
        className="card"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '20px'
        }}
      >
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Stops Completed</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-primary)' }}>{stopsPct}%</span>
          </div>
          <p style={{ margin: '0 0 8px', fontSize: '1.35rem', fontWeight: 800 }}>
            {stopsFinished} / {totalStops}
          </p>
          <div className="fill-bar" style={{ height: '8px' }}>
            <div
              data-testid="progress-stops"
              className="fill-bar-inner med"
              style={{ width: `${stopsPct}%` }}
            />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Units Picked</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-success)' }}>{unitsPct}%</span>
          </div>
          <p style={{ margin: '0 0 8px', fontSize: '1.35rem', fontWeight: 800 }}>
            {unitsPicked} / {unitsRequired}
          </p>
          <div className="fill-bar" style={{ height: '8px' }}>
            <div
              data-testid="progress-units"
              className="fill-bar-inner full"
              style={{ width: `${unitsPct}%` }}
            />
          </div>
        </div>

        <div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Open Exceptions</span>
          <p
            style={{
              margin: '4px 0 0',
              fontSize: '1.35rem',
              fontWeight: 800,
              color: mission.progress.open_exceptions > 0 ? 'var(--accent-danger)' : 'var(--text-primary)'
            }}
          >
            {mission.progress.open_exceptions}
          </p>
          {mission.progress.open_exceptions > 0 && (
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
              Awaiting manager resolution
            </p>
          )}
        </div>
      </div>

      {/* ACTIVE STOP CARD (When IN_PROGRESS) */}
      {isPickingActive && currentStop && (
        <div
          data-testid="current-stop-card"
          className="card"
          style={{
            border: '2px solid var(--accent-primary)',
            borderRadius: '24px',
            boxShadow: '0 8px 30px rgba(99, 102, 241, 0.18)',
            padding: '28px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
            <div>
              <span className="badge badge-primary" style={{ marginBottom: '8px', display: 'inline-block' }}>
                CURRENT STOP #{currentStop.seq} ({currentStop.stop_ref})
              </span>
              <div style={{ fontSize: '2.2rem', fontWeight: 800, letterSpacing: '0.04em', fontFamily: 'var(--font-mono)' }}>
                {currentStop.bin_code}
              </div>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                Shelf: <strong style={{ color: 'var(--text-primary)' }}>{currentStop.shelf_code}</strong>
              </div>
              {/* Visual Bin Location Barcode */}
              <BarcodeSvg value={currentStop.bin_code} label="Shelf Rack Barcode" />
            </div>

            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{currentStop.product_name}</div>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '2px', marginBottom: '8px' }}>
                SKU: {currentStop.sku}
              </div>
              {/* Visual Product SKU Barcode */}
              <BarcodeSvg value={currentStop.sku} label="Item Box SKU Barcode" />
              <div style={{ marginTop: '12px', fontSize: '1.35rem', fontWeight: 800, color: 'var(--accent-primary)' }}>
                Required: {currentStop.qty_required} unit{currentStop.qty_required === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          {pickError && (
            <div className="banner banner-error" data-testid="pick-error-banner">
              {pickError}
            </div>
          )}

          {/* Quick Simulation Barcode Scanner Action */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(99, 102, 241, 0.08)', padding: '10px 16px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(99, 102, 241, 0.2)', flexWrap: 'wrap', gap: '10px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Scan the printed barcodes or simulate scan:
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setScannedBin(currentStop.bin_code);
                setScannedSku(currentStop.sku);
                setPickedQty(String(currentStop.qty_required));
              }}
              style={{ fontSize: '12px', padding: '6px 14px', fontWeight: 700 }}
              title="Auto-fill barcodes as if scanned by a barcode laser gun"
            >
              ⚡ Auto-Fill Barcodes (Simulate Scan)
            </button>
          </div>

          {/* Scans & Inputs */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '16px',
              backgroundColor: 'var(--bg-surface)',
              padding: '18px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)'
            }}
          >
            <div>
              <label className="form-label">
                Scan Bin Barcode *
              </label>
              <input
                type="text"
                className="input-field"
                data-testid="pick-scan-bin"
                value={scannedBin}
                onChange={(e) => setScannedBin(e.target.value)}
                placeholder={`e.g. ${currentStop.bin_code}`}
                autoComplete="off"
              />
            </div>

            <div>
              <label className="form-label">
                Scan Product SKU Barcode *
              </label>
              <input
                type="text"
                className="input-field"
                data-testid="pick-scan-sku"
                value={scannedSku}
                onChange={(e) => setScannedSku(e.target.value)}
                placeholder={`e.g. ${currentStop.sku}`}
                autoComplete="off"
              />
            </div>

            <div>
              <label className="form-label">
                Picked Quantity * (Max: {currentStop.qty_required})
              </label>
              <input
                type="number"
                className="input-field"
                data-testid="pick-qty"
                value={pickedQty}
                onChange={(e) => setPickedQty(e.target.value)}
                min={1}
                max={currentStop.qty_required}
              />
              {numericPickedQty > currentStop.qty_required && (
                <span style={{ color: 'var(--accent-danger)', fontSize: '12px', marginTop: '6px', display: 'block', fontWeight: 700 }}>
                  ⚠ Cannot pick {numericPickedQty}. Required is {currentStop.qty_required} unit{currentStop.qty_required === 1 ? '' : 's'}.
                </span>
              )}
            </div>
          </div>

          {/* Short pick exception fields */}
          {isShortPick && (
            <div
              data-testid="short-pick-fields"
              className="banner banner-error"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}
            >
              <div style={{ fontWeight: 700, color: '#fca5a5', fontSize: '14px' }}>
                Short Pick Detected ({numericPickedQty} of {currentStop.qty_required} picked). Exception reporting required:
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
                <div>
                  <label className="form-label" style={{ color: '#fca5a5' }}>Reason Type *</label>
                  <select
                    className="select"
                    data-testid="pick-exc-type"
                    value={exceptionType}
                    onChange={(e: any) => setExceptionType(e.target.value)}
                  >
                    <option value="SHORT_PICK">Short Pick</option>
                    <option value="DAMAGED">Damaged Goods</option>
                    <option value="OTHER">Other Reason</option>
                  </select>
                </div>

                <div>
                  <label className="form-label" style={{ color: '#fca5a5' }}>Notes *</label>
                  <input
                    type="text"
                    className="input-field"
                    data-testid="pick-exc-notes"
                    value={exceptionNotes}
                    onChange={(e) => setExceptionNotes(e.target.value)}
                    placeholder="Provide details for manager..."
                  />
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="pick-report-btn"
              onClick={() => setShowProblemModal(true)}
            >
              Report Problem (Zero Pick)
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              {isConfirmDisabled && numericPickedQty > currentStop.qty_required && (
                <span style={{ color: 'var(--accent-danger)', fontSize: '13px', fontWeight: 700 }}>
                  Set Picked Quantity to {currentStop.qty_required}
                </span>
              )}
              {isConfirmDisabled && (!scannedBin.trim() || !scannedSku.trim()) && (
                <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                  Scan both barcodes above
                </span>
              )}
              <button
                type="button"
                className="btn btn-primary"
                data-testid="pick-confirm-btn"
                onClick={handleConfirmPick}
                disabled={isConfirmDisabled}
              >
                {confirmMutation.isPending ? 'Confirming Pick...' : 'Confirm Pick'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mission completed banner */}
      {mission.status === 'COMPLETED' && (
        <div className="banner banner-success">
          <h3 style={{ margin: '0 0 6px', fontWeight: 700 }}>Mission Completed</h3>
          <p style={{ margin: 0, fontSize: '14px' }}>
            All pick stops have been finished. The order is now ready for packing.
          </p>
        </div>
      )}

      {/* Route Panel */}
      <div className="card">
        <h3 style={{ margin: '0 0 10px', fontSize: '1.1rem', fontWeight: 700 }}>
          Optimized Picking Route ({mission.route.algorithm} · {mission.route.total_distance.toFixed(1)} units)
        </h3>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px' }}>
          Start at <strong>{mission.route.start}</strong> → visit {mission.stops.length} pick stop{mission.stops.length === 1 ? '' : 's'} in order → finish at <strong>{mission.route.end}</strong>.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto' }}>
          {mission.route.legs.map((leg, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-surface)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '13px',
                fontFamily: 'var(--font-mono)'
              }}
            >
              <span>
                Leg {idx + 1}: {leg.path.join(' → ')}
              </span>
              <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>
                {leg.distance.toFixed(1)} u
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Stops Table */}
      <div className="table-container">
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface)' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Pick Stops (Visiting Order)</h3>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Seq</th>
              <th>Stop Ref</th>
              <th>Location</th>
              <th>Product</th>
              <th>Required</th>
              <th>Picked</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {mission.stops.map((stop) => (
              <tr key={stop.id} style={currentStop?.id === stop.id ? { backgroundColor: 'var(--accent-primary-container)' } : undefined}>
                <td style={{ fontWeight: 700 }}>
                  {currentStop?.id === stop.id ? `▶ ${stop.seq}` : stop.seq}
                </td>
                <td>
                  <span style={{ fontWeight: 700, color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>{stop.stop_ref}</span>
                </td>
                <td>
                  <div>
                    <strong style={{ fontFamily: 'var(--font-mono)' }}>{stop.bin_code}</strong>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Shelf {stop.shelf_code}</div>
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{stop.product_name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{stop.sku}</div>
                </td>
                <td style={{ fontWeight: 600 }}>{stop.qty_required}</td>
                <td style={{ fontWeight: 600 }}>{stop.qty_picked}</td>
                <td>
                  <StatusBadge status={stop.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Report Problem Modal */}
      {showProblemModal && currentStop && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <h3 style={{ margin: '0 0 12px', fontSize: '1.25rem', fontWeight: 700 }}>Report Problem for Stop {currentStop.stop_ref}</h3>
            <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginBottom: '18px' }}>
              Reporting a problem halts this stop and opens an exception for a warehouse manager. No inventory will be deducted.
            </p>

            {problemError && (
              <div className="banner banner-error" style={{ marginBottom: '16px' }}>
                {problemError}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">
                Problem Type *
              </label>
              <select
                className="select"
                data-testid="problem-type-select"
                value={problemType}
                onChange={(e: any) => setProblemType(e.target.value)}
              >
                <option value="BIN_EMPTY">Bin Empty (No stock found)</option>
                <option value="DAMAGED">Damaged Goods</option>
                <option value="WRONG_PRODUCT">Wrong Product in Bin</option>
                <option value="OTHER">Other Issue</option>
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label className="form-label">
                Notes (Min 3 characters) *
              </label>
              <textarea
                className="input-field"
                rows={3}
                data-testid="problem-notes-input"
                placeholder="Explain the problem clearly for the manager..."
                value={problemNotes}
                onChange={(e) => setProblemNotes(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowProblemModal(false)}
                disabled={reportProblemMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                data-testid="pick-report-submit"
                onClick={handleReportProblem}
                disabled={problemNotes.trim().length < 3 || reportProblemMutation.isPending}
              >
                {reportProblemMutation.isPending ? 'Reporting...' : 'Submit Problem'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
