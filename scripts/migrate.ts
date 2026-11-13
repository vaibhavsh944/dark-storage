import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

export function applyMigrations(db: Database.Database, dir: string): { applied: number; skipped: number } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);

  if (!fs.existsSync(dir)) {
    return { applied: 0, skipped: 0 };
  }

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let applied = 0;
  let skipped = 0;

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const checksum = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    const version = file.split('_')[0] || file;

    const row = db.prepare('SELECT checksum FROM schema_migrations WHERE version = ?').get(version) as { checksum: string } | undefined;

    if (row) {
      if (row.checksum !== checksum) {
        throw new Error(`MIGRATION_CHECKSUM_MISMATCH: Migration ${file} checksum mismatch`);
      }
      skipped++;
      continue;
    }

    db.pragma('foreign_keys = OFF');
    const tx = db.transaction(() => {
      db.exec(content);
      db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum)
        VALUES (?, ?, ?)
      `).run(version, file, checksum);
    });

    tx();
    db.pragma('foreign_keys = ON');
    const fkErrors = db.pragma('foreign_key_check') as any[];
    if (fkErrors.length > 0) {
      throw new Error(`FOREIGN_KEY_CHECK_FAILED: Migration ${file} left invalid foreign keys: ${JSON.stringify(fkErrors)}`);
    }
    applied++;
  }

  return { applied, skipped };
}

// When executed directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/migrate.ts')) {
  const warehouseDbPath = process.env.WAREHOUSE_DB_PATH || './data/warehouse.db';
  const schedulerDbPath = process.env.SCHEDULER_DB_PATH || './data/scheduler.db';

  fs.mkdirSync(path.dirname(warehouseDbPath), { recursive: true });
  fs.mkdirSync(path.dirname(schedulerDbPath), { recursive: true });

  const warehouseDb = new Database(warehouseDbPath);
  warehouseDb.pragma('journal_mode = WAL');
  warehouseDb.pragma('foreign_keys = ON');
  warehouseDb.pragma('busy_timeout = 5000');

  console.log(`Applying warehouse migrations to ${warehouseDbPath}...`);
  const wRes = applyMigrations(warehouseDb, path.resolve('migrations/warehouse'));
  console.log(`Warehouse: ${wRes.applied} applied, ${wRes.skipped} skipped.`);
  warehouseDb.close();

  const schedulerDb = new Database(schedulerDbPath);
  schedulerDb.pragma('journal_mode = WAL');
  schedulerDb.pragma('foreign_keys = ON');
  schedulerDb.pragma('busy_timeout = 5000');

  console.log(`Applying scheduler migrations to ${schedulerDbPath}...`);
  const sRes = applyMigrations(schedulerDb, path.resolve('migrations/scheduler'));
  console.log(`Scheduler: ${sRes.applied} applied, ${sRes.skipped} skipped.`);
  schedulerDb.close();

  console.log('Migration completed successfully.');
}
