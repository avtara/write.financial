// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { canOpenSection, SettingsLayout } from './settings-layout.tsx';

describe('canOpenSection', () => {
  it('knows the sections and keeps "instance" for admins', () => {
    expect(canOpenSection('profile', { role: 'user' })).toBe(true);
    expect(canOpenSection('security', { role: 'user' })).toBe(true);
    expect(canOpenSection('categories', { role: 'user' })).toBe(true);
    expect(canOpenSection('tags', { role: 'user' })).toBe(true);
    expect(canOpenSection('instance', { role: 'user' })).toBe(false);
    expect(canOpenSection('instance', { role: 'admin' })).toBe(true);
    expect(canOpenSection('billing', { role: 'admin' })).toBe(false);
  });
});

describe('SettingsLayout', () => {
  it('shows the header, the sections a user may open, and the open section', async () => {
    const { screen } = await renderApp(
      <SettingsLayout viewer={{ role: 'user' }} section="security">
        <p>isi</p>
      </SettingsLayout>,
    );
    await expect.element(screen.getByRole('heading', { level: 1, name: 'Pengaturan' })).toBeVisible();
    await expect
      .element(
        screen.getByText('Akun, mata uang & kurs, tampilan, notifikasi, dan data — tersinkron di semua perangkat.'),
      )
      .toBeVisible();
    const nav = screen.getByRole('navigation', { name: 'Bagian pengaturan' });
    expect(nav.element().textContent).toBe('AkunProfil & akunPreferensiKategoriTagDataKeamanan');
    await expect.element(nav.getByRole('link', { name: 'Profil & akun' })).toHaveAttribute('href', '/settings/profile');
    await expect.element(nav.getByRole('link', { name: 'Kategori' })).toHaveAttribute('href', '/settings/categories');
    await expect.element(nav.getByRole('link', { name: 'Tag' })).toHaveAttribute('href', '/settings/tags');
    const section = screen.getByRole('region', { name: 'Keamanan' });
    await expect.element(section.getByText('Lindungi data keuanganmu di perangkat ini.')).toBeVisible();
    await expect.element(section.getByText('isi')).toBeVisible();
  });

  it('lists "Instans" for admins', async () => {
    const { screen } = await renderApp(
      <SettingsLayout viewer={{ role: 'admin' }} section="instance">
        <p>isi</p>
      </SettingsLayout>,
      { preferences: { locale: 'en' } },
    );
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    await expect.element(nav.getByRole('heading', { name: 'Instance' })).toBeVisible();
    await expect.element(nav.getByRole('link', { name: 'Instance' })).toHaveAttribute('href', '/settings/instance');
    await expect.element(screen.getByRole('region', { name: 'Instance' })).toBeVisible();
  });
});
