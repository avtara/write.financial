// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession, NOW } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import type { Result } from '../access.ts';
import {
  getProfile,
  getSecurity,
  getSecurityHistory,
  listDevices,
  revokeDevice,
  revokeOtherDevices,
  saveLocale,
  updateProfile,
} from './account.ts';

const fake = vi.hoisted(() => {
  const at = new Date('2026-10-18T09:00:00Z');
  const profile = { name: 'Avtara K.', nickname: null, locale: 'id', timezone: 'Asia/Jakarta' };
  const headers = new Headers({ cookie: 'wf.session_token=abc' });
  return {
    at,
    headers,
    profiles: { get: vi.fn(() => Promise.resolve(profile)), update: vi.fn(() => Promise.resolve(profile)) },
    securityEvents: { list: vi.fn(() => Promise.resolve({ events: [], nextBefore: null })) },
    auth: {
      listDevices: vi.fn(() =>
        Promise.resolve([{ id: 's1', label: null, userAgent: null, createdAt: at, expiresAt: at, current: true }]),
      ),
      revokeDevice: vi.fn(() => Promise.resolve()),
      revokeOtherDevices: vi.fn(() => Promise.resolve(2)),
      api: {
        listPasskeys: vi.fn(() => Promise.resolve([{ id: 'pk', name: 'Mac', createdAt: at }])),
        listUserAccounts: vi.fn(() => Promise.resolve([{ providerId: 'credential' }])),
      },
    },
  };
});

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () =>
    Promise.resolve({
      profiles: fake.profiles,
      securityEvents: fake.securityEvents,
      auth: fake.auth,
      now: () => new Date('2026-10-18T09:00:00Z'),
    }),
}));

const USER_ID = fakeSession().user.id;
const signedIn = () => requestContext(fakeSession(), 'id', fake.headers);
const signedOut = () => requestContext(null);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('profile', () => {
  it('reads and updates the session user’s own profile', async () => {
    expect(await call<Result<unknown>>(getProfile, { context: signedIn() })).toMatchObject({ ok: true });
    expect(fake.profiles.get).toHaveBeenCalledWith(USER_ID);
    const data = { name: 'Avtara', nickname: 'Av', locale: 'en', timezone: 'Asia/Makassar' };
    expect(await call<Result<unknown>>(updateProfile, { context: signedIn(), data })).toMatchObject({ ok: true });
    expect(fake.profiles.update).toHaveBeenCalledWith(USER_ID, data);
    await call(saveLocale, { context: signedIn(), data: { locale: 'en' } });
    expect(fake.profiles.update).toHaveBeenLastCalledWith(USER_ID, { locale: 'en' });
  });

  it('refuses signed-out requests', async () => {
    for (const fn of [getProfile, updateProfile, saveLocale, getSecurity, listDevices, revokeOtherDevices]) {
      expect(await call(fn, { context: signedOut(), data: {} })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    }
    expect(await call(getSecurityHistory, { context: signedOut(), data: { before: 'x' } })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    expect(await call(revokeDevice, { context: signedOut(), data: { id: 'x' } })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    expect(fake.profiles.update).not.toHaveBeenCalled();
    expect(fake.auth.revokeDevice).not.toHaveBeenCalled();
  });

  it('validates input with Zod schemas', () => {
    const validator = validatorOf(updateProfile);
    expect(validator.safeParse({ name: 'A', nickname: null, locale: 'en', timezone: 'UTC' }).success).toBe(true);
    expect(validator.safeParse({ name: 'A', nickname: null, locale: 'fr', timezone: 'UTC' }).success).toBe(false);
  });
});

describe('security', () => {
  it('loads the overview with the request headers', async () => {
    const result = await call<Result<{ hasPassword: boolean; passkeys: unknown[] }>>(getSecurity, {
      context: signedIn(),
    });
    expect(result).toMatchObject({ ok: true, value: { hasPassword: true, passkeys: [{ id: 'pk' }] } });
    expect(fake.auth.listDevices).toHaveBeenCalledWith(fake.headers);
    expect(fake.auth.api.listPasskeys).toHaveBeenCalledWith({ headers: fake.headers });
    expect(fake.securityEvents.list).toHaveBeenCalledWith(USER_ID, { limit: 20 });
  });

  it('pages the history', async () => {
    const before = '0192a6c4-0000-7000-8000-0000000000e1';
    await call(getSecurityHistory, { context: signedIn(), data: { before } });
    expect(fake.securityEvents.list).toHaveBeenCalledWith(USER_ID, { limit: 20, before });
  });

  it('lists and signs out devices', async () => {
    expect(await call(listDevices, { context: signedIn() })).toEqual({
      ok: true,
      value: [{ id: 's1', label: null, createdAt: fake.at, expiresAt: fake.at, current: true }],
    });
    expect(await call(revokeDevice, { context: signedIn(), data: { id: 's1' } })).toEqual({ ok: true, value: null });
    expect(fake.auth.revokeDevice).toHaveBeenCalledWith(fake.headers, 's1');
    expect(await call(revokeOtherDevices, { context: signedIn() })).toEqual({ ok: true, value: { count: 2 } });
  });

  it('uses the fixed test clock', () => {
    expect(NOW.toISOString()).toBe('2026-10-18T09:00:00.000Z');
  });
});
