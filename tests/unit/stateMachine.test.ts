import { describe, it, expect } from 'vitest';
import { transition, allowedEvents, StateError } from '@dark-storage/shared';

describe('REF-2 State Machine Unit Tests', () => {
  describe('ORDER Transitions', () => {
    it('executes valid order transitions', () => {
      expect(transition('ORDER', 'DRAFT', 'assign').to).toBe('ASSIGNED');
      expect(transition('ORDER', 'RESERVED', 'assign').to).toBe('ASSIGNED');
      expect(transition('ORDER', 'ASSIGNED', 'start_pick').to).toBe('PICKING');
      expect(transition('ORDER', 'ASSIGNED', 'unassign').to).toBe('RESERVED');
      expect(transition('ORDER', 'PICKING', 'unassign').to).toBe('RESERVED');
      expect(transition('ORDER', 'PICKING', 'pick_complete').to).toBe('PICKED');
      expect(transition('ORDER', 'PICKED', 'open_pack').to).toBe('PACKING');
      expect(transition('ORDER', 'PACKING', 'pack_complete').to).toBe('PACKED');
      expect(transition('ORDER', 'PACKING', 'repick').to).toBe('PICKING');
      expect(transition('ORDER', 'PACKED', 'handover').to).toBe('DISPATCHED');

      // Cancellation transitions
      const cancellable = ['DRAFT', 'RESERVED', 'ASSIGNED', 'PICKING', 'PICKED', 'PACKING', 'PACKED'];
      for (const st of cancellable) {
        expect(transition('ORDER', st, 'cancel').to).toBe('CANCELLED');
      }
    });

    it('returns allowed events for ORDER states', () => {
      expect(allowedEvents('ORDER', 'PACKED')).toContain('handover');
      expect(allowedEvents('ORDER', 'PACKED')).toContain('cancel');
      expect(allowedEvents('ORDER', 'DISPATCHED')).toEqual([]);
    });
  });

  describe('MISSION Transitions', () => {
    it('executes valid mission transitions', () => {
      expect(transition('MISSION', 'CREATED', 'claim').to).toBe('ASSIGNED');
      expect(transition('MISSION', 'ASSIGNED', 'first_scan').to).toBe('IN_PROGRESS');
      expect(transition('MISSION', 'IN_PROGRESS', 'complete').to).toBe('COMPLETED');
      expect(transition('MISSION', 'ASSIGNED', 'release').to).toBe('CREATED');
      expect(transition('MISSION', 'IN_PROGRESS', 'release').to).toBe('CREATED');
      expect(transition('MISSION', 'ASSIGNED', 'force_unassign').to).toBe('CREATED');
      expect(transition('MISSION', 'IN_PROGRESS', 'force_unassign').to).toBe('CREATED');
      expect(transition('MISSION', 'CREATED', 'cancel').to).toBe('CANCELLED');
      expect(transition('MISSION', 'ASSIGNED', 'cancel').to).toBe('CANCELLED');
      expect(transition('MISSION', 'IN_PROGRESS', 'cancel').to).toBe('CANCELLED');
    });
  });

  describe('PICK_STOP Transitions', () => {
    it('executes valid 3-step pick stop transitions and exceptions', () => {
      expect(transition('PICK_STOP', 'PENDING', 'scan_bin').to).toBe('BIN_OK');
      expect(transition('PICK_STOP', 'BIN_OK', 'scan_item').to).toBe('ITEM_OK');
      expect(transition('PICK_STOP', 'ITEM_OK', 'scan_tote').to).toBe('DONE');

      // Short exceptions
      expect(transition('PICK_STOP', 'PENDING', 'short').to).toBe('SHORT');
      expect(transition('PICK_STOP', 'BIN_OK', 'short').to).toBe('SHORT');
      expect(transition('PICK_STOP', 'ITEM_OK', 'short').to).toBe('SHORT');

      // Reroute exceptions
      expect(transition('PICK_STOP', 'PENDING', 'reroute').to).toBe('CANCELLED');
      expect(transition('PICK_STOP', 'BIN_OK', 'reroute').to).toBe('CANCELLED');
      expect(transition('PICK_STOP', 'ITEM_OK', 'reroute').to).toBe('CANCELLED');

      expect(transition('PICK_STOP', 'PENDING', 'cancel').to).toBe('CANCELLED');
    });
  });

  describe('EXCEPTION Transitions', () => {
    it('executes valid exception lifecycle transitions', () => {
      expect(transition('EXCEPTION', 'OPEN', 'request_count').to).toBe('COUNT_REQUESTED');
      expect(transition('EXCEPTION', 'COUNT_REQUESTED', 'count_done').to).toBe('COUNT_SUBMITTED');
      expect(transition('EXCEPTION', 'OPEN', 'resolve').to).toBe('RESOLVED');
      expect(transition('EXCEPTION', 'COUNT_SUBMITTED', 'resolve').to).toBe('RESOLVED');
    });
  });

  describe('ADJUSTMENT Transitions (Four-Eyes / Dual-Manager)', () => {
    it('executes low-value and high-value two-manager approval steps', () => {
      expect(transition('ADJUSTMENT', 'PENDING_MANAGER', 'approve_low').to).toBe('APPLIED');
      expect(transition('ADJUSTMENT', 'PENDING_MANAGER', 'approve_high_step1').to).toBe('PENDING_SECOND_MANAGER');
      expect(transition('ADJUSTMENT', 'PENDING_SECOND_MANAGER', 'approve_high_step2').to).toBe('APPLIED');
      expect(transition('ADJUSTMENT', 'PENDING_MANAGER', 'reject').to).toBe('REJECTED');
      expect(transition('ADJUSTMENT', 'PENDING_SECOND_MANAGER', 'reject').to).toBe('REJECTED');
      expect(transition('ADJUSTMENT', 'PENDING_MANAGER', 'cancel').to).toBe('CANCELLED');
    });
  });

  describe('FLOOR_TASK Transitions', () => {
    it('executes valid floor task lifecycle transitions', () => {
      expect(transition('FLOOR_TASK', 'OPEN', 'claim').to).toBe('CLAIMED');
      expect(transition('FLOOR_TASK', 'CLAIMED', 'start').to).toBe('IN_PROGRESS');
      expect(transition('FLOOR_TASK', 'CLAIMED', 'complete').to).toBe('DONE');
      expect(transition('FLOOR_TASK', 'IN_PROGRESS', 'complete').to).toBe('DONE');
      expect(transition('FLOOR_TASK', 'CLAIMED', 'release').to).toBe('OPEN');
      expect(transition('FLOOR_TASK', 'IN_PROGRESS', 'release').to).toBe('OPEN');
      expect(transition('FLOOR_TASK', 'OPEN', 'cancel').to).toBe('CANCELLED');
      expect(transition('FLOOR_TASK', 'CLAIMED', 'cancel').to).toBe('CANCELLED');
      expect(transition('FLOOR_TASK', 'IN_PROGRESS', 'cancel').to).toBe('CANCELLED');
    });
  });

  describe('12 Invalid Transitions throw StateError (STATE_CONFLICT)', () => {
    it('1. ORDER: DRAFT -> pick_complete throws StateError', () => {
      expect(() => transition('ORDER', 'DRAFT', 'pick_complete')).toThrow(StateError);
    });

    it('2. ORDER: DISPATCHED -> cancel throws StateError', () => {
      expect(() => transition('ORDER', 'DISPATCHED', 'cancel')).toThrow(StateError);
    });

    it('3. ORDER: PICKED -> handover throws StateError (must pack first)', () => {
      expect(() => transition('ORDER', 'PICKED', 'handover')).toThrow(StateError);
    });

    it('4. MISSION: CREATED -> complete throws StateError', () => {
      expect(() => transition('MISSION', 'CREATED', 'complete')).toThrow(StateError);
    });

    it('5. MISSION: COMPLETED -> claim throws StateError', () => {
      expect(() => transition('MISSION', 'COMPLETED', 'claim')).toThrow(StateError);
    });

    it('6. PICK_STOP: PENDING -> scan_item throws StateError (must scan bin first)', () => {
      expect(() => transition('PICK_STOP', 'PENDING', 'scan_item')).toThrow(StateError);
    });

    it('7. PICK_STOP: BIN_OK -> scan_tote throws StateError (must scan item first)', () => {
      expect(() => transition('PICK_STOP', 'BIN_OK', 'scan_tote')).toThrow(StateError);
    });

    it('8. PICK_STOP: DONE -> scan_bin throws StateError', () => {
      expect(() => transition('PICK_STOP', 'DONE', 'scan_bin')).toThrow(StateError);
    });

    it('9. EXCEPTION: RESOLVED -> resolve throws StateError', () => {
      expect(() => transition('EXCEPTION', 'RESOLVED', 'resolve')).toThrow(StateError);
    });

    it('10. ADJUSTMENT: APPLIED -> reject throws StateError', () => {
      expect(() => transition('ADJUSTMENT', 'APPLIED', 'reject')).toThrow(StateError);
    });

    it('11. ADJUSTMENT: PENDING_SECOND_MANAGER -> approve_low throws StateError', () => {
      expect(() => transition('ADJUSTMENT', 'PENDING_SECOND_MANAGER', 'approve_low')).toThrow(StateError);
    });

    it('12. FLOOR_TASK: DONE -> claim throws StateError', () => {
      expect(() => transition('FLOOR_TASK', 'DONE', 'claim')).toThrow(StateError);
    });
  });
});
