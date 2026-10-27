// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { gmailPush } from '../../server/gmail-webhooks.ts';
import { Route } from './gmail.push.ts';
vi.mock('../../server/gmail-webhooks.ts', () => ({ gmailPush: vi.fn() }));
describe('/api/gmail/push', () => {
  it('registers authenticated mailbox ingress only for POST', () => {
    expect(Route.options.server?.handlers).toEqual({ POST: gmailPush });
  });
});
