import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import { claimNextMission } from '../../services/engine3-inventory/src/domain/missionsClaimRepo.js';

describe('Claim Race Integration Test', () => {
  it('handles 20 concurrent picker claim calls against 5 queued missions with exactly 5 distinct assignments', async () => {
    const db = makeTestDb();
    seedMinimal(db);

    // Create 20 picker users in db
    for (let i = 1; i <= 20; i++) {
      db.prepare(`
        INSERT OR IGNORE INTO users (id, username, display_name, password_hash, role, active, zones)
        VALUES (?, ?, ?, 'hash', 'PICKER', 1, '[]')
      `).run(100 + i, `botpicker${i}`, `Bot Picker ${i}`);
    }

    // Create 5 orders and 5 queued missions
    for (let m = 1; m <= 5; m++) {
      db.prepare(`
        INSERT INTO orders (id, ref, order_type, priority, status, requested_by)
        VALUES (?, ?, 'CUSTOMER', 'NORMAL', 'RESERVED', 1)
      `).run(200 + m, `ORD-RACE-${m}`);

      db.prepare(`
        INSERT INTO missions (id, ref, order_id, status, route_json, route_distance, route_algorithm, priority, version)
        VALUES (?, ?, ?, 'CREATED', '[]', 10.0, 'TRIVIAL', ?, 0)
      `).run(200 + m, `MSN-RACE-${m}`, 200 + m, m * 10);
    }

    // Concurrently invoke claimNextMission for 20 pickers
    const pickers = Array.from({ length: 20 }, (_, idx) => ({
      id: 101 + idx,
      username: `botpicker${idx + 1}`,
      role: 'PICKER'
    }));

    const results = await Promise.allSettled(
      pickers.map((p) => {
        return new Promise((resolve, reject) => {
          try {
            const dto = claimNextMission(db, p);
            resolve(dto);
          } catch (err) {
            reject(err);
          }
        });
      })
    );

    const successes = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const failures = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(successes.length).toBe(5);
    expect(failures.length).toBe(15);

    // Ensure all 5 claimed missions are distinct
    const claimedMissionRefs = successes.map((s) => s.value.missionRef);
    const uniqueMissionRefs = new Set(claimedMissionRefs);
    expect(uniqueMissionRefs.size).toBe(5);

    // Ensure failures are either NO_MISSION_AVAILABLE or VERSION_CONFLICT
    for (const f of failures) {
      const msg = f.reason.message || '';
      expect(msg.includes('NO_MISSION_AVAILABLE') || msg.includes('VERSION_CONFLICT')).toBe(true);
    }

    // Verify database state: exactly 5 ASSIGNED missions with distinct pickers
    const assignedMissions = db.prepare("SELECT ref, picker_id FROM missions WHERE status = 'ASSIGNED'").all() as any[];
    expect(assignedMissions.length).toBe(5);
    const assignedPickers = new Set(assignedMissions.map((m) => m.picker_id));
    expect(assignedPickers.size).toBe(5);
  });
});
