// SPDX-License-Identifier: AGPL-3.0-only
/**
 * M0 exit flow (plan §8 M0) at 1440 px on a fresh instance: the setup wizard (token, admin, mandatory 2FA, instance
 * settings with an SMTP test email), sign-out and sign-in with TOTP, lockout after 5 wrong codes, backup-code sign-in,
 * Settings › Security (devices, history, sign out other devices), the sign-in page's language switch, Bull Board for
 * the admin, and an invited user who gets 403 there.
 */
import type { Browser } from '@playwright/test';
import { BASE_URL } from './env.ts';
import {
  clearAuthCounters,
  enterCode,
  expect,
  freshPassword,
  mailSubjects,
  openUserMenu,
  saveAccount,
  screenshot,
  SETUP_TOKEN,
  signInWithPassword,
  signOut,
  test,
  totp,
  USER_STATE,
  type Account,
} from './support.ts';

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1440, height: 900 } });
// Each test starts a minute later, as far as the per-IP rate limits are concerned.
test.beforeEach(clearAuthCounters);

const admin: Account = { name: 'Sari Admin', email: 'admin@e2e.test', password: freshPassword() };
const user: Account = { name: 'Budi Pengguna', email: 'budi@e2e.test', password: freshPassword() };

/** Signs `account` in with its password and current TOTP code in a fresh browser context. */
async function signInElsewhere(browser: Browser, account: Account) {
  const context = await browser.newContext({
    locale: 'id-ID',
    baseURL: BASE_URL,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInWithPassword(page, account);
  await expect(page).toHaveURL(/\/2fa/);
  await enterCode(page, 'Kode verifikasi', totp(account.totpSecret ?? ''));
  await expect(page.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();
  return { context, page };
}

test('the setup wizard is refused without the right token, and every page leads to it', async ({ page }) => {
  const root = await page.goto('/');
  expect(root?.status()).toBe(404);
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('heading', { name: 'Halaman tidak ditemukan' })).toBeVisible();
  expect((await page.goto('/setup?token=wrong'))?.status()).toBe(404);
  expect((await page.goto('/sign-in'))?.status()).toBe(404);
});

test('the wizard creates the admin with mandatory 2FA and the instance settings', async ({ page }) => {
  await page.goto(`/setup?token=${SETUP_TOKEN}`);
  // The token moves into an httpOnly cookie and leaves the address bar.
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('heading', { name: 'Buat akun admin' })).toBeVisible();
  await screenshot(page, 'wizard-1-admin');
  await page.getByLabel('Nama').fill(admin.name);
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Kata sandi', { exact: true }).fill(admin.password);
  await page.getByRole('button', { name: 'Buat admin' }).click();

  // Step 2: TOTP enrollment (the password from step 1 is reused).
  const key = page.locator('code').first();
  await expect(key).toBeVisible();
  await expect(page.getByRole('img', { name: 'Kode QR untuk aplikasi autentikator' })).toBeVisible();
  await screenshot(page, 'wizard-2-two-factor');
  admin.totpSecret = (await key.innerText()).replace(/\s/g, '');
  await enterCode(page, 'Kode 6 digit', totp(admin.totpSecret));
  await page.getByRole('button', { name: 'Verifikasi' }).click();
  const codes = page.getByRole('list', { name: 'Kode cadangan' }).getByRole('listitem');
  await expect(codes).toHaveCount(10);
  admin.backupCodes = await codes.allInnerTexts();
  await screenshot(page, 'wizard-3-backup-codes');
  await page.getByLabel('Saya sudah menyimpan kode cadangan').check();
  await page.getByRole('button', { name: 'Selesai' }).click();

  // Step 3: instance settings with SMTP (Mailpit) and a test email.
  await expect(page.getByRole('heading', { name: 'Atur instans' })).toBeVisible();
  await page.getByLabel('Nama instans').fill('Keuangan E2E');
  await page.getByLabel('Dengan undangan').check();
  await page.getByLabel('Kirim email lewat SMTP').check();
  await page.getByLabel('Host SMTP').fill('127.0.0.1');
  await page.getByRole('textbox', { name: 'Port' }).fill('1025');
  await page.getByLabel('Alamat pengirim').fill('write.financial E2E <noreply@e2e.test>');
  await screenshot(page, 'wizard-4-instance');
  await page.getByRole('button', { name: 'Kirim email uji' }).click();
  await expect(page.getByText('Email uji terkirim ke alamat emailmu.')).toBeVisible();
  // Sent with the entered SMTP settings, before anything is saved (so still under the default instance name).
  await expect.poll(() => mailSubjects(admin.email)).toContain('Email uji dari write.financial');
  await page.getByRole('button', { name: 'Simpan dan selesai' }).click();

  await expect(page.getByRole('heading', { name: 'Penyiapan selesai' })).toBeVisible();
  await expect(page.getByText('docker compose cp web:/run/wf-secrets/kek ./write-financial-kek.backup')).toBeVisible();
  await screenshot(page, 'wizard-5-done');
  await page
    .getByRole('link', { name: 'Ke Ringkasan' })
    .or(page.getByRole('button', { name: 'Ke Ringkasan' }))
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();
  saveAccount('admin', admin);

  // Setup is complete: the wizard is gone for good.
  expect((await page.goto(`/setup?token=${SETUP_TOKEN}`))?.status()).toBe(404);
});

test('after signing out, signing in needs the TOTP code', async ({ page }) => {
  await signInWithPassword(page, admin);
  await expect(page).toHaveURL(/\/2fa/);
  await enterCode(page, 'Kode verifikasi', totp(admin.totpSecret ?? ''));
  await expect(page.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();
  await signOut(page);
  await screenshot(page, 'sign-in-dark');

  await signInWithPassword(page, admin);
  await expect(page).toHaveURL(/\/2fa/);
  await expect(page.getByRole('heading', { name: 'Verifikasi dua langkah' })).toBeVisible();
  await screenshot(page, '2fa-challenge-dark');
  await enterCode(page, 'Kode verifikasi', totp(admin.totpSecret ?? ''));
  await expect(page.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();
});

test('five wrong codes lock the account; afterwards a backup code signs in', async ({ page }) => {
  await signInWithPassword(page, admin);
  await expect(page).toHaveURL(/\/2fa/);
  const wrong = totp(admin.totpSecret ?? '', Date.now() - 10 * 60_000);
  for (const left of [4, 3, 2, 1]) {
    await enterCode(page, 'Kode verifikasi', wrong);
    await expect(page.getByText(new RegExp(`sisa ${left} percobaan`))).toBeVisible();
  }
  await enterCode(page, 'Kode verifikasi', wrong);
  await expect(page.getByText(/dikunci sampai/)).toBeVisible();
  await screenshot(page, '2fa-locked');

  // Fifteen minutes later (the lockout counter expires in Valkey).
  await clearAuthCounters();
  await signInWithPassword(page, admin);
  await expect(page).toHaveURL(/\/2fa/);
  await page.getByRole('button', { name: 'Pakai kode cadangan' }).click();
  const [code, ...rest] = admin.backupCodes ?? [];
  await page.getByLabel('Kode cadangan').fill(code ?? '');
  await page.getByRole('button', { name: 'Verifikasi' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();
  admin.backupCodes = rest;
  saveAccount('admin', admin);
});

test('Settings › Security lists the devices and the history, and signs out the other devices', async ({
  page,
  browser,
}) => {
  await signInWithPassword(page, admin);
  await enterCode(page, 'Kode verifikasi', totp(admin.totpSecret ?? ''));
  await expect(page.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();
  const other = await signInElsewhere(browser, admin);

  await page.goto('/settings/security');
  await expect(page.getByRole('heading', { name: 'Keamanan', exact: true })).toBeVisible();
  await expect(page.getByText('Perangkat ini', { exact: true })).toBeVisible();
  await expect(page.getByText('Safari · iOS', { exact: true })).toBeVisible();
  await expect(page.getByText(/Akun dikunci/).first()).toBeVisible();
  await screenshot(page, 'settings-security-dark');
  await openUserMenu(page);
  await page.getByRole('menuitemradio', { name: 'Terang' }).click();
  await page.keyboard.press('Escape');
  await screenshot(page, 'settings-security-light');
  await openUserMenu(page);
  await page.getByRole('menuitemradio', { name: 'Gelap' }).click();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Keluar dari semua perangkat lain' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Keluar/ })
    .last()
    .click();
  await expect(page.getByText('Safari · iOS', { exact: true })).toHaveCount(0);
  await other.page.reload();
  await expect(other.page).toHaveURL(/\/sign-in/);
  await other.context.close();
});

test('the language switch on the sign-in page applies without a reload', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'id-ID', baseURL: BASE_URL });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: 'Masuk ke write.financial' })).toBeVisible();
  await page.evaluate(() => {
    Reflect.set(window, '__wfSameDocument', true);
  });
  await page.getByRole('combobox', { name: 'Bahasa' }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Sign in to write.financial' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(await page.evaluate(() => Reflect.get(window, '__wfSameDocument') === true)).toBe(true);
  await context.close();
});

test('Bull Board opens for the admin, and an invited user gets 403', async ({ page, browser }) => {
  await signInWithPassword(page, admin);
  await enterCode(page, 'Kode verifikasi', totp(admin.totpSecret ?? ''));
  await expect(page.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();

  const board = await page.goto('/admin/queues');
  expect(board?.status()).toBe(200);
  expect(board?.headers()['content-security-policy']).toContain("base-uri 'self'");
  await expect(page.getByText('maintenance').first()).toBeVisible();

  // Invite a user (registration mode "Dengan undangan"); the link is shown once and emailed through SMTP.
  await page.goto('/settings/instance');
  const invite = page.getByRole('region').filter({ has: page.getByRole('heading', { name: 'Undang pengguna' }) });
  await invite.getByRole('textbox', { name: 'Email' }).fill(user.email);
  await invite.getByRole('button', { name: 'Buat undangan' }).click();
  const link = page.getByRole('textbox', { name: 'Tautan undangan', exact: true });
  await expect(link).toBeVisible();
  const url = (await link.inputValue()).trim();
  expect(url).toMatch(/\/sign-up\?invitation=/);
  await expect.poll(() => mailSubjects(user.email)).toContain('Undangan bergabung ke Keuangan E2E');

  const context = await browser.newContext({ locale: 'id-ID', baseURL: BASE_URL });
  const invited = await context.newPage();
  await invited.setViewportSize({ width: 1440, height: 900 });
  await invited.goto(url);
  await invited.getByLabel('Nama').fill(user.name);
  await invited.getByLabel('Email').fill(user.email);
  await invited.getByLabel('Kata sandi', { exact: true }).fill(user.password);
  await invited.getByRole('button', { name: 'Buat akun' }).click();
  await expect(invited.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();
  expect((await invited.goto('/admin/queues'))?.status()).toBe(403);
  await context.storageState({ path: USER_STATE });
  saveAccount('user', user);
  await context.close();
});
