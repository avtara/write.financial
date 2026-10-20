// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-A4 onboarding (design Section 16 `vSYBL`) for users the admin from `m0` invites: the design persona's setup
 * keyboard-only at 1440 px (three accounts → "Saldo tersedia" Rp51.347.000, Dana Darurat 54.000.000 with a monthly
 * contribution that only reaches the Review queue), skipping the goal at 1024 px, and the quick path at 768 px. Every
 * user lands on Ringkasan and is never sent back to the onboarding.
 */
import type { Browser, Page } from '@playwright/test';
import postgres from 'postgres';
import { BASE_URL, e2eEnv } from './env.ts';
import {
  clearAuthCounters,
  enterCode,
  expect,
  freshPassword,
  loadAccount,
  newContext,
  signInWithPassword,
  skipOnboarding,
  test,
  totp,
} from './support.ts';

test.describe.configure({ mode: 'serial' });
test.beforeEach(clearAuthCounters);

/** The admin invites `email` (registration "Dengan undangan", m0) and the invitee signs up at `width` px. */
async function signUpInvited(browser: Browser, email: string, name: string, width: number): Promise<Page> {
  const admin = loadAccount('admin');
  const adminContext = await newContext(browser, { locale: 'id-ID', baseURL: BASE_URL });
  const adminPage = await adminContext.newPage();
  await signInWithPassword(adminPage, admin);
  await enterCode(adminPage, 'Kode verifikasi', totp(admin.totpSecret ?? ''));
  await expect(adminPage.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();
  await adminPage.goto('/settings/instance');
  const invite = adminPage
    .getByRole('region')
    .filter({ has: adminPage.getByRole('heading', { name: 'Undang pengguna' }) });
  await invite.getByRole('textbox', { name: 'Email' }).fill(email);
  await invite.getByRole('button', { name: 'Buat undangan' }).click();
  const link = adminPage.getByRole('textbox', { name: 'Tautan undangan', exact: true });
  await expect(link).toBeVisible();
  const url = (await link.inputValue()).trim();
  await adminContext.close();

  const context = await newContext(browser, { locale: 'id-ID', baseURL: BASE_URL, timezoneId: 'Asia/Jakarta' });
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 1024 });
  await page.goto(url);
  await page.getByLabel('Nama').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Kata sandi', { exact: true }).fill(freshPassword());
  await page.getByRole('button', { name: 'Buat akun' }).click();
  return page;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `/tmp/wf-onboarding-${name}.png`, fullPage: true });
}

/** Types into the focused control, key by key. */
async function typeKeys(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
}

test('a new user sets up profile, period, three accounts, and Dana Darurat keyboard-only (1440)', async ({
  browser,
}) => {
  const email = 'rina@e2e.test';
  const page = await signUpInvited(browser, email, 'Rina Kartika', 1440);

  // 1 Profil: the heading has the focus; the preferred name is suggested from the full name.
  await expect(page).toHaveURL(/\/onboarding\/profile$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Halo, Rina! Lengkapi profilmu' })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Nama sapaan' })).toHaveValue('Rina');
  await expect(page.getByText('“Selamat sore, Rina”')).toBeVisible();
  // "Tambah": the first currencies of the list after the base one (USD, then SGD).
  const add = page.getByRole('combobox', { name: 'Tambah mata uang' });
  await add.focus();
  await page.keyboard.press('ArrowDown');
  await add.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Hapus USD' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hapus SGD' })).toBeVisible();
  await shot(page, '1-profile');
  await page.getByRole('textbox', { name: 'Nama sapaan' }).focus();
  await page.keyboard.press('Enter');

  // 2 Periode: payday the 1st, "Okt 2026 = 1–31 Okt", income 25.800.000.
  await expect(page).toHaveURL(/\/onboarding\/period$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Kapan bulanmu dimulai?' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Tanggal 1' })).toBeChecked();
  await expect(page.getByText('Dipakai sebagai awal periode bulanan · Okt 2026 = 1–31 Okt')).toBeVisible();
  await page.getByRole('textbox', { name: 'Pemasukan bulanan rata-rata' }).focus();
  await typeKeys(page, '25800000');
  await shot(page, '2-period');
  await page.keyboard.press('Enter');

  // 3 Rekening: BCA Tahapan, Bank Jago, GoPay from the chips, today's balances.
  await expect(page).toHaveURL(/\/onboarding\/accounts$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Rekening yang kamu pakai' })).toBeVisible();
  for (const [chip, name, balance] of [
    ['BCA', 'BCA Tahapan', '42810000'],
    ['Bank Jago', null, '8125000'],
    ['GoPay', null, '412000'],
  ] as const) {
    await page.getByRole('button', { name: `Tambah ${chip}` }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Nama rekening' }).last()).toBeFocused();
    if (name !== null) await typeKeys(page, name);
    await page.keyboard.press('Tab');
    await typeKeys(page, balance);
  }
  await page.keyboard.press('Tab');
  await expect(page.getByRole('status').filter({ hasText: 'Saldo tersedia' })).toContainText('Rp51.347.000');
  await expect(page.getByRole('button', { name: 'Tambah Mandiri' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tambah OVO' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tambah Tunai' })).toBeVisible();
  await shot(page, '3-accounts');
  await page.getByRole('button', { name: 'Lanjut' }).focus();
  await page.keyboard.press('Enter');

  // 4 Tujuan: Dana Darurat ≈ 3× spending = 54.000.000 in Bank Jago, Rp500.000 every 1st from BCA Tahapan.
  await expect(page).toHaveURL(/\/onboarding\/goal$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Mulai satu tujuan tabungan' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Dana Darurat/ })).toBeChecked();
  await expect(page.getByText('3× pengeluaran ≈ Rp54.000.000')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Target' })).toHaveValue('54.000.000');
  await expect(page.getByRole('combobox', { name: 'Simpan di' }).locator('option:checked')).toHaveText('Bank Jago');
  await page.getByRole('checkbox', { name: 'Setoran rutin' }).focus();
  await page.keyboard.press('Space');
  await page.getByRole('textbox', { name: 'Jumlah setoran' }).focus();
  await typeKeys(page, '500000');
  await expect(page.getByText('Rp500.000 tiap tgl 1 dari BCA Tahapan')).toBeVisible();
  await shot(page, '4-goal');
  await page.keyboard.press('Enter');

  // 5 Selesai.
  await expect(page).toHaveURL(/\/onboarding\/done$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Siap! write.financial sudah diatur' })).toBeVisible();
  const summary = page.getByRole('list', { name: 'Yang sudah diatur' });
  await expect(summary.getByText('Profil · IDR + USD, SGD')).toBeVisible();
  await expect(summary.getByText('Okt = 1–31 Okt')).toBeVisible();
  await expect(summary.getByText('3 rekening · saldo tersedia')).toBeVisible();
  await expect(summary.getByText('Rp51.347.000')).toBeVisible();
  await expect(summary.getByText('Dana Darurat · Bank Jago')).toBeVisible();
  await expect(summary.getByText('Rp8.125.000')).toBeVisible();
  await expect(summary.getByText('54.000.000')).toBeVisible();
  await shot(page, '5-done');
  await page.getByRole('button', { name: 'Ke Ringkasan' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();

  // Completed: the onboarding never comes back.
  await page.goto('/onboarding/profile');
  await expect(page).toHaveURL(/\/$/);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();

  // The contribution is a monthly recurrence (D14: its occurrences wait in the Review queue), nothing recorded yet.
  const sql = postgres(e2eEnv()['DATABASE_URL_SUPERUSER'] ?? '', { max: 1, onnotice: () => undefined });
  try {
    const user = sql`(SELECT id FROM users WHERE email = ${email})`;
    const recurrences = await sql<{ template: { type: string; sentMinor: string }; month_day: number }[]>`
      SELECT template, month_day FROM recurrences WHERE user_id = ${user}`;
    expect(recurrences).toEqual([
      expect.objectContaining({
        month_day: 1,
        template: expect.objectContaining({ type: 'transfer', sentMinor: '500000' }),
      }),
    ]);
    const [{ n } = { n: -1 }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM transactions WHERE user_id = ${user}`;
    expect(n).toBe(0);
    const [prefs] = await sql<{ extra_currencies: string[] }[]>`
      SELECT extra_currencies FROM user_preferences WHERE user_id = ${user}`;
    expect(prefs?.extra_currencies).toEqual(['USD', 'SGD']);
  } finally {
    await sql.end();
  }
  await page.context().close();
});

test('skipping the goal works (1024)', async ({ browser }) => {
  const page = await signUpInvited(browser, 'sari@e2e.test', 'Sari Wulan', 1024);
  await expect(page).toHaveURL(/\/onboarding\/profile$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Halo, Sari! Lengkapi profilmu' })).toBeVisible();
  await page.getByRole('button', { name: 'Lanjut' }).click();
  await expect(page).toHaveURL(/\/onboarding\/period$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Kapan bulanmu dimulai?' })).toBeVisible();
  await page.getByRole('button', { name: 'Lanjut' }).click();
  await expect(page).toHaveURL(/\/onboarding\/accounts$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Rekening yang kamu pakai' })).toBeVisible();
  await page.getByRole('button', { name: 'Tambah GoPay' }).click();
  await page.keyboard.press('Tab');
  await typeKeys(page, '412000');
  await page.getByRole('button', { name: 'Lanjut' }).click();
  await expect(page).toHaveURL(/\/onboarding\/goal$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Mulai satu tujuan tabungan' })).toBeVisible();
  await shot(page, '1024-goal');
  await page.getByRole('button', { name: 'Lewati' }).click();
  await expect(page).toHaveURL(/\/onboarding\/done$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Siap! write.financial sudah diatur' })).toBeVisible();
  await expect(page.getByText('1 rekening · saldo tersedia')).toBeVisible();
  await expect(page.getByText(/Dana Darurat/)).toHaveCount(0);
  // "Kembali" through the stepper shows what was saved.
  await page.getByRole('link', { name: 'Rekening (selesai)' }).click();
  await expect(page.getByRole('textbox', { name: 'Saldo hari ini GoPay' })).toHaveValue('412.000');
  await page.getByRole('link', { name: 'Selesai', exact: true }).click();
  await page.getByRole('button', { name: 'Ke Ringkasan' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();
  await page.context().close();
});

test('the quick path fits a 768 px tablet', async ({ browser }) => {
  const page = await signUpInvited(browser, 'tono@e2e.test', 'Tono Prasetyo', 768);
  await expect(page.getByRole('heading', { level: 1, name: 'Halo, Tono! Lengkapi profilmu' })).toBeVisible();
  await shot(page, '768-profile');
  await skipOnboarding(page);
  await page.goto('/onboarding/goal');
  await expect(page).toHaveURL(/\/$/);
  await page.context().close();
});
