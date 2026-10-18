// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { handleQueueBoard } from '../../server/queue-route.ts';
import { Route as Splat } from './queues.$.ts';
import { Route as Entry } from './queues.ts';

vi.mock('../../server/queue-route.ts', () => ({ handleQueueBoard: vi.fn() }));

describe('/admin/queues', () => {
  it('serves the entry page and everything below it with the queue board handler, GET only', () => {
    for (const route of [Entry, Splat]) {
      expect(route.options.server?.handlers).toEqual({ GET: handleQueueBoard });
    }
  });
});
