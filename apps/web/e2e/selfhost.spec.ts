// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The M0 install proof (plan §8 M0 exit) on the production self-host stack: on a fresh `docker compose up`, the setup
 * wizard through Caddy (admin account, mandatory TOTP, backup codes, instance settings without SMTP), then sign-out and
 * the admin's sign-in with password and TOTP. Runs with `playwright.selfhost.config.ts`; CI measures the time from
 * `docker compose up` to the end of this spec.
 */
import { enterCode, expect, freshPassword, signInWithPassword, signOut, test, totp, type Account } from './support.ts';

test.describe.configure({ mode: 'serial' });

const SETUP_TOKEN = process.env['WF_SELFHOST_SETUP_TOKEN'] ?? '';
const admin: Account = { name: 'Sari Admin', email: 'admin@selfhost.test', password: freshPassword() };

test.beforeAll(() => {
  if (SETUP_TOKEN === '') {
    throw new Error(
      'WF_SELFHOST_SETUP_TOKEN is not set: pass the token from the setup URL in `docker compose logs init`.',
    );
  }
});

test('before setup, every page and a wrong token answer 404', async ({ page }) => {
  expect((await page.goto('/'))?.status()).toBe(404);
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('heading', { name: 'Halaman tidak ditemukan' })).toBeVisible();
  expect((await page.goto('/setup?token=wrong'))?.status()).toBe(404);
  expect((await page.goto('/sign-in'))?.status()).toBe(404);
});

test('the wizard creates the admin with mandatory 2FA and the instance settings', async ({ page }) => {
  await page.goto(`/setup?token=${SETUP_TOKEN}`);
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('heading', { name: 'Buat akun admin' })).toBeVisible();
  await page.getByLabel('Nama').fill(admin.name);
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Kata sandi', { exact: true }).fill(admin.password);
  await page.getByRole('button', { name: 'Buat admin' }).click();

  const key = page.locator('code').first();
  await expect(key).toBeVisible();
  await expect(page.getByRole('img', { name: 'Kode QR untuk aplikasi autentikator' })).toBeVisible();
  admin.totpSecret = (await key.innerText()).replace(/\s/g, '');
  await enterCode(page, 'Kode 6 digit', totp(admin.totpSecret));
  await page.getByRole('button', { name: 'Verifikasi' }).click();
  await expect(page.getByRole('list', { name: 'Kode cadangan' }).getByRole('listitem')).toHaveCount(10);
  await page.getByLabel('Saya sudah menyimpan kode cadangan').check();
  await page.getByRole('button', { name: 'Selesai' }).click();

  // Instance settings as prefilled from the compose environment; SMTP stays off.
  await expect(page.getByRole('heading', { name: 'Atur instans' })).toBeVisible();
  await page.getByLabel('Nama instans').fill('Keuangan Self-host');
  await expect(page.getByLabel('Kirim email lewat SMTP')).not.toBeChecked();
  await page.getByRole('button', { name: 'Simpan dan selesai' }).click();

  await expect(page.getByRole('heading', { name: 'Penyiapan selesai' })).toBeVisible();
  await expect(page.getByText('docker compose cp web:/run/wf-secrets/kek ./write-financial-kek.backup')).toBeVisible();
  await page
    .getByRole('link', { name: 'Ke Ringkasan' })
    .or(page.getByRole('button', { name: 'Ke Ringkasan' }))
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();
  await signOut(page);

  // Setup is complete: the wizard is gone for good.
  expect((await page.goto(`/setup?token=${SETUP_TOKEN}`))?.status()).toBe(404);
});

test('the admin signs in with password and TOTP', async ({ page }) => {
  await signInWithPassword(page, admin);
  await expect(page).toHaveURL(/\/2fa/);
  await expect(page.getByRole('heading', { name: 'Verifikasi dua langkah' })).toBeVisible();
  await enterCode(page, 'Kode verifikasi', totp(admin.totpSecret ?? ''));
  await expect(page.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();

  // Through Caddy, the app's CSP and the HSTS header both reach the browser.
  const home = await page.goto('/');
  expect(home?.status()).toBe(200);
  expect(home?.headers()['content-security-policy']).toMatch(/script-src 'nonce-[^']+' 'strict-dynamic'/);
  expect(home?.headers()['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
});
