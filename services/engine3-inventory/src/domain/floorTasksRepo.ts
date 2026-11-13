import Database from 'better-sqlite3';
import { AppError } from '@dark-storage/shared';
import { runInTx } from '../db/tx.js';
import { getConfig } from './config.js';
import { toCountTaskDTO } from '../dto/floorDtos.js';
import { appendAudit } from '../audit/appendAudit.js';

export interface FloorTaskActor {
  id: number | string;
  username?: string;
  name?: string;
  role?: string;
  permissions?: string[];
}

export function listFloorTasks(
  db: Database.Database,
  actor: FloorTaskActor,
  query: { status?: string; type?: string }
): any[] {
  const perms = actor.permissions || [];
  const canViewAll = perms.includes('floor:view_all') || actor.role === 'MANAGER';
  const canClaimOp = perms.includes('floortask:claim') || actor.role === 'OPERATOR';
  const canClaimPick = perms.includes('floortask:claim_pick') || actor.role === 'PICKER';

  let allowedTypes: string[] = [];
  if (canViewAll) {
    allowedTypes = ['COUNT', 'RELOCATE', 'REPLENISH', 'PUTBACK', 'REPICK', 'EXPIRY_REMOVE'];
  } else {
    if (canClaimOp) {
      allowedTypes.push('COUNT', 'RELOCATE', 'REPLENISH', 'EXPIRY_REMOVE');
    }
    if (canClaimPick) {
      allowedTypes.push('PUTBACK', 'REPICK');
    }
  }

  if (allowedTypes.length === 0) {
    return [];
  }

  const whereClauses: string[] = [
    `type IN (${allowedTypes.map(t => `'${t}'`).join(',')})`
  ];
  const params: any[] = [];

  if (query.status) {
    whereClauses.push('status = ?');
    params.push(query.status);
  }

  if (query.type) {
    whereClauses.push('type = ?');
    params.push(query.type);
  }

  const sql = `
    SELECT *
    FROM floor_tasks
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY priority ASC, due_at ASC, id ASC
  `;

  const rows = db.prepare(sql).all(...params) as any[];

  return rows.map((row) => {
    if (row.type === 'COUNT') {
      return toCountTaskDTO(row);
    }
    return {
      taskRef: row.task_ref,
      type: row.type,
      status: row.status,
      binCode: row.bin_code,
      destBinCode: row.dest_bin_code,
      sku: row.sku,
      qty: row.qty,
      orderRef: row.order_ref,
      sourceRef: row.source_ref,
      priority: row.priority,
      dueAt: row.due_at,
      assignedTo: row.assigned_to,
      leaseExpiresAt: row.lease_expires_at,
      version: row.version
    };
  });
}

export function claimFloorTask(db: Database.Database, taskRef: string, actor: FloorTaskActor): any {
  return runInTx(db, () => {
    const actorId = actor.id;
    const task = db.prepare('SELECT * FROM floor_tasks WHERE task_ref = ?').get(taskRef) as any;
    if (!task) {
      throw new AppError('NOT_FOUND', 404, `Floor task "${taskRef}" not found`);
    }

    if (task.status !== 'OPEN') {
      throw new AppError('TASK_NOT_OPEN', 409, `Task is in status ${task.status}`);
    }

    // Permission check based on type
    const perms = actor.permissions || [];
    if (['COUNT', 'RELOCATE', 'REPLENISH', 'EXPIRY_REMOVE'].includes(task.type)) {
      if (!perms.includes('floortask:claim') && actor.role !== 'OPERATOR' && !perms.includes('floor:view_all')) {
        throw new AppError('FORBIDDEN', 403, 'Permission floortask:claim required');
      }
    } else if (['PUTBACK', 'REPICK'].includes(task.type)) {
      if (!perms.includes('floortask:claim_pick') && actor.role !== 'PICKER' && !perms.includes('floor:view_all')) {
        throw new AppError('FORBIDDEN', 403, 'Permission floortask:claim_pick required');
      }
    }

    const leaseSec = getConfig<number>(db, 'lease.floor_task_seconds') || 300;
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseSec * 1000).toISOString();

    const res = db.prepare(`
      UPDATE floor_tasks
      SET status = 'CLAIMED',
          assigned_to = ?,
          lease_expires_at = ?,
          version = version + 1
      WHERE id = ? AND version = ? AND status = 'OPEN'
    `).run(actorId, leaseExpiresAt, task.id, task.version);

    if (res.changes !== 1) {
      throw new AppError('VERSION_CONFLICT', 409, 'Floor task was claimed by another worker');
    }

    const updated = db.prepare('SELECT * FROM floor_tasks WHERE id = ?').get(task.id) as any;
    if (updated.type === 'COUNT') {
      return toCountTaskDTO(updated);
    }
    return {
      taskRef: updated.task_ref,
      type: updated.type,
      status: updated.status,
      binCode: updated.bin_code,
      destBinCode: updated.dest_bin_code,
      sku: updated.sku,
      qty: updated.qty,
      orderRef: updated.order_ref,
      assignedTo: updated.assigned_to,
      leaseExpiresAt: updated.lease_expires_at
    };
  });
}

export function heartbeatFloorTask(db: Database.Database, taskRef: string, actor: FloorTaskActor): { ok: true; leaseExpiresAt: string } {
  return runInTx(db, () => {
    const task = db.prepare('SELECT * FROM floor_tasks WHERE task_ref = ?').get(taskRef) as any;
    if (!task) {
      throw new AppError('NOT_FOUND', 404, `Floor task "${taskRef}" not found`);
    }

    if (String(task.assigned_to) !== String(actor.id)) {
      throw new AppError('TASK_NOT_OWNED', 403, 'You do not own this floor task');
    }

    const leaseSec = getConfig<number>(db, 'lease.floor_task_seconds') || 300;
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseSec * 1000).toISOString();

    db.prepare(`
      UPDATE floor_tasks
      SET lease_expires_at = ?,
          version = version + 1
      WHERE id = ?
    `).run(leaseExpiresAt, task.id);

    return { ok: true, leaseExpiresAt };
  });
}

export function releaseFloorTask(db: Database.Database, taskRef: string, actor: FloorTaskActor): { ok: true; status: 'OPEN' } {
  return runInTx(db, () => {
    const task = db.prepare('SELECT * FROM floor_tasks WHERE task_ref = ?').get(taskRef) as any;
    if (!task) {
      throw new AppError('NOT_FOUND', 404, `Floor task "${taskRef}" not found`);
    }

    const perms = actor.permissions || [];
    const isOwner = String(task.assigned_to) === String(actor.id);
    const isSystemOrManager = perms.includes('floor:view_all') || actor.role === 'MANAGER' || actor.role === 'SYSTEM';

    if (!isOwner && !isSystemOrManager) {
      throw new AppError('TASK_NOT_OWNED', 403, 'You do not own this floor task');
    }

    db.prepare(`
      UPDATE floor_tasks
      SET status = 'OPEN',
          assigned_to = NULL,
          lease_expires_at = NULL,
          version = version + 1
      WHERE id = ?
    `).run(task.id);

    return { ok: true, status: 'OPEN' };
  });
}
