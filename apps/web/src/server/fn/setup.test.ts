// SPDX-License-Identifier: AGPL-3.0-only
import type { AuthSession } from '@wf/auth/auth';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fakeSession, SETTINGS } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import { createSetupAdmin, getSetup, saveSetup, sendSetupTestEmail } from './setup.ts';

interface Fake {
  token: string;
  publicUrl: string;
  cookie: string | undefined;
  setCookies: string[];
  admin: boolean;
  settings: unknown;
  createFirstAdmin: Mock;
  updateSetup: Mock;
  sendWith: Mock;
}

const fake = vi.hoisted((): Fake => ({
  token: ['setup', 'token', 'for', 'unit', 'tests'].join('-'),
  publicUrl: 'https://uang.example/',
  cookie: undefined,
  setCookies: [],
  admin: false,
  settings: undefined,
  createFirstAdmin: vi.fn(() => Promise.resolve({ userId: 'u1' })),
  updateSetup: vi.fn(() => Promise.resolve({})),
  sendWith: vi.fn(() => Promise.resolve()),
}));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () =>
    Promise.resolve({
      config: { setup: { token: fake.token }, publicUrl: fake.publicUrl },
      hasAdmin: () => Promise.resolve(fake.admin),
      instance: {
        get: () => Promise.resolve(fake.settings),
        updateSetup: fake.updateSetup,
        smtpPassword: () => Promise.resolve(null),
      },
      auth: { createFirstAdmin: fake.createFirstAdmin },
      sendWith: fake.sendWith,
      now: () => new Date('2026-10-18T09:00:00Z'),
    }),
}));

const SMTP = { host: 'smtp.example.test', port: 587, secure: false, username: null, from: 'u@example.test' };
const INSTANCE = {
  instanceName: 'Rumah',
  publicUrl: 'https://uang.example/',
  defaultLocale: 'id',
  defaultTimezone: 'Asia/Jakarta',
  registrationMode: 'closed',
  smtp: null,
};
/** The request context with the token cookie (when set), recording the cookies the function sets. */
function ctx(session: AuthSession | null, locale: 'id' | 'en' = 'id') {
  const headers = new Headers(fake.cookie === undefined ? {} : { cookie: `wf_setup=${fake.cookie}` });
  const context = requestContext(session, locale, headers);
  return {
    ...context,
    setCookie: (cookie: string) => {
      fake.setCookies.push(cookie);
    },
  };
}
const admin = () => ctx(fakeSession({ role: 'admin' }), 'en');

beforeEach(() => {
  vi.clearAllMocks();
  fake.cookie = undefined;
  fake.setCookies = [];
  fake.admin = false;
  fake.settings = SETTINGS;
});

describe('getSetup', () => {
  it('stays closed without the token', async () => {
    expect(await call(getSetup, { context: ctx(null), data: {} })).toEqual({ status: 'closed' });
    expect(await call(getSetup, { context: ctx(null), data: { token: 'wrong' } })).toEqual({
      status: 'closed',
    });
    expect(fake.setCookies).toEqual([]);
  });

  it('moves a matching URL token into the httpOnly cookie', async () => {
    const state = await call(getSetup, { context: ctx(null), data: { token: fake.token } });
    expect(state).toMatchObject({ status: 'open', step: 'admin' });
    expect(fake.setCookies).toEqual([
      `wf_setup=${fake.token}; Path=/; Max-Age=86400; HttpOnly; SameSite=Strict; Secure`,
    ]);
  });

  it('continues from the cookie, and does not set it once setup is complete', async () => {
    fake.cookie = fake.token;
    expect(await call(getSetup, { context: ctx(null), data: {} })).toMatchObject({ step: 'admin' });
    fake.settings = { ...SETTINGS, setupCompletedAt: new Date(0) };
    expect(await call(getSetup, { context: ctx(null), data: { token: fake.token } })).toEqual({
      status: 'closed',
    });
    expect(fake.setCookies).toEqual([]);
  });
});

describe('createSetupAdmin', () => {
  const data = { name: 'Sari', email: 'sari@example.test', password: 'x'.repeat(12), locale: 'id' };

  it('creates the first admin with the cookie token', async () => {
    fake.cookie = fake.token;
    expect(await call(createSetupAdmin, { context: ctx(null), data })).toEqual({ ok: true, value: null });
    expect(fake.createFirstAdmin).toHaveBeenCalledWith(data);
  });

  it('refuses without the token or after the admin exists', async () => {
    expect(await call(createSetupAdmin, { context: ctx(null), data })).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    fake.cookie = fake.token;
    fake.admin = true;
    expect(await call(createSetupAdmin, { context: ctx(null), data })).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(fake.createFirstAdmin).not.toHaveBeenCalled();
  });

  it('validates input', () => {
    expect(validatorOf(createSetupAdmin).safeParse({ ...data, email: 'nope' }).success).toBe(false);
  });
});

describe('instance step', () => {
  beforeEach(() => {
    fake.cookie = fake.token;
    fake.admin = true;
  });

  it('sends the test email to the signed-in admin in their language', async () => {
    expect(await call(sendSetupTestEmail, { context: admin(), data: SMTP })).toEqual({ ok: true, value: null });
    expect(fake.sendWith).toHaveBeenCalledWith(
      { ...SMTP, password: null },
      expect.objectContaining({
        to: 'avtara@example.test',
        context: expect.objectContaining({ locale: 'en' }) as unknown,
      }) as unknown,
    );
  });

  it('saves the settings, which completes setup, and clears the token cookie', async () => {
    expect(await call(saveSetup, { context: admin(), data: INSTANCE })).toEqual({ ok: true, value: null });
    expect(fake.updateSetup).toHaveBeenCalledWith(fakeSession().user.id, INSTANCE);
    expect(fake.setCookies).toEqual(['wf_setup=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure']);
  });

  it('refuses before two-step verification is on, and without the token', async () => {
    const enrolling = ctx(fakeSession({ role: 'admin', twoFactorEnabled: false }));
    expect(await call(saveSetup, { context: enrolling, data: INSTANCE })).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await call(sendSetupTestEmail, { context: enrolling, data: SMTP })).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    fake.cookie = undefined;
    expect(await call(saveSetup, { context: admin(), data: INSTANCE })).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(fake.updateSetup).not.toHaveBeenCalled();
  });
});
