export const ROLES = ['MANAGER', 'OPERATOR', 'PICKER', 'STAFF'] as const;
export type Role = (typeof ROLES)[number];

export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const STORAGE_CLASSES = ['STANDARD', 'HAZMAT'] as const;
export type StorageClass = (typeof STORAGE_CLASSES)[number];

export const SHELF_STATUSES = ['ACTIVE', 'MAINTENANCE', 'BLOCKED'] as const;
export type ShelfStatus = (typeof SHELF_STATUSES)[number];

export const BIN_STATUSES = ['ACTIVE', 'BLOCKED', 'DAMAGED'] as const;
export type BinStatus = (typeof BIN_STATUSES)[number];

export const MOVEMENT_TYPES = ['RECEIVE', 'PUTAWAY', 'RELOCATE', 'PICK', 'ADJUSTMENT'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_KINDS = ['EXTERNAL', 'STAGING', 'BIN', 'ORDER_PACKING', 'ADJUSTMENT'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const RECEIPT_STATUSES = ['STAGED', 'PARTIALLY_PUT_AWAY', 'PUT_AWAY'] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const ORDER_TYPES = ['CUSTOMER', 'TRANSFER', 'PRODUCTION'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const ORDER_STATUSES = ['RESERVED', 'ASSIGNED', 'PICKING', 'PICKED', 'COMPLETED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const FULFILMENT_TYPES = ['FULL', 'PARTIAL'] as const;
export type FulfilmentType = (typeof FULFILMENT_TYPES)[number];

export const RESERVATION_STATUSES = ['HELD', 'CONSUMED', 'RELEASED'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const MISSION_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const PICK_STOP_STATUSES = ['PENDING', 'PICKED', 'EXCEPTION_OPEN', 'RESOLVED'] as const;
export type PickStopStatus = (typeof PICK_STOP_STATUSES)[number];

export const EXCEPTION_TYPES = ['BIN_EMPTY', 'DAMAGED', 'SHORT_PICK', 'WRONG_PRODUCT', 'OTHER'] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];

export const EXCEPTION_RESOLUTIONS = ['REALLOCATE', 'ACCEPT_SHORT', 'ORDER_CANCELLED'] as const;
export type ExceptionResolution = (typeof EXCEPTION_RESOLUTIONS)[number];

export const TASK_TYPES = ['PUTAWAY', 'RELOCATE', 'RESERVE_ORDER', 'PICK_CONFIRM', 'EXCEPTION_RESOLVE'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ROUTE_ALGORITHMS = ['HELD_KARP', 'TWO_OPT', 'TRIVIAL'] as const;
export type RouteAlgorithm = (typeof ROUTE_ALGORITHMS)[number];

export const SELECTION_MODES = ['RECOMMENDED', 'MANUAL'] as const;
export type SelectionMode = (typeof SELECTION_MODES)[number];

export const NAV_NODE_KINDS = ['DOCK', 'PACK', 'CROSS', 'AISLE'] as const;
export type NavNodeKind = (typeof NAV_NODE_KINDS)[number];

export const REASON_CODES = [
  'DAMAGED', 'EXPIRED', 'MISSING', 'FOUND', 'COUNT_VARIANCE',
  'THEFT_SUSPECTED', 'MISPLACED', 'SUPPLIER_SHORT', 'CUSTOMER_CANCEL',
  'STUCK_PICKER', 'OUT_OF_STOCK', 'BIN_FULL', 'BIN_BLOCKED', 'OTHER'
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
