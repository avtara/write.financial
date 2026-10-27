// SPDX-License-Identifier: AGPL-3.0-only
import { InvalidPayloadError } from '@wf/jobs/enqueue';
import { describe, expect, it, vi } from 'vitest';
import { createGmailQueue } from './gmail-queue.ts';
describe('Gmail queue boundary', () => {
  it('rejects non-tenant identifiers before queueing email or credential material', async () => {
    const queue = createGmailQueue({ redis: 'redis://127.0.0.1:1', logger: { error: vi.fn() } });
    await expect(queue.enqueue('mailbox@example.test', 'push123')).rejects.toBeInstanceOf(InvalidPayloadError);
  });
});
