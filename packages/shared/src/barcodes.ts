export function normalizeScan(s: string): string {
  if (!s) return '';
  return s.trim().toUpperCase();
}

export function matchesBin(scan: string, binCode: string): boolean {
  const normScan = normalizeScan(scan);
  const normBin = normalizeScan(binCode);
  if (!normScan || !normBin) return false;

  if (normScan === normBin) return true;
  if (normScan === `BIN:${normBin}`) return true;
  if (`BIN:${normScan}` === normBin) return true;
  return false;
}

export function matchesSku(
  scan: string,
  product: { sku: string; barcode?: string | null }
): boolean {
  const normScan = normalizeScan(scan);
  if (!normScan || !product) return false;

  const normSku = normalizeScan(product.sku);
  const normBarcode = product.barcode ? normalizeScan(product.barcode) : null;

  if (normBarcode && normScan === normBarcode) return true;
  if (normScan === normSku) return true;
  if (normScan === `SKU:${normSku}`) return true;
  if (normBarcode && normScan === `SKU:${normBarcode}`) return true;
  return false;
}

export function matchesTote(scan: string, toteCode: string): boolean {
  const normScan = normalizeScan(scan);
  const normTote = normalizeScan(toteCode);
  if (!normScan || !normTote) return false;

  if (normScan === normTote) return true;
  if (normScan === `TOTE:${normTote}`) return true;
  if (`TOTE:${normScan}` === normTote) return true;
  return false;
}

export function matchesSlot(scan: string, slotCode: string): boolean {
  const normScan = normalizeScan(scan);
  const normSlot = normalizeScan(slotCode);
  if (!normScan || !normSlot) return false;

  if (normScan === normSlot) return true;
  if (normScan === `DISP:${normSlot}`) return true;
  if (`DISP:${normScan}` === normSlot) return true;
  return false;
}
