import { ROLES, type Role } from './enums.js';
export { ROLES, type Role };

export const ROLE_PERMISSIONS: Record<Role, readonly string[]> = {
  MANAGER: [
    // Control Tower, KPIs & Read-Only Inspection
    'control:view', 'kpi:view', 'order:view', 'inventory:view', 'po:view',
    'dispatch:view', 'trace:view', 'rtv:view', 'floor:view_all', 'shift:note',
    // Order & Mission Management (Supervisory Only - No Physical Execution)
    'order:create', 'order:cancel', 'mission:reassign',
    // Exceptions, Cycle Count Triggers, Relocation Triggers & Dual-Control Approvals
    'exception:view', 'exception:resolve', 'exception:escalated',
    'count:request', 'relocate:request',
    'adjust:approve', 'adjust:approve_high',
    // Purchasing & Slotting Approval
    'po:create', 'reslot:simulate', 'reslot:approve', 'dispatch:regen_otp',
    // Audit & Integrity Verification
    'audit:view', 'audit:verify', 'audit:export',
    // Configuration, Users, Devices, Locks & Simulation
    'config:view', 'config:weights', 'config:thresholds',
    'user:manage', 'device:manage', 'lock:release', 'tote:manage', 'sim:run'
  ],
  OPERATOR: [
    // Inbound Dock, Putaway, Replenishment, Relocation, Blind Count & Damage Flag
    'inbound:receive', 'putaway:execute', 'relocate:execute', 'count:execute',
    'adjust:request', 'damage:flag', 'exception:raise', 'floortask:claim',
    'inventory:view', 'po:view', 'rtv:view', 'rtv:execute'
  ],
  PICKER: [
    // Outbound Floor Runner (Blind to total inventory)
    'mission:claim', 'pick:execute', 'putback:execute',
    'exception:raise', 'floortask:claim_pick'
  ],
  STAFF: [
    // Packing Bench, Quality Gate, Repick Trigger & Rider Dispatch Handover
    'pack:execute', 'repick:request', 'exception:raise',
    'dispatch:view', 'dispatch:handover', 'rto:process'
  ],
};

export function can(
  user: { permissions?: readonly string[]; role?: Role } | null | undefined,
  perm: string
): boolean {
  if (!user) return false;
  const list = user.permissions ?? (user.role ? ROLE_PERMISSIONS[user.role] : []);
  return list.includes(perm);
}
