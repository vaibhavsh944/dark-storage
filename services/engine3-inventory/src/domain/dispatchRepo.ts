import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import {
  AppError,
  matchesSlot,
  normalizeScan,
  transition
} from '@dark-storage/shared';
import { runInTx } from '../db/tx.js';
import { appendAudit, appendOrderEvent } from '../audit/appendAudit.js';
import { postLedger } from '../ledger/postLedger.js';
import { getConfig } from './config.js';

export interface ActorInfo {
  id: number | string;
  username: string;
  role: string;
}

// In-memory demo OTP cache for presentation simulation
const demoOtpStore = new Map<string, string>();

export function recordDemoOtp(orderRef: string, otp: string): void {
  demoOtpStore.set(orderRef, otp);
}

export function getDemoOtp(orderRef: string): { orderRef: string; otp: string } {
  const otp = demoOtpStore.get(orderRef);
  if (!otp) {
    throw new AppError('NOT_FOUND', 404, `Demo OTP not found for order ${orderRef}`);
  }
  return { orderRef, otp };
}

export interface DispatchQueueItem {
  slotCode: string;
  orderRef: string;
  customerRef: string | null;
  priority: string;
  packedAt: string | null;
  locked: boolean;
  attempts: number;
  otpExpiresAt: string | null;
}

export function getDispatchQueue(db: Database.Database): DispatchQueueItem[] {
  const rows = db.prepare(`
    SELECT
      s.slot_code,
      s.order_ref,
      o.customer_ref,
      o.priority,
      o.packed_at,
      COALESCE(h.locked, 0) AS locked,
      COALESCE(h.attempts, 0) AS attempts,
      h.otp_expires_at
    FROM dispatch_slots s
    JOIN orders o ON o.ref = s.order_ref
    LEFT JOIN dispatch_handovers h ON h.order_ref = s.order_ref
    WHERE s.status = 'OCCUPIED' AND o.status = 'PACKED'
    ORDER BY s.slot_code ASC
  `).all() as Array<{
    slot_code: string;
    order_ref: string;
    customer_ref: string | null;
    priority: string;
    packed_at: string | null;
    locked: number;
    attempts: number;
    otp_expires_at: string | null;
  }>;

  return rows.map(r => ({
    slotCode: r.slot_code,
    orderRef: r.order_ref,
    customerRef: r.customer_ref,
    priority: r.priority,
    packedAt: r.packed_at,
    locked: Boolean(r.locked),
    attempts: r.attempts,
    otpExpiresAt: r.otp_expires_at
  }));
}

export function handoverDispatchOrder(
  db: Database.Database,
  orderRef: string,
  params: {
    slotScan: string;
    otp: string;
    riderName?: string;
    actor: ActorInfo;
  }
): { ok: boolean; orderRef: string; slotCode: string; dispatchedAt: string } {
  const order = db.prepare('SELECT id, ref, status, version FROM orders WHERE ref = ?').get(orderRef) as any;
  if (!order) {
    throw new AppError('ORDER_NOT_FOUND', 404, `Order ${orderRef} not found`);
  }
  if (order.status !== 'PACKED') {
    throw new AppError('ORDER_NOT_PACKED', 409, `Order ${orderRef} is in status ${order.status}, must be PACKED for handover`);
  }

  const handover = db.prepare('SELECT * FROM dispatch_handovers WHERE order_ref = ?').get(orderRef) as any;
  if (!handover) {
    throw new AppError('HANDOVER_NOT_FOUND', 404, `No dispatch handover found for order ${orderRef}`);
  }

  // Verify slot scan matches slotCode
  const normSlot = normalizeScan(params.slotScan);
  if (!matchesSlot(normSlot, handover.slot_code)) {
    throw new AppError('SLOT_MISMATCH', 422, `Scanned slot ${normSlot} does not match order slot ${handover.slot_code}`);
  }

  if (handover.locked === 1) {
    throw new AppError('OTP_LOCKED', 409, `Handover for order ${orderRef} is locked due to too many failed OTP attempts`);
  }

  // Compare sha256(otp.trim() + ':' + orderRef)
  const suppliedOtp = (params.otp || '').trim();
  const suppliedHash = crypto.createHash('sha256').update(suppliedOtp + ':' + orderRef).digest('hex');

  if (suppliedHash !== handover.otp_hash) {
    // Mismatch: increment attempts in committed transaction
    const maxAttempts = getConfig<number>(db, 'dispatch.otp_max_attempts') ?? 3;
    const newAttempts = handover.attempts + 1;
    const locked = newAttempts >= maxAttempts ? 1 : 0;

    db.prepare(`
      UPDATE dispatch_handovers
      SET attempts = ?, locked = ?
      WHERE id = ?
    `).run(newAttempts, locked, handover.id);

    appendOrderEvent(db, {
      orderRef,
      event: 'dispatch.otp_failed',
      actor: params.actor,
      payload: {
        attempts: newAttempts,
        locked: Boolean(locked),
        slotCode: handover.slot_code
      }
    });

    appendAudit(db, {
      actor: params.actor,
      action: 'dispatch.otp_failed',
      entityType: 'dispatch_handover',
      entityId: String(handover.id),
      details: {
        order_ref: orderRef,
        attempts: newAttempts,
        locked: Boolean(locked)
      }
    });

    if (locked) {
      throw new AppError('OTP_LOCKED', 409, `Max failed OTP attempts reached. Handover locked for order ${orderRef}`);
    } else {
      throw new AppError('OTP_INVALID', 422, `Invalid Rider OTP. ${maxAttempts - newAttempts} attempt(s) remaining`);
    }
  }

  // OTP is valid!
  return runInTx(db, () => {
    const slotLocation = `DISP:${handover.slot_code}`;

    // Post ledger movement DISP -> SHIPPED for all items at this location
    const slotBalances = db.prepare(`
      SELECT sku, lot_id, qty
      FROM location_balances
      WHERE location_key = ? AND qty > 0
    `).all(slotLocation) as Array<{ sku: string; lot_id: string | null; qty: number }>;

    if (slotBalances.length > 0) {
      postLedger(
        db,
        slotBalances.map(bal => ({
          sku: bal.sku,
          lotId: bal.lot_id || 'LOT-DEFAULT',
          qty: bal.qty,
          from: slotLocation,
          to: 'SHIPPED',
          type: 'HANDOVER',
          orderRef
        })),
        params.actor
      );
    }

    // Free the dispatch slot
    db.prepare(`
      UPDATE dispatch_slots
      SET status = 'FREE', order_ref = NULL
      WHERE slot_code = ?
    `).run(handover.slot_code);

    // Transition order PACKED -> DISPATCHED
    transition('ORDER', order.status, 'handover');
    const dispatchedAt = new Date().toISOString();
    db.prepare(`
      UPDATE orders
      SET status = 'DISPATCHED', dispatched_at = ?, updated_at = datetime('now'), version = version + 1
      WHERE id = ?
    `).run(dispatchedAt, order.id);

    // Update dispatch_handovers
    db.prepare(`
      UPDATE dispatch_handovers
      SET rider_name = ?, handed_by = ?, handed_at = ?
      WHERE id = ?
    `).run(params.riderName || 'Rider', String(params.actor.id), dispatchedAt, handover.id);

    // Remove from demo OTP store
    demoOtpStore.delete(orderRef);

    // Events & audit
    appendOrderEvent(db, {
      orderRef,
      event: 'order.dispatched',
      actor: params.actor,
      payload: {
        slotCode: handover.slot_code,
        riderName: params.riderName || 'Rider',
        dispatchedAt
      }
    });

    appendAudit(db, {
      actor: params.actor,
      action: 'dispatch.handover',
      entityType: 'order',
      entityId: orderRef,
      details: {
        slot_code: handover.slot_code,
        rider_name: params.riderName || 'Rider',
        dispatched_at: dispatchedAt
      }
    });

    return {
      ok: true,
      orderRef,
      slotCode: handover.slot_code,
      dispatchedAt
    };
  });
}

export function regenDispatchOtp(
  db: Database.Database,
  orderRef: string,
  params: {
    reasonCode: string;
    note?: string;
    actor: ActorInfo;
  }
): { ok: boolean; orderRef: string; otp?: string } {
  if (!params.reasonCode) {
    throw new AppError('REASON_REQUIRED', 422, 'Reason code is required to regenerate OTP');
  }

  const handover = db.prepare('SELECT id, order_ref, slot_code FROM dispatch_handovers WHERE order_ref = ?').get(orderRef) as any;
  if (!handover) {
    throw new AppError('HANDOVER_NOT_FOUND', 404, `No handover record for order ${orderRef}`);
  }

  const newOtp = String(crypto.randomInt(1000, 10000));
  const newHash = crypto.createHash('sha256').update(newOtp + ':' + orderRef).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  db.prepare(`
    UPDATE dispatch_handovers
    SET otp_hash = ?, otp_expires_at = ?, attempts = 0, locked = 0
    WHERE id = ?
  `).run(newHash, expiresAt, handover.id);

  recordDemoOtp(orderRef, newOtp);

  appendOrderEvent(db, {
    orderRef,
    event: 'dispatch.otp_regenerated',
    actor: params.actor,
    payload: {
      reasonCode: params.reasonCode,
      note: params.note || '',
      slotCode: handover.slot_code
    }
  });

  appendAudit(db, {
    actor: params.actor,
    action: 'dispatch.otp_regenerated',
    entityType: 'dispatch_handover',
    entityId: String(handover.id),
    details: {
      order_ref: orderRef,
      reason_code: params.reasonCode,
      note: params.note || ''
    }
  });

  const isDemo = process.env.DEMO_MODE === 'true';
  return {
    ok: true,
    orderRef,
    otp: isDemo ? newOtp : undefined
  };
}
