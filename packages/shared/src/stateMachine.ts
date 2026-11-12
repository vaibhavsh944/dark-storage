export type Machine = 'ORDER' | 'MISSION' | 'PICK_STOP' | 'EXCEPTION' | 'ADJUSTMENT' | 'FLOOR_TASK';

export interface Transition {
  from: string;
  event: string;
  to: string;
  perms?: string[];
  guard?: string;
}

export class StateError extends Error {
  public readonly code = 'STATE_CONFLICT';
  public readonly httpStatus = 409;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'StateError';
    this.details = details;
  }
}

const TRANSITIONS: Record<Machine, Transition[]> = {
  ORDER: [
    { from: 'DRAFT', event: 'assign', to: 'ASSIGNED', perms: ['mission:claim'] },
    { from: 'RESERVED', event: 'assign', to: 'ASSIGNED', perms: ['mission:claim'] },
    { from: 'ASSIGNED', event: 'start_pick', to: 'PICKING', perms: ['pick:execute'] },
    { from: 'ASSIGNED', event: 'unassign', to: 'RESERVED', perms: ['mission:reassign'] },
    { from: 'PICKING', event: 'unassign', to: 'RESERVED', perms: ['mission:reassign'] },
    { from: 'PICKING', event: 'pick_complete', to: 'PICKED', perms: ['pick:execute'] },
    { from: 'PICKED', event: 'open_pack', to: 'PACKING', perms: ['pack:execute'] },
    { from: 'PACKING', event: 'pack_complete', to: 'PACKED', perms: ['pack:execute'] },
    { from: 'PACKING', event: 'repick', to: 'PICKING', perms: ['repick:request'] },
    { from: 'PACKED', event: 'handover', to: 'DISPATCHED', perms: ['dispatch:handover'] },
    { from: 'DRAFT', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] },
    { from: 'RESERVED', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] },
    { from: 'ASSIGNED', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] },
    { from: 'PICKING', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] },
    { from: 'PICKED', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] },
    { from: 'PACKING', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] },
    { from: 'PACKED', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] },
  ],
  MISSION: [
    { from: 'CREATED', event: 'claim', to: 'ASSIGNED', perms: ['mission:claim'] },
    { from: 'ASSIGNED', event: 'first_scan', to: 'IN_PROGRESS', perms: ['pick:execute'] },
    { from: 'IN_PROGRESS', event: 'complete', to: 'COMPLETED', perms: ['pick:execute'] },
    { from: 'ASSIGNED', event: 'release', to: 'CREATED', perms: ['mission:claim'] },
    { from: 'IN_PROGRESS', event: 'release', to: 'CREATED', perms: ['mission:claim'] },
    { from: 'ASSIGNED', event: 'force_unassign', to: 'CREATED', perms: ['mission:reassign'] },
    { from: 'IN_PROGRESS', event: 'force_unassign', to: 'CREATED', perms: ['mission:reassign'] },
    { from: 'CREATED', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] },
    { from: 'ASSIGNED', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] },
    { from: 'IN_PROGRESS', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] },
  ],
  PICK_STOP: [
    { from: 'PENDING', event: 'scan_bin', to: 'BIN_OK', perms: ['pick:execute'] },
    { from: 'BIN_OK', event: 'scan_item', to: 'ITEM_OK', perms: ['pick:execute'] },
    { from: 'ITEM_OK', event: 'scan_tote', to: 'DONE', perms: ['pick:execute'] },
    { from: 'PENDING', event: 'short', to: 'SHORT', perms: ['exception:raise'] },
    { from: 'BIN_OK', event: 'short', to: 'SHORT', perms: ['exception:raise'] },
    { from: 'ITEM_OK', event: 'short', to: 'SHORT', perms: ['exception:raise'] },
    { from: 'PENDING', event: 'reroute', to: 'CANCELLED', perms: ['exception:raise'] },
    { from: 'BIN_OK', event: 'reroute', to: 'CANCELLED', perms: ['exception:raise'] },
    { from: 'ITEM_OK', event: 'reroute', to: 'CANCELLED', perms: ['exception:raise'] },
    { from: 'PENDING', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] },
  ],
  EXCEPTION: [
    { from: 'OPEN', event: 'request_count', to: 'COUNT_REQUESTED', perms: ['count:request'] },
    { from: 'COUNT_REQUESTED', event: 'count_done', to: 'COUNT_SUBMITTED', perms: ['count:execute'] },
    { from: 'OPEN', event: 'resolve', to: 'RESOLVED', perms: ['exception:resolve'] },
    { from: 'COUNT_SUBMITTED', event: 'resolve', to: 'RESOLVED', perms: ['exception:resolve'] },
  ],
  ADJUSTMENT: [
    { from: 'PENDING_MANAGER', event: 'approve_low', to: 'APPLIED', perms: ['adjust:approve'], guard: 'value < threshold && actor != requester' },
    { from: 'PENDING_MANAGER', event: 'approve_high_step1', to: 'PENDING_SECOND_MANAGER', perms: ['adjust:approve'], guard: 'value >= threshold && actor != requester' },
    { from: 'PENDING_SECOND_MANAGER', event: 'approve_high_step2', to: 'APPLIED', perms: ['adjust:approve_high'], guard: 'actor != requester && actor != manager1_id' },
    { from: 'PENDING_MANAGER', event: 'reject', to: 'REJECTED', perms: ['adjust:approve'], guard: 'actor != requester' },
    { from: 'PENDING_SECOND_MANAGER', event: 'reject', to: 'REJECTED', perms: ['adjust:approve'], guard: 'actor != requester' },
    { from: 'PENDING_MANAGER', event: 'cancel', to: 'CANCELLED', perms: ['adjust:request'], guard: 'actor == requester' },
  ],
  FLOOR_TASK: [
    { from: 'OPEN', event: 'claim', to: 'CLAIMED', perms: ['floortask:claim', 'floortask:claim_pick'] },
    { from: 'CLAIMED', event: 'start', to: 'IN_PROGRESS', perms: ['floortask:claim', 'floortask:claim_pick'] },
    { from: 'CLAIMED', event: 'complete', to: 'DONE', perms: ['count:execute', 'relocate:execute', 'putback:execute', 'pick:execute'] },
    { from: 'IN_PROGRESS', event: 'complete', to: 'DONE', perms: ['count:execute', 'relocate:execute', 'putback:execute', 'pick:execute'] },
    { from: 'CLAIMED', event: 'release', to: 'OPEN', perms: ['floortask:claim', 'floortask:claim_pick'] },
    { from: 'IN_PROGRESS', event: 'release', to: 'OPEN', perms: ['floortask:claim', 'floortask:claim_pick'] },
    { from: 'OPEN', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel', 'exception:resolve'] },
    { from: 'CLAIMED', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel', 'exception:resolve'] },
    { from: 'IN_PROGRESS', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel', 'exception:resolve'] },
  ],
};

export function transition(machine: Machine, from: string, event: string): Transition {
  const machineTransitions = TRANSITIONS[machine];
  if (!machineTransitions) {
    throw new StateError(`Unknown state machine: ${machine}`);
  }

  const match = machineTransitions.find(t => t.from === from && t.event === event);
  if (!match) {
    const valid = machineTransitions.filter(t => t.from === from).map(t => t.event);
    throw new StateError(
      `Cannot trigger event "${event}" on ${machine} in state "${from}". Allowed events: [${valid.join(', ')}]`,
      { machine, from, event, allowedEvents: valid }
    );
  }

  return match;
}

export function allowedEvents(machine: Machine, from: string): string[] {
  const machineTransitions = TRANSITIONS[machine];
  if (!machineTransitions) return [];
  return [...new Set(machineTransitions.filter(t => t.from === from).map(t => t.event))];
}
