// SPDX-License-Identifier: AGPL-3.0-only
import { InvalidPayloadError } from '@wf/jobs/enqueue';
import { describe, expect, it, vi } from 'vitest';
import { createGmailQueue } from './gmail-queue.ts';
const transport = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('bullmq', () => ({
  Queue: class {
    add = transport.add;
  },
}));
describe('Gmail queue boundary', () => {
  it('rejects non-tenant identifiers before queueing email or credential material', async () => {
    const queue = createGmailQueue({ redis: 'redis://127.0.0.1:1', logger: { error: vi.fn() } });
    await expect(queue.enqueue('mailbox@example.test', 'push123')).rejects.toBeInstanceOf(InvalidPayloadError);
  });
  it('propagates a publisher outage and permits the same trigger to be retried with its stable private ID', async () => {
    transport.add.mockReset().mockRejectedValueOnce(new Error('Valkey unavailable')).mockResolvedValue(undefined);
    const queue = createGmailQueue({ redis: 'redis://127.0.0.1:1', logger: { error: vi.fn() } });
    const userId = '00000000-0000-4000-8000-000000000001';
    await expect(queue.enqueue(userId, 'push123')).rejects.toThrow('Valkey unavailable');
    await queue.enqueue(userId, 'push123');
    const [first, second] = transport.add.mock.calls;
    expect(second).toEqual(first);
    expect(first?.[0]).toBe('gmail');
    expect(first?.[1]).toEqual({ userId });
    expect(first?.[2]).toMatchObject({ jobId: expect.stringContaining(userId) as unknown });
  });
});
