// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { RenderResult } from 'vitest-browser-react';
import { renderApp } from '../../../test/render.tsx';
// `vi.mock` calls are hoisted above these imports.
import { getInstance, inviteUser, saveInstance, sendInstanceTestEmail } from '../../server/fn/admin.ts';
import type { InstanceDraft } from '../../server/setup.ts';
import { InstanceSection } from './instance-section.tsx';

vi.mock('../../server/fn/admin.ts', () => ({
  getInstance: vi.fn(),
  saveInstance: vi.fn(),
  sendInstanceTestEmail: vi.fn(),
  inviteUser: vi.fn(),
}));

const DRAFT: InstanceDraft = {
  instanceName: 'Keuangan Rumah',
  publicUrl: 'https://uang.example.com',
  defaultLocale: 'en',
  defaultTimezone: 'Asia/Jakarta',
  registrationMode: 'invite',
  smtp: {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    username: null,
    from: 'noreply@example.com',
    hasPassword: false,
  },
};

const URL_WITH_TOKEN = `https://uang.example.com/sign-up?invitation=${'t'.repeat(43)}`;
const EXPIRES = new Date('2026-10-25T03:00:00Z');

beforeEach(() => {
  vi.mocked(getInstance).mockResolvedValue({ ok: true, value: DRAFT });
  vi.mocked(saveInstance).mockResolvedValue({ ok: true, value: null });
  vi.mocked(sendInstanceTestEmail).mockResolvedValue({ ok: true, value: null });
  vi.mocked(inviteUser).mockResolvedValue({
    ok: true,
    value: { url: URL_WITH_TOKEN, expiresAt: EXPIRES, emailed: true },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function invite(screen: RenderResult, email: string) {
  await userEvent.fill(screen.getByLabelText('Email', { exact: true }), email);
  await userEvent.click(screen.getByRole('button', { name: 'Buat undangan' }));
}

describe('InstanceSection', () => {
  it('loads the settings into the form and saves them', async () => {
    const { screen } = await renderApp(<InstanceSection />);
    await expect.element(screen.getByRole('heading', { name: 'Instans' })).toBeVisible();
    await expect.element(screen.getByLabelText('Nama instans')).toHaveValue('Keuangan Rumah');
    await userEvent.click(screen.getByRole('button', { name: 'Kirim email uji' }));
    expect(sendInstanceTestEmail).toHaveBeenCalledWith({
      data: {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        username: null,
        password: null,
        from: 'noreply@example.com',
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Simpan', exact: true }));
    expect(vi.mocked(saveInstance).mock.calls[0]?.[0]).toMatchObject({ data: { instanceName: 'Keuangan Rumah' } });
    await expect.element(screen.getByText('Pengaturan instans tersimpan.')).toBeVisible();
    await expect.element(screen.getByRole('link', { name: 'Masuk lagi' })).not.toBeInTheDocument();
  });

  it('shows loading, then why the settings could not be loaded', async () => {
    const loading = Promise.withResolvers<never>();
    vi.mocked(getInstance).mockReturnValue(loading.promise);
    const { screen } = await renderApp(<InstanceSection />, { preferences: { locale: 'en' } });
    await expect.element(screen.getByRole('status')).toHaveTextContent('Loading instance settings…');
    loading.reject(new TypeError('Failed to fetch'));
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Instance settings could not be loadedSomething went wrong. Try again in a moment.');
  });

  it('links to signing in again when the session is too old', async () => {
    vi.mocked(saveInstance).mockResolvedValue({ ok: false, code: 'REAUTHENTICATION_REQUIRED' });
    const { screen } = await renderApp(<InstanceSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Simpan', exact: true }));
    await expect
      .element(screen.getByRole('link', { name: 'Masuk lagi' }))
      .toHaveAttribute('href', '/sign-in?reauth=1&redirect=/settings/instance');
    await expect
      .element(screen.getByText('Demi keamanan, masuk lagi untuk mengubah pengaturan instans.'))
      .toBeVisible();
  });

  it('invites by email in the chosen language and shows the link once', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const { screen } = await renderApp(<InstanceSection />);
    await expect.element(screen.getByLabelText('Bahasa email')).toHaveValue('en');
    await userEvent.selectOptions(screen.getByLabelText('Bahasa email'), 'id');
    await invite(screen, ' teman@example.com ');
    expect(inviteUser).toHaveBeenCalledWith({ data: { email: 'teman@example.com', locale: 'id' } });
    await expect.element(screen.getByText('Undangan terkirim ke teman@example.com.')).toBeVisible();
    const link = screen.getByLabelText('Tautan undangan');
    await expect.element(link).toHaveValue(URL_WITH_TOKEN);
    await expect.element(link).toHaveAccessibleDescription(/^Tautan ini hanya ditampilkan sekali\. Berlaku sampai /);
    await userEvent.click(link);
    expect((link.element() as HTMLInputElement).selectionEnd).toBe(URL_WITH_TOKEN.length);
    await userEvent.click(screen.getByRole('button', { name: 'Salin tautan undangan' }));
    expect(write).toHaveBeenCalledWith(URL_WITH_TOKEN);
    await expect.element(screen.getByLabelText('Email', { exact: true })).toHaveValue('');
  });

  it('says when the invitation could not be emailed', async () => {
    vi.mocked(inviteUser).mockResolvedValue({
      ok: true,
      value: { url: URL_WITH_TOKEN, expiresAt: EXPIRES, emailed: false },
    });
    const { screen } = await renderApp(<InstanceSection />);
    await invite(screen, 'teman@example.com');
    await expect
      .element(screen.getByText('Email belum diatur, jadi undangan tidak dikirim. Bagikan tautan ini sendiri.'))
      .toBeVisible();
  });

  it('explains that invitations need registration by invitation', async () => {
    vi.mocked(inviteUser).mockResolvedValue({ ok: false, code: 'INVITATIONS_DISABLED' });
    const { screen } = await renderApp(<InstanceSection />);
    await invite(screen, 'teman@example.com');
    await expect.element(screen.getByRole('alert')).toMatchTextContent(/pendaftaran diatur ke “Dengan undangan”/);
    await expect.element(screen.getByLabelText('Tautan undangan')).not.toBeInTheDocument();
  });
});
