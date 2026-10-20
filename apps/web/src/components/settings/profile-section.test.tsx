// SPDX-License-Identifier: AGPL-3.0-only
import type { Profile } from '@wf/db/profiles';
import { getLocale } from '@wf/i18n/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { fakeAuthActions, VIEWER } from '../../../test/fake-auth.ts';
import { renderApp } from '../../../test/render.tsx';
import { AuthActionsProvider } from '../auth-actions.tsx';
import { ProfileSection, type SignInMethods } from './profile-section.tsx';

const server = vi.hoisted(() => ({ updateProfile: vi.fn(), revokeDevice: vi.fn() }));
vi.mock('../../server/fn/account.ts', () => server);

const PROFILE: Profile = { name: 'Avtara K.', nickname: null, locale: 'id', timezone: 'Asia/Jakarta' };

async function renderProfile(
  profile: Profile = PROFILE,
  methods: SignInMethods = { hasPassword: true, googleLinked: true },
) {
  const result = await renderApp(
    <AuthActionsProvider actions={fakeAuthActions()}>
      <ProfileSection viewer={VIEWER} profile={profile} methods={methods} />
    </AuthActionsProvider>,
  );
  const invalidate = vi.spyOn(result.router, 'invalidate');
  const { screen } = result;
  return {
    ...result,
    invalidate,
    name: screen.getByRole('textbox', { name: 'Nama lengkap' }),
    nickname: screen.getByRole('textbox', { name: 'Nama sapaan' }),
    status: screen.getByRole('status'),
    save: screen.getByRole('button', { name: 'Simpan perubahan' }),
    cancel: screen.getByRole('button', { name: 'Batal' }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProfileSection', () => {
  it('shows the profile and the sign-in methods', async () => {
    const { screen, name, nickname, status, save } = await renderProfile();
    await expect.element(name).toHaveValue('Avtara K.');
    await expect.element(nickname).toHaveValue('');
    await expect.element(screen.getByText('“Selamat sore, Avtara”')).toBeVisible();
    await expect.element(screen.getByText('dipakai di laporan PDF')).toBeVisible();
    await expect.element(screen.getByRole('combobox', { name: 'Bahasa' })).toHaveDisplayValue('Bahasa Indonesia');
    await expect.element(screen.getByRole('combobox', { name: 'Zona waktu' })).toHaveDisplayValue('Asia/Jakarta (WIB)');
    await expect.element(screen.getByText(VIEWER.email, { exact: true })).toBeVisible();
    await expect.element(screen.getByText('Identitas akun — tidak bisa diubah')).toBeVisible();
    await expect.element(screen.getByRole('heading', { name: 'Metode masuk' })).toBeVisible();
    await expect.element(screen.getByText(`${VIEWER.email} · terhubung`)).toBeVisible();
    await expect.element(screen.getByText('Diatur', { exact: true })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Ubah' })).toBeVisible();
    await expect.element(status).toHaveTextContent('Tersinkron ke semua perangkat');
    await expect.element(save).toBeDisabled();
  });

  it('tracks unsaved changes, discards them, and saves trimmed values', async () => {
    const saved: Profile = { name: 'Avtara Kusuma', nickname: 'Ava', locale: 'id', timezone: 'Asia/Makassar' };
    server.updateProfile
      .mockResolvedValueOnce({ ok: false, code: 'INVALID_PROFILE' })
      .mockResolvedValueOnce({ ok: true, value: saved });
    const { screen, name, nickname, status, save, cancel, invalidate } = await renderProfile();

    await userEvent.fill(name, 'Budi');
    await expect.element(status).toHaveTextContent('Ada perubahan belum disimpan');
    await userEvent.click(cancel);
    await expect.element(name).toHaveValue('Avtara K.');
    await expect.element(cancel).toBeDisabled();

    await userEvent.fill(name, '   ');
    await expect.element(save).toBeDisabled();
    await userEvent.fill(name, ' Avtara Kusuma ');
    await userEvent.fill(nickname, ' Ava ');
    await expect.element(screen.getByText('“Selamat sore,  Ava ”')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Zona waktu' }), 'Asia/Makassar');
    await userEvent.click(save);
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Ada yang salah. Coba lagi sebentar.');
    await userEvent.click(save);
    await expect.element(status).toHaveTextContent('Tersimpan');
    expect(server.updateProfile).toHaveBeenLastCalledWith({
      data: { name: 'Avtara Kusuma', nickname: 'Ava', locale: 'id', timezone: 'Asia/Makassar' },
    });
    await expect.element(nickname).toHaveValue('Ava');
    expect(invalidate).toHaveBeenCalled();
    expect(screen.getByRole('alert').query()).toBeNull();

    await userEvent.fill(nickname, '');
    await expect.element(status).toHaveTextContent('Ada perubahan belum disimpan');
  });

  it('saves a blank preferred name as none', async () => {
    server.updateProfile.mockResolvedValueOnce({ ok: true, value: PROFILE });
    const { nickname, save } = await renderProfile({ ...PROFILE, nickname: 'Ava' });
    await userEvent.fill(nickname, '  ');
    await userEvent.click(save);
    expect(server.updateProfile).toHaveBeenLastCalledWith({ data: { ...PROFILE, nickname: null } });
  });

  it('applies a language at once, without an unsaved change', async () => {
    const { screen, status } = await renderProfile();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Bahasa' }), 'en');
    expect(getLocale()).toBe('en');
    await expect.element(status).toHaveTextContent('Synced to all devices');
    await expect.element(screen.getByRole('combobox', { name: 'Time zone' })).toHaveDisplayValue('Asia/Jakarta');
  });

  it('lists a zone this browser does not know, and offers to set a password for Google-only accounts', async () => {
    const { screen } = await renderProfile(
      { ...PROFILE, timezone: 'UTC' },
      { hasPassword: false, googleLinked: false },
    );
    await expect.element(screen.getByRole('combobox', { name: 'Zona waktu' })).toHaveDisplayValue('UTC');
    await expect.element(screen.getByText('Belum diatur — saat ini hanya bisa masuk dengan Google')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Atur kata sandi' })).toBeVisible();
    expect(screen.getByText(`${VIEWER.email} · terhubung`).query()).toBeNull();

    server.updateProfile.mockResolvedValueOnce({ ok: true, value: PROFILE });
    await userEvent.fill(screen.getByRole('textbox', { name: 'Nama lengkap' }), 'Budi');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    expect(server.updateProfile).toHaveBeenLastCalledWith({ data: { ...PROFILE, name: 'Budi', timezone: 'UTC' } });
  });
});
