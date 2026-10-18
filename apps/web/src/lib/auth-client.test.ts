// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthActions, toFailure } from './auth-client.ts';

const BASE = 'http://wf.test/api/auth';

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** A `fetch` that records every request and answers with `reply(path)` as Better Auth would (JSON, status). */
function fakeFetch(reply: (path: string) => { status?: number; body: unknown }) {
  const requests: Recorded[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const path = url.pathname.replace('/api/auth', '');
    const raw = init?.body;
    requests.push({
      method: init?.method ?? 'GET',
      path,
      body: typeof raw === 'string' ? (JSON.parse(raw) as unknown) : undefined,
    });
    const { status = 200, body } = reply(path);
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    );
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests };
}

function actionsAnswering(reply: (path: string) => { status?: number; body: unknown }) {
  const { fetch, requests } = fakeFetch(reply);
  return { actions: createAuthActions({ baseURL: BASE, fetch }), requests };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toFailure', () => {
  it('keeps the code, attempts left, and lock time of a refusal', () => {
    expect(
      toFailure({ status: 401, code: 'INVALID_PASSWORD', remainingAttempts: 3, lockedUntil: '2026-10-18T09:15:00Z' }),
    ).toEqual({
      status: 401,
      code: 'INVALID_PASSWORD',
      remainingAttempts: 3,
      lockedUntil: new Date('2026-10-18T09:15:00Z'),
    });
  });

  it('ignores extras of the wrong type', () => {
    expect(toFailure({ status: 400, code: 'INVALID_CODE', remainingAttempts: '3', lockedUntil: 5 })).toEqual({
      status: 400,
      code: 'INVALID_CODE',
    });
  });

  it('names a 429 without a code RATE_LIMITED, no answer NETWORK, anything else UNKNOWN', () => {
    expect(toFailure({ status: 429 })).toEqual({ status: 429, code: 'RATE_LIMITED' });
    expect(toFailure({ status: 429, code: '' })).toEqual({ status: 429, code: 'RATE_LIMITED' });
    expect(toFailure({})).toEqual({ status: 0, code: 'NETWORK' });
    expect(toFailure({ status: 500, code: 42 })).toEqual({ status: 500, code: 'UNKNOWN' });
    expect(toFailure({ status: 429, code: 'ACCOUNT_LOCKED' })).toEqual({ status: 429, code: 'ACCOUNT_LOCKED' });
  });
});

describe('createAuthActions', () => {
  it('posts each action to its Better Auth endpoint and maps the answers', async () => {
    const { actions, requests } = actionsAnswering((path) => {
      if (path === '/sign-in/email') return { body: { twoFactorRedirect: true } };
      if (path === '/two-factor/enable') return { body: { totpURI: 'otpauth://totp/x', backupCodes: ['a', 'b'] } };
      if (path === '/two-factor/generate-backup-codes') return { body: { backupCodes: ['c'] } };
      return { body: { status: true } };
    });

    expect(await actions.signInEmail({ email: 'a@b.test', password: 'pw', rememberMe: true })).toEqual({
      ok: true,
      value: { twoFactor: true },
    });
    expect(
      await actions.signUpEmail({ name: 'A', email: 'a@b.test', password: 'pw', locale: 'en', invitationToken: 'inv' }),
    ).toEqual({ ok: true, value: null });
    await actions.signUpEmail({ name: 'B', email: 'b@b.test', password: 'pw', locale: 'id', invitationToken: null });
    await actions.requestPasswordReset('a@b.test');
    await actions.resetPassword({ token: 't', newPassword: 'new' });
    await actions.verifyTotp({ code: '123456', trustDevice: true });
    await actions.verifyBackupCode({ code: 'abcde-12345', trustDevice: false });
    await actions.signOut();
    expect(await actions.enableTwoFactor('pw')).toEqual({
      ok: true,
      value: { totpURI: 'otpauth://totp/x', backupCodes: ['a', 'b'] },
    });
    await actions.disableTwoFactor(null);
    expect(await actions.generateBackupCodes('pw')).toEqual({ ok: true, value: { backupCodes: ['c'] } });
    await actions.deletePasskey('pk-1');
    await actions.changePassword({ currentPassword: 'old', newPassword: 'new', revokeOtherSessions: true });

    expect(requests).toEqual([
      { method: 'POST', path: '/sign-in/email', body: { email: 'a@b.test', password: 'pw', rememberMe: true } },
      {
        method: 'POST',
        path: '/sign-up/email',
        body: { name: 'A', email: 'a@b.test', password: 'pw', locale: 'en', invitationToken: 'inv' },
      },
      { method: 'POST', path: '/sign-up/email', body: { name: 'B', email: 'b@b.test', password: 'pw', locale: 'id' } },
      {
        method: 'POST',
        path: '/request-password-reset',
        body: { email: 'a@b.test', redirectTo: '/reset-password' },
      },
      { method: 'POST', path: '/reset-password', body: { token: 't', newPassword: 'new' } },
      { method: 'POST', path: '/two-factor/verify-totp', body: { code: '123456', trustDevice: true } },
      { method: 'POST', path: '/two-factor/verify-backup-code', body: { code: 'abcde-12345', trustDevice: false } },
      { method: 'POST', path: '/sign-out', body: {} },
      { method: 'POST', path: '/two-factor/enable', body: { password: 'pw' } },
      { method: 'POST', path: '/two-factor/disable', body: {} },
      { method: 'POST', path: '/two-factor/generate-backup-codes', body: { password: 'pw' } },
      { method: 'POST', path: '/passkey/delete-passkey', body: { id: 'pk-1' } },
      {
        method: 'POST',
        path: '/change-password',
        body: { currentPassword: 'old', newPassword: 'new', revokeOtherSessions: true },
      },
    ]);
  });

  it('signs in without a second step when Better Auth does not ask for one', async () => {
    const { actions } = actionsAnswering(() => ({ body: { token: 't', user: {} } }));
    expect(await actions.signInEmail({ email: 'a@b.test', password: 'pw', rememberMe: false })).toEqual({
      ok: true,
      value: { twoFactor: false },
    });
  });

  it('leaves for Google when Better Auth answers with its URL', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    const { actions, requests } = actionsAnswering(() => ({
      body: { url: 'https://accounts.google.test/o', redirect: true },
    }));
    expect(await actions.signInGoogle('/settings')).toEqual({ ok: true, value: null });
    expect(requests).toEqual([
      { method: 'POST', path: '/sign-in/social', body: { provider: 'google', callbackURL: '/settings' } },
    ]);
    expect(assign).toHaveBeenCalledWith('https://accounts.google.test/o');
  });

  it('stays when the Google answer has no URL', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    const { actions } = actionsAnswering(() => ({ body: { redirect: false } }));
    expect(await actions.signInGoogle('/')).toEqual({ ok: true, value: null });
    expect(assign).not.toHaveBeenCalled();
  });

  it('turns refusals into failures with the code, attempts left, and lock time', async () => {
    const { actions } = actionsAnswering((path) =>
      path === '/sign-in/email'
        ? { status: 401, body: { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'x', remainingAttempts: 2 } }
        : { status: 423, body: { code: 'ACCOUNT_LOCKED', lockedUntil: '2026-10-18T09:15:00.000Z' } },
    );
    expect(await actions.signInEmail({ email: 'a@b.test', password: 'pw', rememberMe: true })).toEqual({
      ok: false,
      error: { status: 401, code: 'INVALID_EMAIL_OR_PASSWORD', remainingAttempts: 2 },
    });
    expect(await actions.verifyTotp({ code: '000000', trustDevice: false })).toEqual({
      ok: false,
      error: { status: 423, code: 'ACCOUNT_LOCKED', lockedUntil: new Date('2026-10-18T09:15:00.000Z') },
    });
  });

  it('names a bare 429 RATE_LIMITED', async () => {
    const { actions } = actionsAnswering(() => ({ status: 429, body: {} }));
    expect(await actions.requestPasswordReset('a@b.test')).toEqual({
      ok: false,
      error: { status: 429, code: 'RATE_LIMITED' },
    });
  });

  it('reports NETWORK when the request gets no answer', async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const actions = createAuthActions({ baseURL: BASE, fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await actions.signOut()).toEqual({ ok: false, error: { status: 0, code: 'NETWORK' } });
  });

  it('reports the refusal of the passkey options request', async () => {
    const { actions, requests } = actionsAnswering(() => ({ status: 401, body: { code: 'UNAUTHORIZED' } }));
    expect(await actions.signInPasskey()).toEqual({ ok: false, error: { status: 401, code: 'UNAUTHORIZED' } });
    expect(await actions.addPasskey('MacBook')).toEqual({ ok: false, error: { status: 401, code: 'UNAUTHORIZED' } });
    expect(requests.map(({ path }) => path)).toEqual([
      '/passkey/generate-authenticate-options',
      '/passkey/generate-register-options',
    ]);
  });

  it('uses the page origin and the global fetch by default', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })),
    );
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('window', { location: { origin: 'http://page.test', href: 'http://page.test/sign-in' } });
    const actions = createAuthActions();
    expect(await actions.signOut()).toEqual({ ok: true, value: null });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
