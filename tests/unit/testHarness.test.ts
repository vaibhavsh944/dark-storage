import { describe, it, expect } from 'vitest';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import { getConfig, getAllConfig, setConfig } from '../../services/engine3-inventory/src/domain/config.js';
import { nextRef } from '../../services/engine3-inventory/src/domain/ids.js';
import { runInTx } from '../../services/engine3-inventory/src/db/tx.js';

describe('P1-T1 & P1-T6 Database Helpers and Test Harness', () => {
  it('initializes in-memory database and applies all migrations', () => {
    const db = makeTestDb();
    expect(db).toBeDefined();

    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(t => t.name);
    expect(tables).toContain('users');
    expect(tables).toContain('products');
    expect(tables).toContain('system_config');
    expect(tables).toContain('job_runs');

    seedMinimal(db);

    const users = db.prepare('SELECT username, role, badge_id FROM users').all() as any[];
    expect(users.length).toBeGreaterThanOrEqual(7);
    expect(users.find(u => u.username === 'manager1')?.role).toBe('MANAGER');
    expect(users.find(u => u.username === 'operator1')?.role).toBe('OPERATOR');
    expect(users.find(u => u.username === 'picker1')?.role).toBe('PICKER');
    expect(users.find(u => u.username === 'staff1')?.role).toBe('STAFF');

    db.close();
  });

  it('verifies system_config getConfig and setConfig with caching', () => {
    const db = makeTestDb();

    // Key seeded in migration 011
    const leaseSec = getConfig<number>(db, 'lease.mission_seconds');
    expect(leaseSec).toBe(60);

    const all = getAllConfig(db);
    expect(Object.keys(all).length).toBeGreaterThanOrEqual(30);
    expect(all['adjust.high_threshold_inr'].value).toBe(5000);

    // setConfig
    setConfig(db, 'lease.mission_seconds', 90, 'manager1');
    expect(getConfig<number>(db, 'lease.mission_seconds')).toBe(90);

    db.close();
  });

  it('verifies nextRef sequences and runInTx transaction helper', () => {
    const db = makeTestDb();

    const ref1 = nextRef(db, 'receipt');
    expect(ref1).toMatch(/^RCV-\d+/);

    const ref2 = nextRef(db, 'PO');
    expect(ref2).toMatch(/^PO-\d+/);

    const result = runInTx(db, () => {
      const msnRef = nextRef(db, 'MSN');
      return msnRef;
    });

    expect(result).toMatch(/^MSN-\d+/);
    db.close();
  });
});
