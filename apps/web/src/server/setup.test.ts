// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { fakeSession, SETTINGS } from '../../test/fixtures.ts';
import { ForbiddenError } from './access.ts';
import {
  adminInput,
  instanceInput,
  MailFailedError,
  requireStep,
  sendTestEmail,
  setupCookie,
  setupState,
  smtpInput,
  toSetupInput,
  tokenMatches,
  type SetupDeps,
} from './setup.ts';

const TOKEN = ['setup', 'token', 'for', 'unit', 'tests'].join('-');

function deps(overrides: Partial<SetupDeps> = {}): SetupDeps {
  return {
    token: TOKEN,
    publicUrl: 'https://uang.example/',
    hasAdmin: () => Promise.resolve(false),
    instance: () => Promise.resolve(SETTINGS),
    session: () => Promise.resolve(null),
    ...overrides,
  };
}

describe('tokenMatches', () => {
  it('needs a configured token and the same one presented', () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches(TOKEN, `${TOKEN}x`)).toBe(false);
    expect(tokenMatches(TOKEN, 'short')).toBe(false);
    expect(tokenMatches(TOKEN, '')).toBe(false);
    expect(tokenMatches(TOKEN, null)).toBe(false);
    expect(tokenMatches(TOKEN, undefined)).toBe(false);
    expect(tokenMatches(null, TOKEN)).toBe(false);
  });
});

describe('setupCookie', () => {
  it('is httpOnly, strict, site-wide, and Secure behind https', () => {
    expect(setupCookie('a b', false)).toBe('wf_setup=a%20b; Path=/; Max-Age=86400; HttpOnly; SameSite=Strict');
    expect(setupCookie('', true, 0)).toBe('wf_setup=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure');
  });
});

describe('setupState', () => {
  const draft = {
    instanceName: 'Keuangan Keluarga',
    publicUrl: 'https://uang.example/',
    defaultLocale: 'id',
    defaultTimezone: 'Asia/Jakarta',
    registrationMode: 'closed',
    smtp: null,
  };

  it('is closed without the right token or once setup is complete', async () => {
    expect(await setupState(deps(), 'wrong')).toEqual({ status: 'closed' });
    expect(await setupState(deps({ token: null }), TOKEN)).toEqual({ status: 'closed' });
    const done = deps({ instance: () => Promise.resolve({ ...SETTINGS, setupCompletedAt: new Date(0) }) });
    expect(await setupState(done, TOKEN)).toEqual({ status: 'closed' });
  });

  it('walks admin → sign-in → two-factor → instance', async () => {
    expect(await setupState(deps(), TOKEN)).toEqual({ status: 'open', step: 'admin', draft });
    const admin = deps({ hasAdmin: () => Promise.resolve(true) });
    expect(await setupState(admin, TOKEN)).toMatchObject({ step: 'sign-in' });
    const user = deps({ hasAdmin: () => Promise.resolve(true), session: () => Promise.resolve(fakeSession()) });
    expect(await setupState(user, TOKEN)).toMatchObject({ step: 'sign-in' });
    const enrolling = {
      ...admin,
      session: () => Promise.resolve(fakeSession({ role: 'admin', twoFactorEnabled: false })),
    };
    expect(await setupState(enrolling, TOKEN)).toMatchObject({ step: 'two-factor' });
    const ready = { ...admin, session: () => Promise.resolve(fakeSession({ role: 'admin' })) };
    expect(await setupState(ready, TOKEN)).toMatchObject({ step: 'instance' });
  });

  it('prefills the draft with the saved public URL when there is one', async () => {
    const saved = deps({ instance: () => Promise.resolve({ ...SETTINGS, publicUrl: 'https://saved.example/' }) });
    expect(await setupState(saved, TOKEN)).toMatchObject({ draft: { publicUrl: 'https://saved.example/' } });
  });
});

describe('requireStep', () => {
  it('passes only at the expected step', async () => {
    await expect(requireStep(deps(), TOKEN, 'admin')).resolves.toMatchObject({ step: 'admin' });
    await expect(requireStep(deps(), TOKEN, 'instance')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requireStep(deps(), undefined, 'admin')).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('input schemas', () => {
  const smtp = {
    host: 'smtp.example.test',
    port: 587,
    secure: false,
    username: null,
    from: 'Uang <uang@example.test>',
  };
  const instance = {
    instanceName: 'Rumah',
    publicUrl: 'https://uang.example/',
    defaultLocale: 'id',
    defaultTimezone: 'Asia/Jakarta',
    registrationMode: 'closed',
    smtp,
  };

  it('accept valid wizard input', () => {
    expect(adminInput.parse({ name: ' Sari ', email: 'sari@example.test', password: 'x', locale: 'en' })).toMatchObject(
      {
        name: 'Sari',
      },
    );
    expect(instanceInput.parse(instance)).toEqual(instance);
    expect(smtpInput.parse({ ...smtp, from: 'plain@example.test', password: null })).toMatchObject({ password: null });
  });

  it('reject bad hosts, senders, URLs, zones, and modes', () => {
    expect(smtpInput.safeParse({ ...smtp, host: 'smtp.example.test/x' }).success).toBe(false);
    expect(smtpInput.safeParse({ ...smtp, from: 'not an address' }).success).toBe(false);
    expect(instanceInput.safeParse({ ...instance, publicUrl: 'ftp://uang.example/' }).success).toBe(false);
    expect(instanceInput.safeParse({ ...instance, defaultTimezone: 'GMT+7' }).success).toBe(false);
    expect(instanceInput.safeParse({ ...instance, registrationMode: 'public' }).success).toBe(false);
  });
});

describe('toSetupInput', () => {
  const base = {
    instanceName: 'Rumah',
    publicUrl: 'https://uang.example/',
    defaultLocale: 'en',
    defaultTimezone: 'UTC',
    registrationMode: 'invite',
  } as const;
  const smtp = { host: 'smtp.example.test', port: 587, secure: false, username: 'u', from: 'u@example.test' };

  it('passes the SMTP password only when the form sent one', () => {
    expect(toSetupInput({ ...base, smtp: null })).toEqual({ ...base, smtp: null });
    expect(toSetupInput({ ...base, smtp })).toEqual({ ...base, smtp });
    expect(toSetupInput({ ...base, smtp: { ...smtp, password: 'new' } })).toEqual({
      ...base,
      smtp: { ...smtp, password: 'new' },
    });
    expect(toSetupInput({ ...base, smtp: { ...smtp, password: null } }).smtp).toEqual({ ...smtp, password: null });
  });
});

describe('sendTestEmail', () => {
  const smtp = { host: 'smtp.example.test', port: 587, secure: false, username: 'u', from: 'u@example.test' };
  const to = { email: 'sari@example.test', name: 'Sari', locale: 'en' } as const;
  const instance = { instanceName: 'Rumah', publicUrl: 'https://uang.example/' };

  it('sends the smtp_test email to the admin, with the stored password when none was entered', async () => {
    const send = vi.fn(() => Promise.resolve());
    await sendTestEmail({ send, storedPassword: () => Promise.resolve('stored') }, smtp, to, instance);
    expect(send).toHaveBeenCalledWith(
      { ...smtp, password: 'stored' },
      {
        to: 'sari@example.test',
        template: { kind: 'smtp_test', url: 'https://uang.example/' },
        context: { locale: 'en', instanceName: 'Rumah', recipientName: 'Sari' },
      },
    );
    await sendTestEmail(
      { send, storedPassword: () => Promise.resolve('stored') },
      { ...smtp, password: null },
      to,
      instance,
    );
    expect(send).toHaveBeenLastCalledWith({ ...smtp, password: null }, expect.anything());
  });

  it('reports SMTP failures with a redacted, short detail', async () => {
    const secret = ['sk', 'live', 'abcdefghijklmnopqrstuvwx'].join('_');
    const send = vi.fn(() => Promise.reject(new Error(`535 rejected ${secret} ${'x'.repeat(400)}`)));
    const error = await sendTestEmail({ send, storedPassword: () => Promise.resolve(null) }, smtp, to, instance).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(MailFailedError);
    const { detail } = error as MailFailedError;
    expect(detail.startsWith('535 rejected')).toBe(true);
    expect(detail).not.toContain(secret);
    expect(detail.length).toBeLessThanOrEqual(300);
    expect(new MailFailedError('plain').detail).toBe('plain');
  });
});
