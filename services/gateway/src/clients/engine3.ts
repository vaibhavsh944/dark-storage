import { DomainError, ErrorCode } from '@dark-storage/shared';
import { config } from '../config.js';

export interface Engine3RequestOptions {
  method?: string;
  path: string;
  body?: unknown;
  requestId?: string;
  actor?: { id: number | string; role: string; [key: string]: any } | null;
  idempotencyKey?: string;
  timeoutMs?: number;
}

export async function callEngine3<T>(opts: Engine3RequestOptions): Promise<{ status: number; data: T }> {
  const url = `${config.ENGINE3_URL}${opts.path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs ?? config.ENGINE3_COMMAND_TIMEOUT_MS);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-internal-token': config.INTERNAL_TOKEN,
    'x-request-id': opts.requestId || crypto.randomUUID()
  };

  if (opts.actor) {
    headers['x-actor-id'] = opts.actor.id.toString();
    headers['x-actor-role'] = opts.actor.role;
  }
  if (opts.idempotencyKey) {
    headers['x-idempotency-key'] = opts.idempotencyKey;
  }

  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const json = (await res.json().catch(() => null)) as any;

    if (!res.ok) {
      if (json && json.error && json.error.code) {
        throw new DomainError(json.error.code as ErrorCode, json.error.message, json.error.details);
      }
      throw new DomainError('ENGINE3_UNAVAILABLE', `Engine 3 returned HTTP ${res.status}`);
    }

    return { status: res.status, data: json as T };
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof DomainError) {
      throw err;
    }

    if (err instanceof Error && err.name === 'AbortError') {
      throw new DomainError('ENGINE3_UNAVAILABLE', 'Engine 3 request timed out');
    }

    throw new DomainError('ENGINE3_UNAVAILABLE', `Could not connect to Engine 3: ${String(err)}`);
  }
}
