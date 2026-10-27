// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { gmailCallback } from '../../server/gmail-webhooks.ts';
import { Route } from './gmail.callback.ts';
vi.mock('../../server/gmail-webhooks.ts', () => ({ gmailCallback: vi.fn() }));
describe('/api/gmail/callback', () => {
  it('registers the state-bound OAuth callback only for GET', () => {
    expect(Route.options.server?.handlers).toEqual({ GET: gmailCallback });
  });
});
