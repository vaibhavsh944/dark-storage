import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../services/gateway/src/server.js';
import { makeToken } from '../helpers/auth.js';

describe('P2-T6: RBAC Enforcement and Endpoint Removals', () => {
  const app = createApp();

  const managerToken = makeToken('MANAGER', 1, 'manager1');
  const operatorToken = makeToken('OPERATOR', 2, 'operator1');
  const pickerToken = makeToken('PICKER', 3, 'picker1');
  const staffToken = makeToken('STAFF', 4, 'staff1');

  describe('Manager Forbidden Actions (Floor Execution)', () => {
    it('MANAGER gets 403 FORBIDDEN on POST /api/receipts', async () => {
      const res = await request(app)
        .post('/api/receipts')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ supplier: 'Acme', lines: [{ sku: 'SKU001', qty: 10 }] });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('MANAGER gets 403 FORBIDDEN on POST /api/putaway', async () => {
      const res = await request(app)
        .post('/api/putaway')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ receipt_line_id: 1, dest_bin: 'A-01-01', qty: 5 });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('MANAGER gets 403 FORBIDDEN on POST /api/inventory/relocate', async () => {
      const res = await request(app)
        .post('/api/inventory/relocate')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ from_bin: 'A-01-01', to_bin: 'A-01-02', sku: 'SKU001', qty: 2 });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  describe('Picker Forbidden Actions (Order/Inventory/Audit Visibility)', () => {
    it('PICKER gets 403 FORBIDDEN on GET /api/orders', async () => {
      const res = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${pickerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('PICKER gets 403 FORBIDDEN on GET /api/inventory/summary', async () => {
      const res = await request(app)
        .get('/api/inventory/summary')
        .set('Authorization', `Bearer ${pickerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('PICKER gets 403 FORBIDDEN on GET /api/audit', async () => {
      const res = await request(app)
        .get('/api/audit')
        .set('Authorization', `Bearer ${pickerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  describe('Operator Forbidden Actions (Customer Order Management)', () => {
    it('OPERATOR gets 403 FORBIDDEN on GET /api/orders', async () => {
      const res = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('OPERATOR gets 403 FORBIDDEN on POST /api/orders', async () => {
      const res = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ customer_name: 'Bob', lines: [{ sku: 'SKU001', qty: 1 }] });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  describe('Staff Forbidden Actions (Inbound & Outbound Order Creation)', () => {
    it('STAFF gets 403 FORBIDDEN on POST /api/receipts', async () => {
      const res = await request(app)
        .post('/api/receipts')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ supplier: 'Acme', lines: [{ sku: 'SKU001', qty: 10 }] });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('STAFF gets 403 FORBIDDEN on POST /api/putaway', async () => {
      const res = await request(app)
        .post('/api/putaway')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ receipt_line_id: 1, dest_bin: 'A-01-01', qty: 5 });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('STAFF gets 403 FORBIDDEN on POST /api/orders', async () => {
      const res = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ customer_name: 'Carol', lines: [{ sku: 'SKU001', qty: 1 }] });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  describe('D11 Removed Shortcut Endpoints (410 ENDPOINT_REMOVED)', () => {
    it('POST /api/orders/:ref/pack returns 410 with replacement /api/packing/open', async () => {
      const res = await request(app)
        .post('/api/orders/ORD-001/pack')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(410);
      expect(res.body.code).toBe('ENDPOINT_REMOVED');
      expect(res.body.details?.replacement).toBe('/api/packing/open');
    });

    it('POST /api/packing/:ref/pack returns 410 with replacement /api/packing/open', async () => {
      const res = await request(app)
        .post('/api/packing/ORD-001/pack')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(410);
      expect(res.body.code).toBe('ENDPOINT_REMOVED');
      expect(res.body.details?.replacement).toBe('/api/packing/open');
    });

    it('POST /api/pick-stops/:stopRef/confirm returns 410 with replacement /api/pick-stops/:stopRef/scan-bin', async () => {
      const res = await request(app)
        .post('/api/pick-stops/STOP-001/confirm')
        .set('Authorization', `Bearer ${pickerToken}`);

      expect(res.status).toBe(410);
      expect(res.body.code).toBe('ENDPOINT_REMOVED');
      expect(res.body.details?.replacement).toBe('/api/pick-stops/:stopRef/scan-bin');
    });

    it('POST /api/inventory/bins/:code/recount returns 410 with replacement /api/floor-tasks/:ref/count', async () => {
      const res = await request(app)
        .post('/api/inventory/bins/A-01-01/recount')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(410);
      expect(res.body.code).toBe('ENDPOINT_REMOVED');
      expect(res.body.details?.replacement).toBe('/api/floor-tasks/:ref/count');
    });

    it('POST /api/orders/:ref/assign returns 410 with replacement /api/missions/claim-next', async () => {
      const res = await request(app)
        .post('/api/orders/ORD-001/assign')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(410);
      expect(res.body.code).toBe('ENDPOINT_REMOVED');
      expect(res.body.details?.replacement).toBe('/api/missions/claim-next');
    });
  });
});
