// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { Route } from './healthz.ts';

describe('GET /healthz', () => {
  it('answers { status: "ok" } as JSON', async () => {
    const handlers = Route.options.server?.handlers;
    if (typeof handlers !== 'object' || typeof handlers.GET !== 'function') throw new Error('GET handler missing');
    const response = (await handlers.GET({} as never)) as Response;
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});
