// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../test/fixtures.ts';
import { requestContext } from '../../test/server-fn.ts';
import { handleQueueBoard } from './queue-route.ts';

const handle = vi.hoisted(() => vi.fn((_request: Request, nonce: string) => Promise.resolve(new Response(nonce))));

vi.mock('./runtime.ts', () => ({
  services: () =>
    Promise.resolve({
      queueBoard: () => ({ handle }),
      now: () => new Date('2026-10-18T09:00:00Z'),
    }),
}));

describe('handleQueueBoard', () => {
  it('serves the board to admins with the request nonce and session', async () => {
    const request = new Request('https://uang.example/admin/queues/api/queues');
    const response = await handleQueueBoard({ request, context: requestContext(fakeSession({ role: 'admin' })) });
    expect(await response.text()).toBe('test-nonce');
    expect(handle).toHaveBeenCalledWith(request, 'test-nonce');
  });

  it('refuses others, marking the page with the request language', async () => {
    const request = new Request('https://uang.example/admin/queues');
    const response = await handleQueueBoard({ request, context: requestContext(fakeSession(), 'en') });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('<html lang="en">');
  });
});
