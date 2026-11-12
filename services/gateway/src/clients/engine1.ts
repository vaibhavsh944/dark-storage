import { DomainError, ErrorCode, TaskDto } from '@dark-storage/shared';
import { config } from '../config.js';

export interface RunViaEngine1Options {
  type: string;
  priority: number;
  key: string;
  actor: {
    id: number | string;
    display_name?: string;
    name?: string;
    role: string;
  };
  payload: Record<string, unknown>;
  resources: string[];
  waitMs?: number;
}

export interface Engine1Result<T = unknown> {
  status: number;
  data: T;
}

export async function postTaskToEngine1(opts: {
  type: string;
  priority: number;
  idempotency_key: string;
  actor: { id: number | string; display_name?: string; name?: string; role: string };
  payload: Record<string, unknown>;
  resources: string[];
}): Promise<TaskDto | { id: string; status: string }> {
  const url = `${config.ENGINE1_URL}/internal/v1/tasks`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': config.INTERNAL_TOKEN,
        Authorization: `Bearer ${config.INTERNAL_TOKEN}`
      },
      body: JSON.stringify(opts)
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as any;
      if (errBody?.error?.code) {
        throw new DomainError(errBody.error.code as ErrorCode, errBody.error.message, errBody.error.details);
      }
      if (errBody?.code) {
        throw new DomainError(errBody.code as ErrorCode, errBody.message, errBody.details);
      }
      throw new DomainError('ENGINE1_UNAVAILABLE', `Engine 1 returned HTTP ${res.status}`);
    }

    return (await res.json()) as TaskDto;
  } catch (err: any) {
    if (err instanceof DomainError) throw err;
    throw new DomainError('ENGINE1_UNAVAILABLE', 'Engine 1 Scheduler unavailable');
  }
}

export async function getTaskFromEngine1(taskId: string, waitMs: number = 0): Promise<TaskDto> {
  const url = `${config.ENGINE1_URL}/internal/v1/tasks/${taskId}?wait_ms=${waitMs}`;
  try {
    const res = await fetch(url, {
      headers: {
        'x-internal-token': config.INTERNAL_TOKEN,
        Authorization: `Bearer ${config.INTERNAL_TOKEN}`
      }
    });

    if (!res.ok) {
      if (res.status === 404) {
        throw new DomainError('NOT_FOUND', `Task ${taskId} not found`);
      }
      throw new DomainError('ENGINE1_UNAVAILABLE', `Engine 1 returned HTTP ${res.status}`);
    }

    return (await res.json()) as TaskDto;
  } catch (err: any) {
    if (err instanceof DomainError) throw err;
    throw new DomainError('ENGINE1_UNAVAILABLE', 'Engine 1 Scheduler unavailable');
  }
}

export async function listTasksFromEngine1(query: { status?: string; type?: string; page?: number; limit?: number }) {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.type) params.set('type', query.type);
  if (query.page) params.set('page', query.page.toString());
  if (query.limit) params.set('limit', query.limit.toString());

  const url = `${config.ENGINE1_URL}/internal/v1/tasks?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: {
        'x-internal-token': config.INTERNAL_TOKEN,
        Authorization: `Bearer ${config.INTERNAL_TOKEN}`
      }
    });
    if (!res.ok) {
      throw new DomainError('ENGINE1_UNAVAILABLE', `Engine 1 returned HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err: any) {
    if (err instanceof DomainError) throw err;
    throw new DomainError('ENGINE1_UNAVAILABLE', 'Engine 1 Scheduler unavailable');
  }
}

export async function getLocksFromEngine1() {
  const url = `${config.ENGINE1_URL}/internal/v1/locks`;
  try {
    const res = await fetch(url, {
      headers: {
        'x-internal-token': config.INTERNAL_TOKEN,
        Authorization: `Bearer ${config.INTERNAL_TOKEN}`
      }
    });
    if (!res.ok) {
      throw new DomainError('ENGINE1_UNAVAILABLE', `Engine 1 returned HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err: any) {
    if (err instanceof DomainError) throw err;
    throw new DomainError('ENGINE1_UNAVAILABLE', 'Engine 1 Scheduler unavailable');
  }
}

export async function getQueueFromEngine1() {
  const url = `${config.ENGINE1_URL}/internal/v1/queue`;
  try {
    const res = await fetch(url, {
      headers: {
        'x-internal-token': config.INTERNAL_TOKEN,
        Authorization: `Bearer ${config.INTERNAL_TOKEN}`
      }
    });
    if (!res.ok) {
      throw new DomainError('ENGINE1_UNAVAILABLE', `Engine 1 returned HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err: any) {
    if (err instanceof DomainError) throw err;
    throw new DomainError('ENGINE1_UNAVAILABLE', 'Engine 1 Scheduler unavailable');
  }
}

export async function runViaEngine1<T = unknown>(opts: RunViaEngine1Options): Promise<Engine1Result<T>> {
  const { type, priority, key, actor, payload, resources } = opts;
  const waitMs = opts.waitMs ?? config.TASK_WAIT_TIMEOUT_MS;

  // 1. Submit task to Engine 1
  const submitRes = await postTaskToEngine1({
    type,
    priority,
    idempotency_key: key,
    actor,
    payload,
    resources
  });

  const taskId = submitRes.id;
  let taskDto: TaskDto;

  // If already terminal from the post call (e.g. key replay)
  if ('status' in submitRes && (submitRes.status === 'SUCCEEDED' || submitRes.status === 'FAILED')) {
    taskDto = submitRes as TaskDto;
  } else {
    // 2. Long-poll task status
    taskDto = await getTaskFromEngine1(taskId, waitMs);
  }

  // 3. Process outcomes
  if (taskDto.status === 'SUCCEEDED') {
    return {
      status: taskDto.http_status || 200,
      data: taskDto.result as T
    };
  }

  if (taskDto.status === 'FAILED') {
    if (taskDto.error) {
      if (taskDto.error.code === 'ENGINE3_UNAVAILABLE') {
        throw new DomainError('ENGINE3_UNAVAILABLE', taskDto.error.message || 'Engine 3 unavailable', {
          task_id: taskDto.id,
          ...(taskDto.error.details as Record<string, unknown>)
        });
      }
      throw new DomainError(
        taskDto.error.code as ErrorCode,
        taskDto.error.message,
        taskDto.error.details as Record<string, unknown>
      );
    }
    throw new DomainError('TASK_FAILED', 'Task execution failed', { task_id: taskDto.id });
  }

  // Still QUEUED or RUNNING after timeout
  return {
    status: 202,
    data: {
      task_id: taskDto.id,
      status: taskDto.status
    } as unknown as T
  };
}
