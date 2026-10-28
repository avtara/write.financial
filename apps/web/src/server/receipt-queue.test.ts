// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { InvalidPayloadError } from '@wf/jobs/enqueue';
import { createReceiptQueue } from './receipt-queue.ts';
const transport = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('bullmq', () => ({
  Queue: class {
    add = transport.add;
  },
}));
describe('receipt queue boundary', () => {
  it('rejects non-identifiers before connecting to Redis or storing user input in jobs', async () => {
    const queue = createReceiptQueue({ redis: 'redis://127.0.0.1:1', logger: { error: vi.fn() } });
    await expect(queue.enqueue('private-user-name', 'private-receipt-text')).rejects.toBeInstanceOf(
      InvalidPayloadError,
    );
  });
  it('does not swallow a publisher failure and retries a receipt using the same identifier-only job', async () => {
    transport.add.mockReset().mockRejectedValueOnce(new Error('Valkey unavailable')).mockResolvedValue(undefined);
    const queue = createReceiptQueue({ redis: 'redis://127.0.0.1:1', logger: { error: vi.fn() } });
    const userId = '00000000-0000-4000-8000-000000000001';
    const receiptId = '00000000-0000-4000-8000-000000000002';
    await expect(queue.enqueue(userId, receiptId)).rejects.toThrow('Valkey unavailable');
    await queue.enqueue(userId, receiptId);
    const [first, second] = transport.add.mock.calls;
    expect(second).toEqual(first);
    expect(first?.[0]).toBe('ocr');
    expect(first?.[1]).toEqual({ userId, receiptId });
    expect(first?.[2]).toMatchObject({ jobId: expect.stringContaining(receiptId) as unknown });
  });
});
