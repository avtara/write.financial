// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../test/render.tsx';
import type { Result } from '../server/access.ts';
import type { InstanceDraft, InstanceInput, SmtpInput } from '../server/setup.ts';
import { InstanceForm } from './instance-form.tsx';

const DRAFT: InstanceDraft = {
  instanceName: 'write.financial',
  publicUrl: 'https://uang.example.com',
  defaultLocale: 'id',
  defaultTimezone: 'Asia/Jakarta',
  registrationMode: 'closed',
  smtp: null,
};

const WITH_SMTP: InstanceDraft = {
  ...DRAFT,
  defaultTimezone: 'Not/AZone',
  smtp: {
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    username: 'mailer',
    from: 'write.financial <noreply@example.com>',
    hasPassword: true,
  },
};

const OK: Result<null> = { ok: true, value: null };

async function setup(
  draft: InstanceDraft = DRAFT,
  {
    saved = OK,
    tested = OK,
    locale = 'id',
  }: { saved?: Result<null>; tested?: Result<null>; locale?: 'id' | 'en' } = {},
) {
  const onSave = vi.fn<(input: InstanceInput) => Promise<Result<null>>>(() => Promise.resolve(saved));
  const onTestEmail = vi.fn<(smtp: SmtpInput) => Promise<Result<null>>>(() => Promise.resolve(tested));
  const { screen } = await renderApp(
    <InstanceForm draft={draft} onSave={onSave} onTestEmail={onTestEmail} submitLabel="Simpan" />,
    { preferences: { locale } },
  );
  const save = () => userEvent.click(screen.getByRole('button', { name: 'Simpan', exact: true }));
  const test = () => userEvent.click(screen.getByRole('button', { name: 'Kirim email uji' }));
  return { screen, onSave, onTestEmail, save, test };
}

describe('InstanceForm', () => {
  it('starts from the draft with closed registration recommended and SMTP off', async () => {
    const { screen } = await setup();
    await expect.element(screen.getByLabelText('Nama instans')).toHaveValue('write.financial');
    await expect.element(screen.getByLabelText('Alamat publik')).toHaveValue('https://uang.example.com');
    await expect.element(screen.getByLabelText('Bahasa bawaan')).toHaveValue('id');
    await expect.element(screen.getByLabelText('Zona waktu bawaan')).toHaveValue('Asia/Jakarta');
    await expect.element(screen.getByRole('radio', { name: /^Tertutup/ })).toBeChecked();
    await expect.element(screen.getByRole('radio', { name: /^Tertutup/ })).toHaveAccessibleName(/Disarankan/);
    await expect.element(screen.getByRole('checkbox', { name: /Kirim email lewat SMTP/ })).not.toBeChecked();
    await expect.element(screen.getByLabelText('Host SMTP')).not.toBeInTheDocument();
  });

  it('saves the edited settings without SMTP', async () => {
    const { screen, onSave, save } = await setup();
    await userEvent.fill(screen.getByLabelText('Nama instans'), '  Keuangan Rumah  ');
    await userEvent.fill(screen.getByLabelText('Alamat publik'), ' http://192.168.1.5:3000 ');
    await userEvent.selectOptions(screen.getByLabelText('Bahasa bawaan'), 'en');
    await userEvent.selectOptions(screen.getByLabelText('Zona waktu bawaan'), 'Asia/Makassar');
    await userEvent.click(screen.getByRole('radio', { name: /^Dengan undangan/ }));
    await save();
    expect(onSave).toHaveBeenCalledWith({
      instanceName: 'Keuangan Rumah',
      publicUrl: 'http://192.168.1.5:3000',
      defaultLocale: 'en',
      defaultTimezone: 'Asia/Makassar',
      registrationMode: 'invite',
      smtp: null,
    });
    await expect.element(screen.getByRole('status')).toHaveTextContent('Pengaturan instans tersimpan.');
  });

  it('keeps the language when the select reports an unknown value', async () => {
    const { screen, onSave, save } = await setup();
    const select = screen.getByLabelText('Bahasa bawaan').element() as HTMLSelectElement;
    select.value = 'xx';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await save();
    expect(onSave.mock.calls[0]?.[0].defaultLocale).toBe('id');
  });

  it('marks a missing name and an address that is not http(s)', async () => {
    const { screen, onSave, save } = await setup();
    await userEvent.fill(screen.getByLabelText('Nama instans'), '   ');
    await userEvent.fill(screen.getByLabelText('Alamat publik'), 'uang.example.com');
    await save();
    await expect.element(screen.getByLabelText('Nama instans')).toHaveAccessibleDescription('Isi nama instans.');
    await expect
      .element(screen.getByLabelText('Alamat publik'))
      .toHaveAccessibleDescription('Masukkan alamat lengkap, misalnya https://uang.example.com.');
    await userEvent.fill(screen.getByLabelText('Alamat publik'), 'ftp://uang.example.com');
    await save();
    await expect.element(screen.getByLabelText('Alamat publik')).toHaveAttribute('aria-invalid', 'true');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows why saving failed', async () => {
    const { save, screen } = await setup(DRAFT, { saved: { ok: false, code: 'REAUTHENTICATION_REQUIRED' } });
    await save();
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Demi keamanan, masuk lagi untuk melanjutkan.');
  });

  it('sends a test email with new SMTP settings and saves them without a login', async () => {
    const { screen, onTestEmail, onSave, save, test } = await setup();
    await userEvent.click(screen.getByRole('checkbox', { name: /Kirim email lewat SMTP/ }));
    await expect.element(screen.getByLabelText('Port')).toHaveValue('587');
    await expect.element(screen.getByLabelText('Kata sandi SMTP')).not.toHaveAttribute('placeholder');
    await userEvent.fill(screen.getByLabelText('Host SMTP'), ' mail.example.com ');
    await userEvent.fill(screen.getByLabelText('Alamat pengirim'), 'noreply@example.com');
    await test();
    const smtp = { host: 'mail.example.com', port: 587, secure: false, username: null, from: 'noreply@example.com' };
    expect(onTestEmail).toHaveBeenCalledWith({ ...smtp, password: null });
    await expect.element(screen.getByRole('status')).toHaveTextContent('Email uji terkirim ke alamat emailmu.');
    await save();
    expect(onSave.mock.calls[0]?.[0].smtp).toEqual({ ...smtp, password: null });
  });

  it('shows the SMTP answer when the test email fails', async () => {
    const { screen, test } = await setup(WITH_SMTP, {
      tested: { ok: false, code: 'MAIL_FAILED', detail: '535 Authentication failed' },
    });
    await test();
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Email uji gagal terkirim: 535 Authentication failed');
  });

  it('marks SMTP fields the server would refuse', async () => {
    const { screen, onTestEmail, onSave, save, test } = await setup();
    await userEvent.click(screen.getByRole('checkbox', { name: /Kirim email lewat SMTP/ }));
    await userEvent.fill(screen.getByLabelText('Host SMTP'), 'smtp example');
    await userEvent.fill(screen.getByLabelText('Port'), 'abc');
    await userEvent.fill(screen.getByLabelText('Alamat pengirim'), 'noreply');
    await test();
    await expect
      .element(screen.getByLabelText('Host SMTP'))
      .toHaveAccessibleDescription('Masukkan nama host, misalnya smtp.example.com.');
    await expect.element(screen.getByLabelText('Port')).toHaveAccessibleDescription('Port antara 1 dan 65535.');
    await expect
      .element(screen.getByLabelText('Alamat pengirim'))
      .toHaveAccessibleDescription('Masukkan alamat email pengirim.');
    for (const port of ['0', '65536']) {
      await userEvent.fill(screen.getByLabelText('Port'), port);
      await save();
      await expect.element(screen.getByLabelText('Port')).toHaveAttribute('aria-invalid', 'true');
    }
    expect(onTestEmail).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps a stored password unless a new one is typed', async () => {
    const { screen, onSave, save } = await setup(WITH_SMTP, { locale: 'en' });
    await expect.element(screen.getByLabelText('Default time zone')).toHaveValue('Not/AZone');
    await expect.element(screen.getByLabelText('SMTP password')).toHaveAttribute('placeholder', '•••• ');
    await expect.element(screen.getByText('A password is saved. Leave empty to keep it.')).toBeVisible();
    await expect.element(screen.getByRole('checkbox', { name: /Implicit TLS/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Simpan', exact: true }));
    expect(onSave.mock.calls[0]?.[0].smtp).toEqual({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      username: 'mailer',
      from: 'write.financial <noreply@example.com>',
    });
    await userEvent.click(screen.getByRole('checkbox', { name: /Implicit TLS/ }));
    await userEvent.fill(screen.getByLabelText('Port'), '587');
    await userEvent.fill(screen.getByLabelText('Username'), 'mailer2');
    await userEvent.fill(screen.getByLabelText('SMTP password'), 'app-password');
    await save();
    expect(onSave.mock.calls[1]?.[0].smtp).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      username: 'mailer2',
      password: 'app-password',
      from: 'write.financial <noreply@example.com>',
    });
  });

  it('forgets a typed password and the test result when SMTP is turned off', async () => {
    const { screen, onSave, save, test } = await setup(WITH_SMTP);
    await userEvent.fill(screen.getByLabelText('Kata sandi SMTP'), 'typed');
    await test();
    await expect.element(screen.getByRole('status')).toBeVisible();
    const toggle = screen.getByRole('checkbox', { name: /Kirim email lewat SMTP/ });
    await userEvent.click(toggle);
    await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
    await userEvent.click(toggle);
    await save();
    expect(onSave.mock.calls[0]?.[0].smtp).not.toHaveProperty('password');
  });
});
