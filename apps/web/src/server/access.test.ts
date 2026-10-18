// SPDX-License-Identifier: AGPL-3.0-only
import type { AuthSession } from '@wf/auth/auth';
import { ReauthenticationRequiredError, TwoFactorRequiredError, UnauthenticatedError } from '@wf/auth/session';
import { describe, expect, it } from 'vitest';
import { fakeSession, NOW } from '../../test/fixtures.ts';
import { attempt, EXPECTED_CODES, ForbiddenError, ok, requireSession } from './access.ts';
import { MailFailedError } from './setup.ts';

const as = (session: AuthSession | null) => () => Promise.resolve(session);

describe('requireSession', () => {
  it('needs a session', async () => {
    await expect(requireSession(as(null), {}, NOW)).rejects.toBeInstanceOf(UnauthenticatedError);
    const session = fakeSession({ twoFactorEnabled: false, ageMinutes: 60 });
    await expect(requireSession(as(session), {}, NOW)).resolves.toBe(session);
  });

  it('checks admin, two-step verification, and freshness on request', async () => {
    await expect(requireSession(as(fakeSession()), { admin: true }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      requireSession(as(fakeSession({ role: 'admin', twoFactorEnabled: false })), { admin: true }, NOW),
    ).rejects.toBeInstanceOf(TwoFactorRequiredError);
    await expect(
      requireSession(as(fakeSession({ twoFactorEnabled: false })), { twoFactor: true }, NOW),
    ).rejects.toBeInstanceOf(TwoFactorRequiredError);
    await expect(
      requireSession(as(fakeSession({ role: 'admin', ageMinutes: 16 })), { admin: true, fresh: true }, NOW),
    ).rejects.toBeInstanceOf(ReauthenticationRequiredError);
    const admin = fakeSession({ role: 'admin', ageMinutes: 15 });
    await expect(requireSession(as(admin), { admin: true, fresh: true }, NOW)).resolves.toBe(admin);
  });
});

describe('attempt', () => {
  it('wraps the value', async () => {
    expect(await attempt(() => Promise.resolve(42))).toEqual(ok(42));
  });

  it('turns expected typed errors into codes, with a detail when there is one', async () => {
    expect(await attempt(() => Promise.reject(new ForbiddenError()))).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await attempt(() => Promise.reject(new MailFailedError(new Error('535 auth failed'))))).toEqual({
      ok: false,
      code: 'MAIL_FAILED',
      detail: '535 auth failed',
    });
    expect(EXPECTED_CODES).toContain('REAUTHENTICATION_REQUIRED');
  });

  it('rethrows everything else, including errors with unexpected codes', async () => {
    const postgres = Object.assign(new Error('duplicate key'), { code: '23505' });
    await expect(attempt(() => Promise.reject(postgres))).rejects.toBe(postgres);
    await expect(attempt(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(attempt(() => Promise.reject(Object.assign(new Error('x'), { code: 7 })))).rejects.toThrow('x');
  });
});
