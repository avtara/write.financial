// SPDX-License-Identifier: AGPL-3.0-only
import { sha256Hex } from '@wf/crypto/hash';
import type { RegistrationMode } from '@wf/db/instance-settings';
import { MailNotConfiguredError, type MailMessage, type Mailer } from '@wf/integrations/mailer';
import { describe, expect, it, vi } from 'vitest';
import { createInviter, INVITATION_TTL_MS, InvitationsDisabledError } from './invitations.ts';

const NOW = new Date('2026-10-18T03:00:00Z');
const ADMIN = { userId: '0192f0c1-7c1e-7000-8000-00000000000a', name: 'Sari' };

function setup(mode: RegistrationMode, send: (message: MailMessage) => Promise<void> = () => Promise.resolve()) {
  const create = vi.fn(() => Promise.resolve({ id: 'invitation-id' }));
  const sent: MailMessage[] = [];
  const mailer: Mailer = {
    configured: true,
    send: (message) => {
      sent.push(message);
      return send(message);
    },
    close: () => undefined,
  };
  const invite = createInviter({
    invitations: { create },
    settings: () =>
      Promise.resolve({
        registrationMode: mode,
        instanceName: 'Keuangan Keluarga',
        defaultLocale: 'id',
        defaultTimezone: 'Asia/Makassar',
      }),
    mailer,
    publicUrl: 'https://uang.example/finance',
    now: () => NOW,
  });
  return { invite, create, sent };
}

describe('createInviter', () => {
  it('stores only the token hash and emails the sign-up link in the instance language', async () => {
    const { invite, create, sent } = setup('invite');
    const invitation = await invite(ADMIN, { email: 'budi@example.test' });
    const token = new URL(invitation.url).searchParams.get('invitation') ?? '';
    expect(invitation.url).toBe(`https://uang.example/finance/sign-up?invitation=${token}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invitation).toMatchObject({ emailed: true, expiresAt: new Date(NOW.getTime() + INVITATION_TTL_MS) });
    expect(create).toHaveBeenCalledWith(ADMIN.userId, {
      email: 'budi@example.test',
      tokenHash: sha256Hex(token),
      expiresAt: invitation.expiresAt,
    });
    expect(sent).toEqual([
      {
        to: 'budi@example.test',
        template: {
          kind: 'invitation',
          url: invitation.url,
          inviterName: 'Sari',
          expiresAt: invitation.expiresAt,
          timeZone: 'Asia/Makassar',
        },
        context: { locale: 'id', instanceName: 'Keuangan Keluarga', recipientName: null },
      },
    ]);
  });

  it('writes the email in the requested language and uses a new token every time', async () => {
    const { invite, sent } = setup('invite');
    const first = await invite(ADMIN, { email: 'a@example.test', locale: 'en' });
    const second = await invite(ADMIN, { email: 'a@example.test' });
    expect(first.url).not.toBe(second.url);
    expect(sent[0]?.context.locale).toBe('en');
  });

  it('still returns the link when SMTP is not configured', async () => {
    const { invite } = setup('invite', () => Promise.reject(new MailNotConfiguredError()));
    expect(await invite(ADMIN, { email: 'a@example.test' })).toMatchObject({ emailed: false });
  });

  it('passes other delivery failures on', async () => {
    const { invite } = setup('invite', () => Promise.reject(new Error('SMTP 421')));
    await expect(invite(ADMIN, { email: 'a@example.test' })).rejects.toThrow('SMTP 421');
  });

  it.each(['closed', 'open'] as const)('refuses to invite when registration is %s', async (mode) => {
    const { invite, create } = setup(mode);
    await expect(invite(ADMIN, { email: 'a@example.test' })).rejects.toBeInstanceOf(InvitationsDisabledError);
    expect(create).not.toHaveBeenCalled();
    expect(new InvitationsDisabledError().code).toBe('INVITATIONS_DISABLED');
  });
});
