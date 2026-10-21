// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { serveAccountLogo } from '../../server/logos.ts';
import { Route } from './account-logo.$id.ts';

vi.mock('../../server/logos.ts', () => ({ serveAccountLogo: vi.fn() }));

describe('/api/account-logo/$id', () => {
  it('serves account logos, GET only', () => {
    expect(Route.options.server?.handlers).toEqual({ GET: serveAccountLogo });
  });
});
