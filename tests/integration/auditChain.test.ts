import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeTestDb, seedMinimal } from '../helpers/db.js';
import { createApp as createEngine3App } from '../../services/engine3-inventory/src/server.js';
import { config } from '../../services/engine3-inventory/src/config.js';
import {
  appendAudit,
  appendOrderEvent,
  verifyAuditChain,
  ensureAuditChain
} from '../../services/engine3-inventory/src/audit/appendAudit.js';

describe('Audit Chain & Order Events (Phase 3)', () => {
  it('P3-T6: appends 30 audit rows and verifies verifyAuditChain returns ok: true', () => {
    const db = makeTestDb();
    seedMinimal(db);

    // 1. Append 30 sequential audit rows
    for (let i = 1; i <= 30; i++) {
      const res = appendAudit(db, {
        actorId: '1',
        actorRole: 'MANAGER',
        action: `TEST_ACTION_${i}`,
        entityType: 'ORDER',
        entityId: `ORD-${String(i).padStart(4, '0')}`,
        details: { step: i, note: `Audit record ${i}` },
        reasonCode: i % 5 === 0 ? 'ROUTINE_CHECK' : null
      });
      expect(res.seq).toBe(i);
      expect(res.row_hash).toBeDefined();
      expect(res.row_hash.length).toBe(64);
    }

    // 2. Verify audit chain integrity
    const verify = verifyAuditChain(db);
    expect(verify.ok).toBe(true);
    expect(verify.checked).toBe(30);
    expect(verify.brokenAtSeq).toBeNull();
    expect(verify.headHash).toBeDefined();
    expect(verify.head?.last_seq).toBe(30);
  });

  it('P3-T6: UPDATE audit_log SET details=\'hacked\' WHERE seq=12 throws AUDIT_IMMUTABLE', () => {
    const db = makeTestDb();
    seedMinimal(db);

    for (let i = 1; i <= 20; i++) {
      appendAudit(db, {
        actorId: '1',
        actorRole: 'MANAGER',
        action: `ACTION_${i}`,
        entityType: 'ORDER',
        entityId: `ORD-${i}`,
        details: { initial: true }
      });
    }

    // Assert UPDATE on row with row_hash throws AUDIT_IMMUTABLE
    expect(() => {
      db.prepare("UPDATE audit_log SET details = 'hacked' WHERE seq = 12").run();
    }).toThrow(/AUDIT_IMMUTABLE/);

    // Assert DELETE also throws AUDIT_IMMUTABLE
    expect(() => {
      db.prepare('DELETE FROM audit_log WHERE seq = 12').run();
    }).toThrow(/AUDIT_IMMUTABLE/);
  });

  it('P3-T6: drop trg_audit_no_update, mutate row 12, verifyAuditChain returns ok: false, brokenAtSeq: 12', () => {
    const db = makeTestDb();
    seedMinimal(db);

    for (let i = 1; i <= 30; i++) {
      appendAudit(db, {
        actorId: '1',
        actorRole: 'MANAGER',
        action: `ACTION_${i}`,
        entityType: 'ORDER',
        entityId: `ORD-${i}`,
        details: { step: i }
      });
    }

    // Verify chain is initially intact
    const intact = verifyAuditChain(db);
    expect(intact.ok).toBe(true);
    expect(intact.checked).toBe(30);

    // Drop trigger to simulate out-of-band tampering
    db.prepare('DROP TRIGGER trg_audit_no_update').run();

    // Mutate row 12 details
    db.prepare("UPDATE audit_log SET details = 'hacked' WHERE seq = 12").run();

    // Verification must detect the tampering at seq 12
    const tampered = verifyAuditChain(db);
    expect(tampered.ok).toBe(false);
    expect(tampered.brokenAtSeq).toBe(12);
  });

  it('ensureAuditChain backfills unhashed legacy rows and chains them sequentially', () => {
    const db = makeTestDb();
    seedMinimal(db);

    // Temporarily drop trigger to simulate inserting legacy unhashed rows
    db.prepare('DROP TRIGGER IF EXISTS trg_audit_no_update').run();
    db.prepare('DROP TRIGGER IF EXISTS trg_audit_no_delete').run();

    // Insert 5 legacy rows without seq or hash
    for (let i = 1; i <= 5; i++) {
      db.prepare(`
        INSERT INTO audit_log (occurred_at, actor_user_id, actor_role, action, entity_type, entity_id, details_json)
        VALUES ('2026-11-01T10:00:00.000Z', 1, 'MANAGER', 'LEGACY_ACTION', 'ORDER', 'ORD-LEGACY', '{}')
      `).run();
    }

    // Run ensureAuditChain
    const result = ensureAuditChain(db);
    expect(result.backfilled).toBe(5);

    // Recreate trigger
    db.prepare(`
      CREATE TRIGGER trg_audit_no_update
      BEFORE UPDATE ON audit_log
      WHEN OLD.row_hash IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE');
      END;
    `).run();

    // Verify chain is now completely valid
    const verify = verifyAuditChain(db);
    expect(verify.ok).toBe(true);
    expect(verify.checked).toBe(5);
    expect(verify.head?.last_seq).toBe(5);
  });

  it('records and reads order_events with immutability', () => {
    const db = makeTestDb();
    seedMinimal(db);

    // Seed order ORD-999 so foreign key references orders(ref) succeeds
    db.prepare(`
      INSERT INTO orders (ref, order_type, priority, status, requested_by)
      VALUES ('ORD-999', 'CUSTOMER', 'NORMAL', 'RESERVED', 1)
    `).run();

    appendOrderEvent(db, {
      orderRef: 'ORD-999',
      event: 'order.created',
      actorId: '1',
      actorRole: 'MANAGER',
      payload: { total_lines: 3 }
    });

    appendOrderEvent(db, {
      orderRef: 'ORD-999',
      event: 'order.cancelled',
      actorId: '1',
      actorRole: 'MANAGER',
      payload: { reason: 'Customer requested cancellation' }
    });

    const events = db.prepare('SELECT * FROM order_events WHERE order_ref = ? ORDER BY id ASC').all('ORD-999') as any[];
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('order.created');
    expect(events[1].event).toBe('order.cancelled');

    // Immutability on order_events
    expect(() => {
      db.prepare("UPDATE order_events SET event = 'HACKED' WHERE id = 1").run();
    }).toThrow(/AUDIT_IMMUTABLE/);

    expect(() => {
      db.prepare('DELETE FROM order_events WHERE id = 1').run();
    }).toThrow(/AUDIT_IMMUTABLE/);
  });

  describe('P3-T4: Audit and Order Event HTTP Endpoints', () => {
    it('GET /internal/v1/audit/verify returns ok: true', async () => {
      const db = makeTestDb();
      seedMinimal(db);
      const app = createEngine3App(db);

      appendAudit(db, {
        actorId: '1',
        actorRole: 'MANAGER',
        action: 'ORDER_CREATED',
        entityType: 'ORDER',
        entityId: 'ORD-0001',
        details: { lines: 2 }
      });

      const res = await request(app)
        .get('/internal/v1/audit/verify')
        .set('x-internal-token', config.INTERNAL_TOKEN)
        .set('x-actor-id', '1')
        .set('x-actor-role', 'MANAGER');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.checked).toBe(1);
      expect(res.body.brokenAtSeq).toBeNull();
      expect(res.body.headHash).toBeDefined();
    });

    it('GET /internal/v1/audit/export returns text/csv', async () => {
      const db = makeTestDb();
      seedMinimal(db);
      const app = createEngine3App(db);

      appendAudit(db, {
        actorId: '1',
        actorRole: 'MANAGER',
        action: 'ORDER_CREATED',
        entityType: 'ORDER',
        entityId: 'ORD-0001',
        details: { test: true }
      });

      const res = await request(app)
        .get('/internal/v1/audit/export')
        .set('x-internal-token', config.INTERNAL_TOKEN);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('seq,at,actor,role,action,entity_type,entity_id,prev_hash,row_hash,reason_code,details');
      expect(res.text).toContain('ORDER_CREATED');
    });

    it('GET /internal/v1/orders/:ref/events returns chronological events', async () => {
      const db = makeTestDb();
      seedMinimal(db);
      const app = createEngine3App(db);

      db.prepare(`
        INSERT INTO orders (ref, order_type, priority, status, requested_by)
        VALUES ('ORD-555', 'CUSTOMER', 'NORMAL', 'RESERVED', 1)
      `).run();

      appendOrderEvent(db, {
        orderRef: 'ORD-555',
        event: 'order.created',
        actorId: '1',
        actorRole: 'MANAGER',
        payload: { lines: 1 }
      });

      appendOrderEvent(db, {
        orderRef: 'ORD-555',
        event: 'order.cancelled',
        actorId: '1',
        actorRole: 'MANAGER',
        payload: { reason: 'Test' }
      });

      const res = await request(app)
        .get('/internal/v1/orders/ORD-555/events')
        .set('x-internal-token', config.INTERNAL_TOKEN);

      expect(res.status).toBe(200);
      expect(res.body.events).toHaveLength(2);
      expect(res.body.events[0].event).toBe('order.created');
      expect(res.body.events[1].event).toBe('order.cancelled');
    });
  });
});
