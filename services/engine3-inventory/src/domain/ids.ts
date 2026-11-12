import Database from 'better-sqlite3';
import { formatRef } from '@dark-storage/shared';

export type SequenceName =
  | 'receipt'
  | 'putaway'
  | 'order'
  | 'mission'
  | 'movement'
  | 'exception'
  | 'packing'
  | 'adjustment'
  | string;

const PREFIX_TO_NAME: Record<string, string> = {
  MSN: 'mission',
  MIS: 'mission',
  ORD: 'order',
  RCV: 'receipt',
  PUT: 'putaway',
  MOV: 'movement',
  ADJ: 'adjustment',
  FT: 'floor_task',
  EXC: 'exception',
  PO: 'purchase_order',
  RSL: 'reslot',
  RTV: 'rtv',
  PCK: 'packing',
  LGR: 'ledger'
};

export function nextRef(db: Database.Database, nameOrPrefix: SequenceName): string {
  const clean = nameOrPrefix.replace(/-$/, '').toUpperCase();
  const sequenceName = PREFIX_TO_NAME[clean] || nameOrPrefix.toLowerCase();
  const defaultPrefix = PREFIX_TO_NAME[clean] ? clean : (clean.length <= 4 ? clean : clean.slice(0, 3));

  let row = db.prepare(`
    UPDATE id_sequences
    SET next_value = next_value + 1
    WHERE name = ?
    RETURNING prefix, (next_value - 1) AS n
  `).get(sequenceName) as { prefix: string; n: number } | undefined;

  if (!row) {
    db.prepare(`
      INSERT OR IGNORE INTO id_sequences (name, prefix, next_value)
      VALUES (?, ?, 2)
    `).run(sequenceName, defaultPrefix);

    row = { prefix: defaultPrefix, n: 1 };
  }

  // If specific prefix requested, use that prefix (e.g. MSN instead of legacy MIS)
  const prefixToUse = PREFIX_TO_NAME[clean] ? defaultPrefix : row.prefix;
  return formatRef(prefixToUse, row.n);
}
