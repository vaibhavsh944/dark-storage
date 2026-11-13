export interface PickerStopDTO {
  stopId: number;
  stopRef: string;
  seq: number;
  binCode: string;
  aisleLabel: string;
  sku: string;
  barcode: string;
  productName: string;
  qtyToPick: number;
  qtyPicked: number;
  step: 'PENDING' | 'BIN_OK' | 'ITEM_OK' | 'DONE' | 'SHORT';
  toteCode: string | null;
  orderRef: string;
}

export interface PickerMissionDTO {
  missionRef: string;
  orderRef: string;
  status: string;
  leaseExpiresAt: string | null;
  toteCode: string | null;
  totalStops: number;
  doneStops: number;
  stops: PickerStopDTO[];
}

export interface PackSessionDTO {
  sessionId: number;
  orderRef: string;
  toteCode: string;
  benchCode: string;
  status: 'OPEN' | 'COMPLETE' | 'ABORTED';
  lines: {
    sku: string;
    barcode: string;
    productName: string;
    expectedQty: number;
    scannedQty: number;
    flaggedQty: number;
  }[];
  expectedWeightG: number;
  actualWeightG: number | null;
  weightOk: boolean;
  canComplete: boolean;
}

export interface CountTaskDTO {
  taskRef: string;
  type: 'COUNT';
  binCode: string;
  sku: string;
  round: number;
  dueAt: string | null;
}
