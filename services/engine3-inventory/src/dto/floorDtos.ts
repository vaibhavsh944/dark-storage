import Database from 'better-sqlite3';
import {
  PickerMissionDTO,
  PickerStopDTO,
  PackSessionDTO,
  CountTaskDTO
} from '@dark-storage/shared';

export const FORBIDDEN_FLOOR_KEYS = [
  'currentQty',
  'current_qty',
  'reservedQty',
  'reserved_qty',
  'availableQty',
  'available_to_promise',
  'atp_pickable',
  'systemQty',
  'system_qty',
  'variance',
  'customer',
  'shipping_address',
  'price_paise'
] as const;

export function toPickerMissionDTO(db: Database.Database, missionRow: any): PickerMissionDTO {
  let orderRef = missionRow.order_ref;
  if (!orderRef && missionRow.order_id) {
    const ord = db.prepare('SELECT ref FROM orders WHERE id = ?').get(missionRow.order_id) as { ref: string } | undefined;
    if (ord) orderRef = ord.ref;
  }
  const missionRef = missionRow.ref;

  const rawStops = db.prepare(`
    SELECT
      s.id AS stop_id,
      s.stop_ref,
      s.seq,
      s.bin_code,
      s.sku,
      s.qty_required,
      s.qty_picked,
      s.step,
      p.name AS product_name,
      p.barcode,
      sh.aisle AS aisle_name
    FROM pick_stops s
    LEFT JOIN products p ON p.sku = s.sku
    LEFT JOIN bins b ON b.code = s.bin_code
    LEFT JOIN shelves sh ON sh.code = b.shelf_code
    WHERE s.mission_id = ?
    ORDER BY s.seq ASC
  `).all(missionRow.id) as Array<{
    stop_id: number;
    stop_ref: string;
    seq: number;
    bin_code: string;
    sku: string;
    qty_required: number;
    qty_picked: number;
    step: string;
    product_name: string | null;
    barcode: string | null;
    aisle_name: string | null;
  }>;

  const stops: PickerStopDTO[] = rawStops.map((s) => {
    const aisleLabel = s.aisle_name || s.bin_code.split('-')[0] || 'A';
    return {
      stopId: s.stop_id,
      stopRef: s.stop_ref || `${missionRef}-S${s.seq}`,
      seq: s.seq,
      binCode: s.bin_code,
      aisleLabel,
      sku: s.sku,
      barcode: s.barcode || s.sku,
      productName: s.product_name || s.sku,
      qtyToPick: s.qty_required,
      qtyPicked: s.qty_picked,
      step: (s.step as PickerStopDTO['step']) || 'PENDING',
      toteCode: missionRow.tote_code || null,
      orderRef: orderRef || ''
    };
  });

  const doneStops = stops.filter(s => s.step === 'DONE').length;

  return {
    missionRef,
    orderRef: orderRef || '',
    status: missionRow.status,
    leaseExpiresAt: missionRow.lease_expires_at || null,
    toteCode: missionRow.tote_code || null,
    totalStops: stops.length,
    doneStops,
    stops
  };
}

export function toPackSessionDTO(db: Database.Database | null, sessionRow: any): PackSessionDTO {
  let lines: PackSessionDTO['lines'] = [];

  if (Array.isArray(sessionRow.lines)) {
    lines = sessionRow.lines.map((l: any) => ({
      sku: l.sku,
      barcode: l.barcode || l.sku,
      productName: l.productName || l.product_name || l.sku,
      expectedQty: Number(l.expectedQty ?? l.expected_qty ?? 0),
      scannedQty: Number(l.scannedQty ?? l.scanned_qty ?? 0),
      flaggedQty: Number(l.flaggedQty ?? l.flagged_qty ?? 0)
    }));
  } else if (db && sessionRow.id) {
    const dbLines = db.prepare(`
      SELECT
        l.sku,
        p.barcode,
        p.name AS product_name,
        l.expected_qty,
        l.scanned_qty,
        l.flagged_qty
      FROM pack_session_lines l
      LEFT JOIN products p ON p.sku = l.sku
      WHERE l.session_id = ?
    `).all(sessionRow.id) as any[];

    lines = dbLines.map(l => ({
      sku: l.sku,
      barcode: l.barcode || l.sku,
      productName: l.product_name || l.sku,
      expectedQty: Number(l.expected_qty),
      scannedQty: Number(l.scanned_qty),
      flaggedQty: Number(l.flagged_qty)
    }));
  }

  return {
    sessionId: sessionRow.id,
    orderRef: sessionRow.order_ref,
    toteCode: sessionRow.tote_code,
    benchCode: sessionRow.bench_code,
    status: sessionRow.status,
    lines,
    expectedWeightG: Number(sessionRow.expected_weight_g ?? sessionRow.expectedWeightG ?? 0),
    actualWeightG: sessionRow.actual_weight_g !== null && sessionRow.actual_weight_g !== undefined
      ? Number(sessionRow.actual_weight_g)
      : (sessionRow.actualWeightG !== null && sessionRow.actualWeightG !== undefined ? Number(sessionRow.actualWeightG) : null),
    weightOk: Boolean(sessionRow.weight_ok ?? sessionRow.weightOk ?? false),
    canComplete: Boolean(sessionRow.can_complete ?? sessionRow.canComplete ?? false)
  };
}

export function toCountTaskDTO(taskRow: any): CountTaskDTO {
  let round = 1;
  if (taskRow.round !== undefined) {
    round = Number(taskRow.round);
  } else if (taskRow.payload) {
    try {
      const parsed = typeof taskRow.payload === 'string' ? JSON.parse(taskRow.payload) : taskRow.payload;
      if (parsed.round !== undefined) {
        round = Number(parsed.round);
      }
    } catch {
      round = 1;
    }
  }

  return {
    taskRef: taskRow.task_ref,
    type: 'COUNT',
    binCode: taskRow.bin_code,
    sku: taskRow.sku,
    round,
    dueAt: taskRow.due_at || null
  };
}
