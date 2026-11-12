import Database from 'better-sqlite3';

export function runInTx<T>(db: Database.Database, fn: () => T): T {
  db.pragma('busy_timeout = 5000');
  const trx = db.transaction(fn);
  return db.inTransaction ? trx() : trx.immediate();
}

export const runTx = runInTx;
