import { REASON_CODES, ReasonCode } from './enums.js';

export const ERROR_STATUS_MAP: Record<string, number> = {
  AUTH_REQUIRED: 401,
  TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  SOD_VIOLATION: 403,
  ENDPOINT_REMOVED: 410,
  VALIDATION_FAILED: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  REASON_REQUIRED: 400,
  NOT_FOUND: 404,
  NO_MISSION_AVAILABLE: 404,
  STATE_CONFLICT: 409,
  VERSION_CONFLICT: 409,
  DUPLICATE: 409,
  MISSION_NOT_OWNED: 403,
  MISSION_LEASE_EXPIRED: 409,
  ACTIVE_MISSION_EXISTS: 409,
  TOTE_IN_USE: 409,
  SCAN_OUT_OF_SEQUENCE: 422,
  SCAN_WRONG_BIN: 422,
  SCAN_WRONG_ITEM: 422,
  SCAN_WRONG_TOTE: 422,
  SCAN_QTY_EXCEEDS: 422,
  ORDER_NOT_PICKED: 409,
  PACK_ITEM_NOT_IN_ORDER: 422,
  PACK_ITEM_OVERSCAN: 422,
  PACK_INCOMPLETE: 422,
  WEIGHT_MISMATCH: 422,
  SLOT_MISMATCH: 422,
  OTP_INVALID: 422,
  OTP_LOCKED: 409,
  SELF_APPROVAL_FORBIDDEN: 403,
  ADJ_NEEDS_SECOND_MANAGER: 403,
  NEGATIVE_BALANCE: 422,
  LOT_MIX: 422,
  BIN_LOCKED: 409,
  BIN_FROZEN: 409,
  COUNTER_MUST_DIFFER: 409,
  SHELF_LIFE_TOO_SHORT: 422,
  PO_MISMATCH: 422,
  ORDER_CANCEL_NEEDS_PUTBACK: 409,
  DEVICE_NOT_ALLOWED: 403,
  RATE_LIMITED: 429,
  LEDGER_IMMUTABLE: 500,
  AUDIT_IMMUTABLE: 500,
  INTERNAL_ERROR: 500
};

export class AppError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;
  public readonly details?: unknown;

  constructor(code: string, httpStatusOrMessage?: number | string, messageOrDetails?: string | unknown, details?: unknown) {
    let httpStatus: number;
    let message: string;
    let extraDetails: unknown;

    if (typeof httpStatusOrMessage === 'number') {
      httpStatus = httpStatusOrMessage;
      message = typeof messageOrDetails === 'string' ? messageOrDetails : code;
      extraDetails = details ?? (typeof messageOrDetails === 'object' ? messageOrDetails : undefined);
    } else {
      httpStatus = ERROR_STATUS_MAP[code] || 500;
      message = typeof httpStatusOrMessage === 'string' ? httpStatusOrMessage : code;
      extraDetails = messageOrDetails;
    }

    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = extraDetails;
  }
}

export function requireReason(code?: string, note?: string): void {
  if (!code || !REASON_CODES.includes(code as ReasonCode)) {
    throw new AppError(
      'REASON_REQUIRED',
      400,
      `A valid reason code is required. Allowed: [${REASON_CODES.join(', ')}]`
    );
  }

  if (code === 'OTHER') {
    if (!note || note.trim().length < 10) {
      throw new AppError(
        'REASON_REQUIRED',
        400,
        'When reason code is OTHER, a note of at least 10 characters is required'
      );
    }
  }
}

// Backward compatibility with legacy DomainError
export const ERROR_CODES = {
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', http: 400, message: 'Validation failed' },
  UNAUTHENTICATED: { code: 'UNAUTHENTICATED', http: 401, message: 'Authentication required' },
  FORBIDDEN: { code: 'FORBIDDEN', http: 403, message: 'Forbidden' },
  NOT_FOUND: { code: 'NOT_FOUND', http: 404, message: 'Entity not found' },
  IDEMPOTENCY_KEY_REQUIRED: { code: 'IDEMPOTENCY_KEY_REQUIRED', http: 400, message: 'Idempotency-Key header is required' },
  IDEMPOTENCY_KEY_REUSED: { code: 'IDEMPOTENCY_KEY_REUSED', http: 422, message: 'Idempotency key reused with different request payload' },
  UNKNOWN_SKU: { code: 'UNKNOWN_SKU', http: 422, message: 'SKU not found or inactive' },
  UNKNOWN_BIN: { code: 'UNKNOWN_BIN', http: 422, message: 'Bin code not found' },
  QUANTITY_INVALID: { code: 'QUANTITY_INVALID', http: 422, message: 'Quantity is invalid or exceeds limits' },
  DUPLICATE_LINE_SKU: { code: 'DUPLICATE_LINE_SKU', http: 422, message: 'Duplicate SKU found in lines' },
  SKU_CONFLICT: { code: 'SKU_CONFLICT', http: 409, message: 'Bin already holds a different SKU' },
  CAPACITY_EXCEEDED: { code: 'CAPACITY_EXCEEDED', http: 409, message: 'Bin capacity exceeded' },
  BIN_NOT_RECEIVABLE: { code: 'BIN_NOT_RECEIVABLE', http: 409, message: 'Bin or shelf is not receivable' },
  STORAGE_CLASS_MISMATCH: { code: 'STORAGE_CLASS_MISMATCH', http: 409, message: 'Storage class mismatch' },
  INSUFFICIENT_STAGED_STOCK: { code: 'INSUFFICIENT_STAGED_STOCK', http: 409, message: 'Quantity exceeds staged stock' },
  INSUFFICIENT_STOCK: { code: 'INSUFFICIENT_STOCK', http: 409, message: 'Not enough available stock' },
  ORDER_STATE_INVALID: { code: 'ORDER_STATE_INVALID', http: 409, message: 'Action not allowed in current order status' },
  ORDER_NOT_CANCELLABLE: { code: 'ORDER_NOT_CANCELLABLE', http: 409, message: 'Order cannot be cancelled in current status' },
  PICKER_INVALID: { code: 'PICKER_INVALID', http: 422, message: 'User is not an active picker' },
  MISSION_STATE_INVALID: { code: 'MISSION_STATE_INVALID', http: 409, message: 'Action not allowed in current mission status' },
  NOT_YOUR_MISSION: { code: 'NOT_YOUR_MISSION', http: 403, message: 'Picker not assigned to this mission' },
  STOP_STATE_INVALID: { code: 'STOP_STATE_INVALID', http: 409, message: 'Stop not in a state that allows this action' },
  PRODUCT_MISMATCH: { code: 'PRODUCT_MISMATCH', http: 409, message: 'Scanned SKU does not match expected SKU' },
  BIN_MISMATCH: { code: 'BIN_MISMATCH', http: 409, message: 'Scanned bin does not match expected bin' },
  QUANTITY_EXCEEDS_RESERVATION: { code: 'QUANTITY_EXCEEDS_RESERVATION', http: 409, message: 'Picked quantity exceeds outstanding reserved quantity' },
  SHORT_PICK_REQUIRES_EXCEPTION: { code: 'SHORT_PICK_REQUIRES_EXCEPTION', http: 422, message: 'Short pick requires an exception details block' },
  EXCEPTION_STATE_INVALID: { code: 'EXCEPTION_STATE_INVALID', http: 409, message: 'Exception not in a state that allows this action' },
  ADJUSTMENT_CONFLICT: { code: 'ADJUSTMENT_CONFLICT', http: 409, message: 'Counted quantity would violate existing reservations' },
  BIN_HAS_RESERVATIONS: { code: 'BIN_HAS_RESERVATIONS', http: 409, message: 'Cannot block/damage bin with active reservations' },
  PACK_INCOMPLETE: { code: 'PACK_INCOMPLETE', http: 409, message: 'Order is not fully picked and resolved' },
  PARTIAL_PACK_FORBIDDEN: { code: 'PARTIAL_PACK_FORBIDDEN', http: 403, message: 'Manager authority required for partial order packing' },
  ROUTE_UNREACHABLE: { code: 'ROUTE_UNREACHABLE', http: 422, message: 'A stop cannot be reached in the navigation graph' },
  PLAN_STALE: { code: 'PLAN_STALE', http: 409, message: 'Plan no longer matches database state' },
  INVENTORY_DRIFT: { code: 'INVENTORY_DRIFT', http: 500, message: 'Inventory state inconsistency detected' },
  ENGINE1_UNAVAILABLE: { code: 'ENGINE1_UNAVAILABLE', http: 503, message: 'Engine 1 Scheduler unavailable' },
  ENGINE2_UNAVAILABLE: { code: 'ENGINE2_UNAVAILABLE', http: 503, message: 'Engine 2 Optimizer unavailable' },
  ENGINE3_UNAVAILABLE: { code: 'ENGINE3_UNAVAILABLE', http: 503, message: 'Engine 3 Inventory unavailable' },
  TASK_FAILED: { code: 'TASK_FAILED', http: 409, message: 'Engine 1 task execution failed' },
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', http: 500, message: 'Internal server error' }
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class DomainError extends AppError {
  constructor(code: string, message?: string, details?: Record<string, unknown>) {
    const meta = (ERROR_CODES as Record<string, { http: number; message: string }>)[code];
    const httpStatus = meta ? meta.http : (ERROR_STATUS_MAP[code] || 500);
    const desc = message || (meta ? meta.message : code);
    super(code, httpStatus, desc, details);
    this.name = 'DomainError';
  }
}
