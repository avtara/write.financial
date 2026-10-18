// SPDX-License-Identifier: AGPL-3.0-only
import type { WfAuth } from '@wf/auth/auth';
import { ReauthenticationRequiredError, UnauthenticatedError } from '@wf/auth/session';
import { describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../test/fixtures.ts';
import { FRESH_SESSION_PATHS, handleAuthRequest } from './auth-handler.ts';

function auth(fresh: () => Promise<unknown>) {
  return {
    basePath: '/api/auth',
    handler: vi.fn(() => Promise.resolve(new Response('better-auth'))),
    requireFreshSession: vi.fn(fresh) as unknown as WfAuth['requireFreshSession'],
  };
}

const post = (path: string) => new Request(`https://uang.example/api/auth${path}`, { method: 'POST' });

describe('handleAuthRequest', () => {
  it('passes other endpoints straight to Better Auth', async () => {
    const a = auth(() => Promise.reject(new Error('not called')));
    const response = await handleAuthRequest(a, post('/sign-in/email'));
    expect(await response.text()).toBe('better-auth');
    expect(a.requireFreshSession).not.toHaveBeenCalled();
  });

  it('lets fresh sessions change their protection', async () => {
    for (const path of FRESH_SESSION_PATHS) {
      const a = auth(() => Promise.resolve(fakeSession()));
      expect(await (await handleAuthRequest(a, post(path))).text()).toBe('better-auth');
    }
  });

  it('asks stale sessions to sign in again, and signed-out requests to sign in', async () => {
    const stale = await handleAuthRequest(
      auth(() => Promise.reject(new ReauthenticationRequiredError())),
      post('/two-factor/enable'),
    );
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ code: 'REAUTHENTICATION_REQUIRED' });
    const anonymous = await handleAuthRequest(
      auth(() => Promise.reject(new UnauthenticatedError())),
      post('/change-password'),
    );
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('never lets an admin turn two-step verification off', async () => {
    const admin = auth(() => Promise.resolve(fakeSession({ role: 'admin' })));
    const response = await handleAuthRequest(admin, post('/two-factor/disable'));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'ADMIN_TWO_FACTOR_REQUIRED' });
    expect(admin.handler).not.toHaveBeenCalled();
    const user = auth(() => Promise.resolve(fakeSession()));
    expect(await (await handleAuthRequest(user, post('/two-factor/disable'))).text()).toBe('better-auth');
  });

  it('rethrows unexpected failures', async () => {
    await expect(
      handleAuthRequest(
        auth(() => Promise.reject(new Error('db down'))),
        post('/change-password'),
      ),
    ).rejects.toThrow('db down');
  });
});
