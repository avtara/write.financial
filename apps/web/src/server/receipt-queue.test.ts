// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { InvalidPayloadError } from '@wf/jobs/enqueue';
import { createReceiptQueue } from './receipt-queue.ts';
describe('receipt queue boundary', () => {
  it('rejects non-identifiers before connecting to Redis or storing user input in jobs', async () => {
    const queue = createReceiptQueue({ redis: 'redis://127.0.0.1:1', logger: { error: vi.fn() } });
    await expect(queue.enqueue('private-user-name', 'private-receipt-text')).rejects.toBeInstanceOf(
      InvalidPayloadError,
    );
  });
});
