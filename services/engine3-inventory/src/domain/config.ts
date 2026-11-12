import Database from 'better-sqlite3';
import { AppError } from '@dark-storage/shared';

interface CacheEntry {
  value: any;
  grp: 'THRESHOLD' | 'WEIGHT';
  type: string;
  expiresAt: number;
}

const configCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5000;

export function clearConfigCache(): void {
  configCache.clear();
}

export function getConfig<T = any>(db: Database.Database, key: string): T {
  const now = Date.now();
  const cached = configCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  const row = db.prepare('SELECT key, value, type, grp FROM system_config WHERE key = ?').get(key) as {
    key: string;
    value: string;
    type: string;
    grp: 'THRESHOLD' | 'WEIGHT';
  } | undefined;

  if (!row) {
    throw new AppError('NOT_FOUND', 404, `Config key "${key}" not found`);
  }

  let parsed: any = row.value;
  if (row.type === 'int') {
    parsed = parseInt(row.value, 10);
  } else if (row.type === 'float') {
    parsed = parseFloat(row.value);
  } else if (row.type === 'bool') {
    parsed = row.value === 'true' || row.value === '1';
  }

  configCache.set(key, {
    value: parsed,
    grp: row.grp,
    type: row.type,
    expiresAt: now + CACHE_TTL_MS
  });

  return parsed as T;
}

export function getAllConfig(db: Database.Database): Record<string, any> {
  const rows = db.prepare('SELECT key, value, type, grp, description, updated_at, updated_by FROM system_config').all() as {
    key: string;
    value: string;
    type: string;
    grp: string;
    description: string;
    updated_at: string;
    updated_by: string | null;
  }[];

  const result: Record<string, any> = {};
  for (const r of rows) {
    let parsed: any = r.value;
    if (r.type === 'int') parsed = parseInt(r.value, 10);
    else if (r.type === 'float') parsed = parseFloat(r.value);
    else if (r.type === 'bool') parsed = r.value === 'true' || r.value === '1';

    result[r.key] = {
      value: parsed,
      rawValue: r.value,
      type: r.type,
      grp: r.grp,
      description: r.description,
      updated_at: r.updated_at,
      updated_by: r.updated_by
    };
  }
  return result;
}

export function setConfig(
  db: Database.Database,
  key: string,
  value: string | number | boolean,
  actorId: string
): { key: string; value: any; grp: string } {
  const row = db.prepare('SELECT key, type, grp FROM system_config WHERE key = ?').get(key) as {
    key: string;
    type: string;
    grp: 'THRESHOLD' | 'WEIGHT';
  } | undefined;

  if (!row) {
    throw new AppError('NOT_FOUND', 404, `Config key "${key}" not found`);
  }

  const strValue = String(value);

  // Validate type formatting
  if (row.type === 'int') {
    const n = Number(value);
    if (!Number.isInteger(n)) {
      throw new AppError('VALIDATION_FAILED', 400, `Config key "${key}" expects an integer value`);
    }
  } else if (row.type === 'float') {
    const n = Number(value);
    if (isNaN(n)) {
      throw new AppError('VALIDATION_FAILED', 400, `Config key "${key}" expects a numeric float value`);
    }
  } else if (row.type === 'bool') {
    if (strValue !== 'true' && strValue !== 'false' && strValue !== '1' && strValue !== '0') {
      throw new AppError('VALIDATION_FAILED', 400, `Config key "${key}" expects a boolean value`);
    }
  }

  db.prepare(`
    UPDATE system_config
    SET value = ?, updated_at = (datetime('now')), updated_by = ?
    WHERE key = ?
  `).run(strValue, actorId, key);

  configCache.delete(key);
  const parsed = getConfig(db, key);

  return { key, value: parsed, grp: row.grp };
}
