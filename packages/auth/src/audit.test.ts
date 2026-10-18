// SPDX-License-Identifier: AGPL-3.0-only
import { hmacSha256Hex } from '@wf/crypto/hash';
import type { NewSecurityEvent } from '@wf/db/security-events';
import { MailNotConfiguredError, type MailMessage, type Mailer } from '@wf/integrations/mailer';
import { describe, expect, it, vi } from 'vitest';
import { createAudit, type AuditUser } from './audit.ts';
import { deviceFingerprint } from './device.ts';

const IP_KEY = new Uint8Array(32).fill(1);
const DEVICE_KEY = new Uint8Array(32).fill(2);
const NOW = new Date('2026-10-18T03:00:00Z');
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
const USER: AuditUser = {
  id: '0192f0c1-7c1e-7000-8000-00000000000a',
  email: 'budi@example.test',
  name: 'Budi',
  locale: 'en',
  timezone: 'Asia/Jakarta',
};
const request = { ip: '203.0.113.7', userAgent: FIREFOX };

function setup(history = { hasSignedIn: true, knownDevice: false }, send?: () => Promise<void>) {
  const appended: { userId: string; event: NewSecurityEvent }[] = [];
  const sent: MailMessage[] = [];
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const mailer: Mailer = {
    configured: true,
    send: (message) => {
      sent.push(message);
      return send === undefined ? Promise.resolve() : send();
    },
    close: () => undefined,
  };
  const signInHistory = vi.fn(() => Promise.resolve(history));
  const audit = createAudit({
    events: {
      append: (userId, event) => {
        appended.push({ userId, event });
        return Promise.resolve();
      },
      signInHistory,
    },
    mailer,
    logger,
    ipKey: IP_KEY,
    deviceKey: DEVICE_KEY,
    instanceName: () => Promise.resolve('Keuangan Keluarga'),
    securityUrl: 'https://uang.example/settings/security',
    now: () => NOW,
  });
  return { audit, appended, sent, logger, signInHistory };
}

describe('record', () => {
  it('stores a keyed hash of the IP, the user agent, and meta', async () => {
    const { audit, appended } = setup();
    await audit.record(USER.id, 'two_factor_enabled', request, { via: 'totp' });
    expect(appended).toEqual([
      {
        userId: USER.id,
        event: {
          type: 'two_factor_enabled',
          ipHash: hmacSha256Hex(IP_KEY, '203.0.113.7'),
          userAgent: FIREFOX,
          meta: { via: 'totp' },
        },
      },
    ]);
  });

  it('records requests without IP or user agent', async () => {
    const { audit, appended } = setup();
    await audit.record(USER.id, 'sign_out', { ip: null, userAgent: null });
    expect(appended[0]?.event).toEqual({ type: 'sign_out', ipHash: null, userAgent: null, meta: {} });
  });
});

describe('signIn', () => {
  const device = deviceFingerprint(DEVICE_KEY, FIREFOX, '203.0.113.7');

  it('records the sign-in and emails the user about a new device in their language and time zone', async () => {
    const { audit, appended, sent, signInHistory } = setup({ hasSignedIn: true, knownDevice: false });
    await audit.signIn(USER, request, 'password');
    expect(signInHistory).toHaveBeenCalledWith(USER.id, device);
    expect(appended[0]?.event).toMatchObject({
      type: 'sign_in',
      meta: { method: 'password', device, newDevice: true },
    });
    expect(sent).toEqual([
      {
        to: USER.email,
        template: {
          kind: 'new_device_sign_in',
          device: 'Firefox · Linux',
          at: NOW,
          timeZone: 'Asia/Jakarta',
          url: 'https://uang.example/settings/security',
        },
        context: { locale: 'en', instanceName: 'Keuangan Keluarga', recipientName: 'Budi' },
      },
    ]);
  });

  it('does not email for a known device or for the first sign-in of an account', async () => {
    for (const history of [
      { hasSignedIn: true, knownDevice: true },
      { hasSignedIn: false, knownDevice: false },
    ]) {
      const { audit, appended, sent } = setup(history);
      await audit.signIn(USER, request, 'passkey');
      expect(appended[0]?.event.meta).toMatchObject({ method: 'passkey', newDevice: false });
      expect(sent).toEqual([]);
    }
  });
});

describe('notify', () => {
  const message: MailMessage = {
    to: USER.email,
    template: { kind: 'verify_email', url: 'https://uang.example/verify' },
    context: { locale: 'id', instanceName: 'x', recipientName: 'Budi' },
  };

  it('logs instead of failing when SMTP is not configured', async () => {
    const { audit, logger } = setup(undefined, () => Promise.reject(new MailNotConfiguredError()));
    await audit.notify(message);
    expect(logger.info).toHaveBeenCalledWith({ email: 'verify_email' }, 'Email not sent: SMTP is not configured');
  });

  it('logs a delivery failure as an error', async () => {
    const failure = new Error('SMTP 554');
    const { audit, logger } = setup(undefined, () => Promise.reject(failure));
    await audit.notify(message);
    expect(logger.error).toHaveBeenCalledWith({ email: 'verify_email', err: failure }, 'Email could not be sent');
  });
});
