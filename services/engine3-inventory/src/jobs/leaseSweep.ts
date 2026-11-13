import Database from 'better-sqlite3';
import { runInTx } from '../db/tx.js';
import { appendOrderEvent } from '../audit/appendAudit.js';
import { emit } from '../domain/outbox.js';

export function runLeaseSweep(db: Database.Database): { expiredMissions: number; expiredFloorTasks: number } {
  return runInTx(db, () => {
    const nowIso = new Date().toISOString();

    // 1. Sweep expired missions
    const expiredMissions = db.prepare(`
      SELECT m.id, m.ref, m.order_id, m.tote_code, o.ref AS order_ref
      FROM missions m
      JOIN orders o ON o.id = m.order_id
      WHERE m.status IN ('ASSIGNED', 'IN_PROGRESS')
        AND m.lease_expires_at IS NOT NULL
        AND m.lease_expires_at < ?
    `).all(nowIso) as Array<{
      id: number;
      ref: string;
      order_id: number;
      tote_code: string | null;
      order_ref: string;
    }>;

    for (const m of expiredMissions) {
      const doneStops = (db.prepare(`
        SELECT COUNT(*) AS c
        FROM pick_stops
        WHERE mission_id = ? AND step = 'DONE'
      `).get(m.id) as { c: number }).c;

      const newOrderStatus = doneStops === 0 ? 'RESERVED' : 'PICKING';

      db.prepare(`
        UPDATE missions
        SET status = 'CREATED',
            picker_id = NULL,
            lease_expires_at = NULL,
            version = version + 1
        WHERE id = ?
      `).run(m.id);

      db.prepare(`
        UPDATE orders
        SET status = ?,
            updated_at = ?
        WHERE id = ?
      `).run(newOrderStatus, nowIso, m.order_id);

      appendOrderEvent(db, {
        orderRef: m.order_ref,
        event: 'mission.lease_expired',
        actor: { id: 'SYSTEM', username: 'SYSTEM', role: 'SYSTEM' },
        payload: {
          missionRef: m.ref,
          doneStops
        }
      });

      emit(db, {
        event_type: 'mission.lease_expired',
        entity_type: 'MISSION',
        entity_id: m.ref,
        data: {
          mission_ref: m.ref,
          order_ref: m.order_ref
        }
      });
    }

    // 2. Sweep expired floor tasks
    const expiredTasks = db.prepare(`
      SELECT id, task_ref
      FROM floor_tasks
      WHERE status IN ('CLAIMED', 'IN_PROGRESS')
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at < ?
    `).all(nowIso) as Array<{ id: number; task_ref: string }>;

    for (const t of expiredTasks) {
      db.prepare(`
        UPDATE floor_tasks
        SET status = 'OPEN',
            assigned_to = NULL,
            lease_expires_at = NULL,
            version = version + 1
        WHERE id = ?
      `).run(t.id);
    }

    // 3. Record job run
    db.prepare(`
      INSERT INTO job_runs (job, started_at, finished_at, status, detail)
      VALUES ('lease_sweep', ?, (strftime('%Y-%m-%dT%H:%M:%fZ','now')), 'OK', ?)
    `).run(
      nowIso,
      JSON.stringify({
        expiredMissions: expiredMissions.length,
        expiredFloorTasks: expiredTasks.length
      })
    );

    return {
      expiredMissions: expiredMissions.length,
      expiredFloorTasks: expiredTasks.length
    };
  });
}
