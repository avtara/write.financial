// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { serveSubscriptionLogo } from '../../server/logos.ts';
import { Route } from './subscription-logo.$id.ts';

vi.mock('../../server/logos.ts', () => ({ serveSubscriptionLogo: vi.fn() }));

describe('/api/subscription-logo/$id', () => {
  it('serves subscription logos, GET only', () => {
    expect(Route.options.server?.handlers).toEqual({ GET: serveSubscriptionLogo });
  });
});
