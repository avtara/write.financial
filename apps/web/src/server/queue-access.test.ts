// SPDX-License-Identifier: AGPL-3.0-only
import type { AuthSession } from '@wf/auth/auth';
import { describe, expect, it, vi } from 'vitest';
import { fakeSession, NOW } from '../../test/fixtures.ts';
import { boardAccess, serveQueueBoard, type ServeBoardDeps } from './queue-access.ts';

describe('boardAccess', () => {
  it('admits admins with 2FA and a fresh session only', () => {
    expect(boardAccess(null, NOW)).toBe('sign-in');
    expect(boardAccess(fakeSession(), NOW)).toBe('forbidden');
    expect(boardAccess(fakeSession({ role: 'admin', twoFactorEnabled: false }), NOW)).toBe('forbidden');
    expect(boardAccess(fakeSession({ role: 'admin', ageMinutes: 30 }), NOW)).toBe('reauthenticate');
    expect(boardAccess(fakeSession({ role: 'admin' }), NOW)).toBe('allowed');
  });

  it('rethrows what is not a freshness failure', () => {
    const broken = fakeSession({ role: 'admin' });
    Object.defineProperty(broken.session, 'createdAt', {
      get: () => {
        throw new Error('broken');
      },
    });
    expect(() => boardAccess(broken, NOW)).toThrow('broken');
  });
});

describe('serveQueueBoard', () => {
  const request = new Request('https://uang.example/admin/queues');
  const deps = (session: AuthSession | null): ServeBoardDeps => ({
    session: () => Promise.resolve(session),
    board: () => ({ handle: vi.fn((_request: Request, nonce: string) => Promise.resolve(new Response(nonce))) }),
    now: () => NOW,
    nonce: 'n0nce',
    locale: 'id',
  });

  it('hands admins to the board with the request nonce', async () => {
    expect(await (await serveQueueBoard(request, deps(fakeSession({ role: 'admin' })))).text()).toBe('n0nce');
  });

  it('sends signed-out visitors to sign in', async () => {
    const response = await serveQueueBoard(request, deps(null));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://uang.example/sign-in?redirect=%2Fadmin%2Fqueues');
  });

  it('refuses everyone else with a plain 403 page, offering re-authentication when that is all that is missing', async () => {
    const user = await serveQueueBoard(request, deps(fakeSession()));
    expect(user.status).toBe(403);
    const page = await user.text();
    expect(page).toContain('<html lang="id">');
    expect(page).toContain('Tidak punya akses');
    expect(page).not.toMatch(/<script|<style|style=/);
    const stale = await serveQueueBoard(request, deps(fakeSession({ role: 'admin', ageMinutes: 20 })));
    expect(stale.status).toBe(403);
    expect(await stale.text()).toContain('href="/sign-in?redirect=%2Fadmin%2Fqueues&#38;reauth=1"');
  });
});
