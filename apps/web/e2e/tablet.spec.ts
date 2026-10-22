// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The M0 screens at 1024 px (tablet rail layout), with the accounts the `m0` project created: the closed setup
 * wizard, sign-in and the 2FA challenge, Settings › Security, the sign-out dialog, and Bull Board refused to the
 * invited user.
 */
import {
  clearAuthCounters,
  enterCode,
  expect,
  loadAccount,
  screenshot,
  SETUP_TOKEN,
  test,
  totp,
  USER_STATE,
} from './support.ts';

test.describe.configure({ mode: 'serial' });
test.beforeEach(clearAuthCounters);

test('the setup wizard stays closed', async ({ page }) => {
  expect((await page.goto(`/setup?token=${SETUP_TOKEN}`))?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Halaman tidak ditemukan' })).toBeVisible();
});

test('the admin signs in with TOTP and reviews Settings › Security in the rail layout', async ({ page }) => {
  const admin = loadAccount('admin');
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: 'Masuk ke write.financial' })).toBeVisible();
  await screenshot(page, 'sign-in-1024');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Kata sandi', { exact: true }).fill(admin.password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verifikasi dua langkah' })).toBeVisible();
  await screenshot(page, '2fa-challenge-1024');
  await enterCode(page, 'Kode verifikasi', totp(admin.totpSecret ?? ''));
  await expect(page.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();

  await page.goto('/settings/security');
  const settings = page.getByRole('dialog', { name: 'Pengaturan' });
  await expect(settings.getByRole('heading', { name: 'Keamanan', exact: true })).toBeVisible();
  await expect(page.getByText('Perangkat ini', { exact: true })).toBeVisible();
  await screenshot(page, 'settings-security-1024');
  // Settings is a dialog over the overview: Escape closes it, and the rail is usable again.
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);

  await page.getByRole('button', { name: 'Menu pengguna' }).click();
  await page.getByRole('menuitem', { name: 'Keluar' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Keluar dari write.financial?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keluar' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});

test.describe('invited user', () => {
  test.use({ storageState: USER_STATE });

  test('sees the app in the rail layout, without access to Bull Board', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();
    expect((await page.goto('/admin/queues'))?.status()).toBe(403);
  });
});
