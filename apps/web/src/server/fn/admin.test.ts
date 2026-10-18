// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fakeSession, SETTINGS } from '../../../test/fixtures.ts';
import { call, requestContext } from '../../../test/server-fn.ts';
import { getInstance, inviteUser, saveInstance, sendInstanceTestEmail } from './admin.ts';

interface Fake {
  settings: unknown;
  updateSetup: Mock;
  sendWith: Mock;
  invite: Mock;
}

const fake = vi.hoisted((): Fake => ({
  settings: undefined,
  updateSetup: vi.fn(() => Promise.resolve({})),
  sendWith: vi.fn(() => Promise.resolve()),
  invite: vi.fn(() =>
    Promise.resolve({ url: 'https://uang.example/sign-up?invitation=t', expiresAt: new Date(0), emailed: false }),
  ),
}));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () =>
    Promise.resolve({
      config: { publicUrl: 'https://env.example/' },
      instance: {
        get: () => Promise.resolve(fake.settings),
        updateSetup: fake.updateSetup,
        smtpPassword: () => Promise.resolve('stored'),
      },
      sendWith: fake.sendWith,
      invite: fake.invite,
      now: () => new Date('2026-10-18T09:00:00Z'),
    }),
}));

const SMTP = { host: 'smtp.example.test', port: 587, secure: false, username: 'u', from: 'u@example.test' };
const INSTANCE = {
  instanceName: 'Rumah',
  publicUrl: 'https://uang.example/',
  defaultLocale: 'en',
  defaultTimezone: 'UTC',
  registrationMode: 'invite',
  smtp: SMTP,
};
const admin = (ageMinutes = 1) => requestContext(fakeSession({ role: 'admin', ageMinutes }));

beforeEach(() => {
  vi.clearAllMocks();
  fake.settings = { ...SETTINGS, smtp: { ...SMTP, hasPassword: true } };
});

describe('getInstance', () => {
  it('gives admins the settings without the SMTP password, with the configured URL as fallback', async () => {
    expect(await call(getInstance, { context: admin(60) })).toEqual({
      ok: true,
      value: {
        instanceName: 'Keuangan Keluarga',
        publicUrl: 'https://env.example/',
        defaultLocale: 'id',
        defaultTimezone: 'Asia/Jakarta',
        registrationMode: 'closed',
        smtp: { ...SMTP, hasPassword: true },
      },
    });
    fake.settings = { ...SETTINGS, publicUrl: 'https://saved.example/' };
    expect(await call(getInstance, { context: admin() })).toMatchObject({
      value: { publicUrl: 'https://saved.example/' },
    });
    expect(await call(getInstance, { context: requestContext(fakeSession()) })).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
  });
});

describe('admin actions', () => {
  it('save settings, send test email with the stored password, and invite, as the session admin', async () => {
    expect(await call(saveInstance, { context: admin(), data: INSTANCE })).toEqual({ ok: true, value: null });
    expect(fake.updateSetup).toHaveBeenCalledWith(fakeSession().user.id, INSTANCE);
    expect(await call(sendInstanceTestEmail, { context: admin(), data: SMTP })).toEqual({ ok: true, value: null });
    expect(fake.sendWith).toHaveBeenCalledWith(
      { ...SMTP, password: 'stored' },
      expect.objectContaining({ template: { kind: 'smtp_test', url: 'https://env.example/' } }),
    );
    fake.settings = { ...SETTINGS, publicUrl: 'https://saved.example/' };
    await call(sendInstanceTestEmail, { context: admin(), data: SMTP });
    expect(fake.sendWith).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ template: { kind: 'smtp_test', url: 'https://saved.example/' } }),
    );
    const invited = await call(inviteUser, { context: admin(), data: { email: 'budi@example.test' } });
    expect(invited).toMatchObject({ ok: true, value: { emailed: false } });
    expect(fake.invite).toHaveBeenCalledWith(
      { userId: fakeSession().user.id, name: 'Avtara K.' },
      { email: 'budi@example.test' },
    );
    await call(inviteUser, { context: admin(), data: { email: 'budi@example.test', locale: 'en' } });
    expect(fake.invite).toHaveBeenLastCalledWith(expect.anything(), { email: 'budi@example.test', locale: 'en' });
  });

  it('need a fresh admin session', async () => {
    for (const [fn, data] of [
      [saveInstance, INSTANCE],
      [sendInstanceTestEmail, SMTP],
      [inviteUser, { email: 'budi@example.test' }],
    ] as const) {
      expect(await call(fn, { context: admin(20), data })).toEqual({ ok: false, code: 'REAUTHENTICATION_REQUIRED' });
      expect(await call(fn, { context: requestContext(fakeSession()), data })).toEqual({
        ok: false,
        code: 'FORBIDDEN',
      });
    }
    expect(fake.updateSetup).not.toHaveBeenCalled();
    expect(fake.invite).not.toHaveBeenCalled();
  });
});
