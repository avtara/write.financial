// SPDX-License-Identifier: AGPL-3.0-only
import { LOCALES } from '@wf/i18n/locale';
import { describe, expect, it } from 'vitest';
import { InvalidEmailLinkError, renderEmail, type EmailContext, type EmailTemplate } from './mail-templates.ts';

const URL_ = 'https://wf.example/api/auth/reset-password/tok3n?callbackURL=%2Fforgot';
const id: EmailContext = { locale: 'id', instanceName: 'Keuangan Keluarga', recipientName: 'Budi' };
const en: EmailContext = { ...id, locale: 'en' };
const at = new Date('2026-10-14T20:05:00Z');

const TEMPLATES: readonly EmailTemplate[] = [
  { kind: 'verify_email', url: URL_ },
  { kind: 'password_reset', url: URL_, expiresInMinutes: 30 },
  { kind: 'set_password', url: URL_, expiresInMinutes: 30 },
  { kind: 'new_device_sign_in', url: URL_, device: 'Firefox on Linux', at, timeZone: 'Asia/Jakarta' },
  { kind: 'invitation', url: URL_, inviterName: 'Sari', expiresAt: at, timeZone: 'Asia/Jakarta' },
  { kind: 'smtp_test', url: URL_ },
  { kind: 'bill_reminder', url: URL_, name: 'Netflix', dueDate: '2026-10-18', amount: null },
  {
    kind: 'notification',
    url: URL_,
    titleKey: 'notification_low_balance_title',
    bodyKey: 'notification_low_balance_body',
    params: { account: 'GoPay', balance: null, threshold: null },
  },
];

describe('renderEmail', () => {
  it.each(TEMPLATES.flatMap((template) => LOCALES.map((locale) => [template.kind, locale, template] as const)))(
    '%s (%s) has a subject, an HTML part, and a plain-text part with the link spelled out',
    async (_kind, locale, template) => {
      const email = await renderEmail(template, { ...id, locale });
      expect(email.subject).not.toBe('');
      expect(email.html).toContain(`lang="${locale}"`);
      expect(email.html).toContain(`href="${URL_.replaceAll('&', '&amp;')}"`);
      expect(email.text).toContain(URL_);
      expect(email.text).not.toMatch(/<[a-z]/i);
    },
  );

  it('confirms a working SMTP setup and names the instance', async () => {
    const email = await renderEmail({ kind: 'smtp_test', url: 'https://wf.example/' }, id);
    expect(email.subject).toBe('Email uji dari Keuangan Keluarga');
    expect(email.text).toContain('Pengaturan SMTP Keuangan Keluarga sudah benar');
  });

  it('reminds of a bill with its amount, or without it in privacy mode', async () => {
    const bill = {
      kind: 'bill_reminder',
      url: 'https://wf.example/subscriptions',
      name: 'Netflix',
      dueDate: '2026-10-18',
      amount: { amountMinor: 186_000n, currency: 'IDR' },
    } as const;
    const email = await renderEmail(bill, id);
    expect(email.subject).toBe('Netflix ditagih 18 Okt 2026');
    expect(email.text).toContain('Tagihan Netflix sebesar Rp186.000 jatuh tempo 18 Okt 2026.');
    expect(email.text).toContain('Tidak ada yang dicatat otomatis');
    const hidden = await renderEmail({ ...bill, amount: null }, en);
    expect(hidden.subject).toBe('Netflix due Oct 18, 2026');
    expect(hidden.text).toContain('Your Netflix bill is due Oct 18, 2026.');
    expect(hidden.text).not.toMatch(/Rp|186/);
  });

  it('emails any notification with its params: amounts (hidden in privacy mode), dates, and built-in names', async () => {
    const budget = {
      kind: 'notification',
      url: 'https://wf.example/budget',
      titleKey: 'notification_budget_threshold_title',
      bodyKey: 'notification_budget_threshold_body',
      params: {
        category: 'system:food',
        usedPct: 91,
        spent: { amountMinor: '3200000', currency: 'IDR' },
        limit: null,
      },
    } as const;
    const email = await renderEmail(budget, id);
    expect(email.subject).toBe('Makan & Dapur 91%');
    expect(email.text).toContain('Rp3.200.000 dari •••• (91%)');
    expect(email.text).toContain('Ubah di Pengaturan › Notifikasi.');
    const trial = await renderEmail(
      {
        kind: 'notification',
        url: URL_,
        titleKey: 'notification_trial_ending_title',
        bodyKey: 'notification_trial_ending_body',
        params: { name: 'Spotify', trialEndsOn: '2026-10-20', firstBill: '2026-10-21', amount: null },
      },
      en,
    );
    expect(trial.subject).toBe('Spotify trial ends Oct 20, 2026');
    // A key this version does not know (a newer worker): a generic subject and no body.
    const unknown = await renderEmail(
      { ...budget, titleKey: 'notification_x_title', bodyKey: 'notification_x', params: { flag: true } },
      id,
    );
    expect(unknown.subject).toBe('Notifikasi dari Keuangan Keluarga');
  });

  it('names a schedule after its built-in category in the recipient language', async () => {
    const bill = { kind: 'bill_reminder', url: URL_, dueDate: '2026-10-18', amount: null } as const;
    expect((await renderEmail({ ...bill, name: 'system:bills' }, id)).subject).toBe(
      'Tagihan & Utilitas ditagih 18 Okt 2026',
    );
    expect((await renderEmail({ ...bill, name: 'system:unknown' }, en)).subject).toBe(
      'system:unknown due Oct 18, 2026',
    );
  });

  it('writes the verification email in the recipient language', async () => {
    const idEmail = await renderEmail({ kind: 'verify_email', url: URL_ }, id);
    expect(idEmail.subject).toBe('Verifikasi alamat email kamu');
    expect(idEmail.text).toContain('Halo Budi,');
    expect(idEmail.text).toContain('Email ini dikirim oleh Keuangan Keluarga.');
    const enEmail = await renderEmail({ kind: 'verify_email', url: URL_ }, en);
    expect(enEmail.subject).toBe('Verify your email address');
    expect(enEmail.text).toContain('Hi Budi,');
  });

  it('states how long reset and set-password links are valid (FR-A3)', async () => {
    const reset = await renderEmail({ kind: 'password_reset', url: URL_, expiresInMinutes: 30 }, en);
    expect(reset.subject).toBe('Reset your password');
    expect(reset.text).toContain('This link is valid for 30 minutes.');
    const set = await renderEmail({ kind: 'set_password', url: URL_, expiresInMinutes: 30 }, id);
    expect(set.subject).toBe('Atur kata sandi untuk akunmu');
    expect(set.text).toContain('Tautan ini berlaku 30 menit.');
  });

  it('shows the new device and the sign-in time in the recipient time zone', async () => {
    const email = await renderEmail(
      { kind: 'new_device_sign_in', url: URL_, device: 'Firefox on Linux', at, timeZone: 'Asia/Jakarta' },
      id,
    );
    expect(email.subject).toBe('Akunmu masuk dari perangkat baru');
    expect(email.text).toContain('(Firefox on Linux) pada 15 Okt 2026, 03.05 WIB.');
    expect(email.text).toContain('segera ganti kata sandi');
    const unknown = await renderEmail({ kind: 'new_device_sign_in', url: URL_, device: null, at, timeZone: 'UTC' }, en);
    expect(unknown.text).toContain('from a new device (unknown device) at Oct 14, 2026, 20:05 UTC.');
  });

  it('addresses invitations without a greeting and names the inviter, instance, and expiry', async () => {
    const email = await renderEmail(
      { kind: 'invitation', url: URL_, inviterName: 'Sari', expiresAt: at, timeZone: 'UTC' },
      { ...en, recipientName: null },
    );
    expect(email.subject).toBe("You're invited to Keuangan Keluarga");
    expect(email.text).toContain(
      'Sari invited you to create an account on Keuangan Keluarga. This invitation is valid until Oct 14, 2026, 20:05 UTC.',
    );
    expect(email.text).not.toContain('Hi ');
  });

  it('escapes user-controlled text in the HTML part', async () => {
    const email = await renderEmail(
      { kind: 'verify_email', url: URL_ },
      { ...en, recipientName: '<img src=x onerror=alert(1)>', instanceName: 'A & B' },
    );
    expect(email.html).not.toContain('<img src=x');
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(email.html).toContain('A &amp; B');
  });

  it.each(['javascript:alert(1)', '/relative/path', 'not a url', 'mailto:a@b.test'])(
    'refuses %s as a link',
    async (url) => {
      await expect(renderEmail({ kind: 'verify_email', url }, en)).rejects.toBeInstanceOf(InvalidEmailLinkError);
    },
  );

  it('accepts plain http links (self-hosted instances on a LAN)', async () => {
    const email = await renderEmail({ kind: 'verify_email', url: 'http://192.168.1.10:3000/verify' }, en);
    expect(email.text).toContain('http://192.168.1.10:3000/verify');
  });
});
