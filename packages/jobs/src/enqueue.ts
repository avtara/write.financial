// SPDX-License-Identifier: AGPL-3.0-only
import { SECRET_KEYS } from '@wf/crypto/redact';
import { DEFAULT_JOB_OPTIONS, JOBS, type JobId, type JobPayload, type JobQueue } from './queues.ts';

/** The part of a BullMQ `Queue` that enqueuing uses. */
export interface QueuePort {
  add(name: string, data: object, options: typeof DEFAULT_JOB_OPTIONS & { readonly jobId: string }): Promise<unknown>;
}

/** A payload key looks like a secret; the message names the keys, never the values. */
export class SecretPayloadError extends Error {
  override readonly name = 'SecretPayloadError';

  constructor(queue: JobQueue, paths: readonly string[]) {
    super(`Job payloads must not contain secrets (${queue}): ${paths.join(', ')}`);
  }
}

/** A payload does not match its queue's schema; the message names paths and rules, never values. */
export class InvalidPayloadError extends Error {
  override readonly name = 'InvalidPayloadError';
}

const SECRET = new Set(SECRET_KEYS.map((key) => key.toLowerCase()));
const ENCRYPTED_COLUMN = /(?:_enc|Enc)$/;

/**
 * Paths of keys, at any depth, that name a secret (the log-redaction keys of `@wf/crypto/redact`, compared
 * case-insensitively) or an encrypted column (`…_enc`, `…Enc`).
 */
export function findSecretKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => findSecretKeys(item, `${path}[${index}]`));
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) => {
    const keyPath = path === '' ? key : `${path}.${key}`;
    const own = SECRET.has(key.toLowerCase()) || ENCRYPTED_COLUMN.test(key) ? [keyPath] : [];
    return [...own, ...findSecretKeys(item, keyPath)];
  });
}

/** Adds one job; a job with the same id that still exists (waiting, active, or kept after completion) is not added again. */
export type Enqueue = <Q extends JobQueue>(
  queue: Q,
  payload: JobPayload<Q>,
  options: { readonly jobId: JobId<Q> },
) => Promise<void>;

/**
 * `enqueue(queue, payload, { jobId })` over the queues `queueFor` returns. Rejects payloads with secret-looking keys
 * before validating them against the queue's schema, and always applies {@link DEFAULT_JOB_OPTIONS}.
 */
export function createEnqueue(queueFor: (queue: JobQueue) => QueuePort): Enqueue {
  return async (queue, payload, { jobId }) => {
    const secrets = findSecretKeys(payload);
    if (secrets.length > 0) throw new SecretPayloadError(queue, secrets);
    const parsed = JOBS[queue].safeParse(payload);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(payload)'}: ${issue.message}`);
      throw new InvalidPayloadError(`Invalid ${queue} payload: ${issues.join('; ')}`);
    }
    await queueFor(queue).add(queue, parsed.data, { ...DEFAULT_JOB_OPTIONS, jobId });
  };
}
