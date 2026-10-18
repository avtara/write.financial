// SPDX-License-Identifier: AGPL-3.0-only
import { parseLocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { createEnqueue, findSecretKeys, InvalidPayloadError, SecretPayloadError, type QueuePort } from './enqueue.ts';
import { DEFAULT_JOB_OPTIONS, jobIds, type JobQueue } from './queues.ts';

/** In-memory queue that records what was added, per queue name. */
function fakeQueues() {
  const added: { queue: JobQueue; name: string; data: object; options: object }[] = [];
  const queueFor = (queue: JobQueue): QueuePort => ({
    add: async (name, data, options) => {
      added.push({ queue, name, data, options });
      return Promise.resolve();
    },
  });
  return { added, enqueue: createEnqueue(queueFor) };
}

const jobId = jobIds.maintenance(parseLocalDate('2026-10-18'));

describe('enqueue', () => {
  it('adds the validated payload under the deterministic id with the default options', async () => {
    const { added, enqueue } = fakeQueues();
    await enqueue('maintenance', {}, { jobId });
    expect(added).toEqual([
      {
        queue: 'maintenance',
        name: 'maintenance',
        data: {},
        options: { ...DEFAULT_JOB_OPTIONS, jobId: 'mt.2026-10-18' },
      },
    ]);
  });

  it('refuses queues without a processor at compile time', async () => {
    const { enqueue } = fakeQueues();
    // @ts-expect-error `fx` has no processor yet, so it is not a JobQueue
    await expect(enqueue('fx', {}, { jobId })).rejects.toThrow(TypeError);
  });

  it('rejects secret-looking keys before anything reaches the queue, naming keys but not values', async () => {
    const { added, enqueue } = fakeQueues();
    const payload = { apiKey: 'sentinel-value' } as unknown as Record<string, never>;
    const error = await enqueue('maintenance', payload, { jobId }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SecretPayloadError);
    expect(error).toMatchObject({
      name: 'SecretPayloadError',
      message: 'Job payloads must not contain secrets (maintenance): apiKey',
    });
    expect(String(error)).not.toContain('sentinel-value');
    expect(added).toEqual([]);
  });

  it('rejects a payload that does not match the schema', async () => {
    const { added, enqueue } = fakeQueues();
    const payload = { userId: 'sentinel-id' } as unknown as Record<string, never>;
    const error = await enqueue('maintenance', payload, { jobId }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InvalidPayloadError);
    expect(error).toMatchObject({ name: 'InvalidPayloadError' });
    expect(String(error)).toMatch(/^InvalidPayloadError: Invalid maintenance payload: \(payload\): .*userId/);
    expect(String(error)).not.toContain('sentinel-id');
    expect(added).toEqual([]);
  });

  it('rejects a payload that is not an object', async () => {
    const { enqueue } = fakeQueues();
    await expect(enqueue('maintenance', null as unknown as Record<string, never>, { jobId })).rejects.toThrow(
      /^Invalid maintenance payload: \(payload\): /,
    );
  });
});

describe('findSecretKeys', () => {
  it('finds secret and encrypted-column keys at any depth, case-insensitively, inside arrays', () => {
    expect(
      findSecretKeys({
        userId: 'u',
        TOKEN: 'x',
        nested: { refresh_token: 'x', ok: 1, deeper: [{ note_enc: 'x' }, { payloadEnc: 'x' }, 3] },
        list: ['password'],
        custom_enc: 'x',
        'X-Api-Key': 'x',
      }),
    ).toEqual([
      'TOKEN',
      'nested.refresh_token',
      'nested.deeper[0].note_enc',
      'nested.deeper[1].payloadEnc',
      'custom_enc',
      'X-Api-Key',
    ]);
  });

  it('reports a secret key and the secret keys nested under it', () => {
    expect(findSecretKeys({ credentials: { password: 'x' } })).toEqual(['credentials', 'credentials.password']);
  });

  it.each([null, undefined, 1, 'password', true])('finds nothing in the scalar %s', (value) => {
    expect(findSecretKeys(value)).toEqual([]);
  });

  it('leaves ID-only payloads alone', () => {
    expect(findSecretKeys({ userId: 'u', occurrenceId: 'o', date: '2026-10-18', encoding: 'x' })).toEqual([]);
  });
});
