import { describe, it, expect } from 'vitest';
import { can, ROLES, ROLE_PERMISSIONS, Role } from '@dark-storage/shared';

describe('REF-1 4-Role Permissions Unit Tests', () => {
  it('strictly defines only the 4 specified roles', () => {
    expect(ROLES).toEqual(['MANAGER', 'OPERATOR', 'PICKER', 'STAFF']);
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(['MANAGER', 'OPERATOR', 'PICKER', 'STAFF'].sort());
  });

  it('asserts MANAGER has zero physical execution permissions (Strict SoD)', () => {
    const manager = { role: 'MANAGER' as Role };

    const physicalFloorPerms = [
      'inbound:receive',
      'putaway:execute',
      'relocate:execute',
      'count:execute',
      'adjust:request',
      'pick:execute',
      'pack:execute',
      'dispatch:handover'
    ];

    for (const perm of physicalFloorPerms) {
      expect(can(manager, perm), `MANAGER should NOT have ${perm}`).toBe(false);
    }

    // Manager should have control, exception resolve, config, etc.
    expect(can(manager, 'control:view')).toBe(true);
    expect(can(manager, 'adjust:approve')).toBe(true);
    expect(can(manager, 'adjust:approve_high')).toBe(true);
    expect(can(manager, 'exception:resolve')).toBe(true);
    expect(can(manager, 'order:cancel')).toBe(true);
    expect(can(manager, 'config:view')).toBe(true);
  });

  it('asserts OPERATOR cannot pick, pack, or approve adjustments', () => {
    const operator = { role: 'OPERATOR' as Role };

    expect(can(operator, 'pick:execute')).toBe(false);
    expect(can(operator, 'pack:execute')).toBe(false);
    expect(can(operator, 'adjust:approve')).toBe(false);

    // Operator has inbound, putaway, count, relocate, damage flag
    expect(can(operator, 'inbound:receive')).toBe(true);
    expect(can(operator, 'putaway:execute')).toBe(true);
    expect(can(operator, 'relocate:execute')).toBe(true);
    expect(can(operator, 'count:execute')).toBe(true);
    expect(can(operator, 'adjust:request')).toBe(true);
    expect(can(operator, 'damage:flag')).toBe(true);
    expect(can(operator, 'inventory:view')).toBe(true);
  });

  it('asserts PICKER is blind to total inventory and order management', () => {
    const picker = { role: 'PICKER' as Role };

    expect(can(picker, 'inventory:view')).toBe(false);
    expect(can(picker, 'order:view')).toBe(false);
    expect(can(picker, 'order:create')).toBe(false);
    expect(can(picker, 'adjust:approve')).toBe(false);

    // Picker can claim missions, execute 3-step pick, raise exception, execute putback
    expect(can(picker, 'mission:claim')).toBe(true);
    expect(can(picker, 'pick:execute')).toBe(true);
    expect(can(picker, 'putback:execute')).toBe(true);
    expect(can(picker, 'exception:raise')).toBe(true);
  });

  it('asserts STAFF can execute packing bench and rider dispatch handover', () => {
    const staff = { role: 'STAFF' as Role };

    expect(can(staff, 'pack:execute')).toBe(true);
    expect(can(staff, 'dispatch:handover')).toBe(true);
    expect(can(staff, 'repick:request')).toBe(true);
    expect(can(staff, 'dispatch:view')).toBe(true);

    // Staff cannot perform inbound dock or putaway
    expect(can(staff, 'inbound:receive')).toBe(false);
    expect(can(staff, 'putaway:execute')).toBe(false);
    expect(can(staff, 'order:create')).toBe(false);
  });

  it('supports custom permissions list on user object override', () => {
    const customUser = {
      role: 'PICKER' as Role,
      permissions: ['custom:perm', 'mission:claim']
    };
    expect(can(customUser, 'custom:perm')).toBe(true);
    expect(can(customUser, 'mission:claim')).toBe(true);
    expect(can(customUser, 'pick:execute')).toBe(false);
  });

  it('returns false for null/undefined user', () => {
    expect(can(null, 'order:view')).toBe(false);
    expect(can(undefined, 'order:view')).toBe(false);
  });
});
