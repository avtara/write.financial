// SPDX-License-Identifier: AGPL-3.0-only
/** FR-ST4/FR-I5: real encrypted BYOK storage, deterministic provider HTTP, tenant isolation and manual fallback. */
import type { Page } from '@playwright/test';
import postgres from 'postgres';
import { e2eEnv } from './env.ts';
import {
  clearAuthCounters,
  enterCode,
  expect,
  freshPassword,
  newContext,
  projectUser,
  screenshot,
  setUpProjectUser,
  test,
  totp,
} from './support.ts';

const user = projectUser('market-api');
const other = projectUser('market-api-other');
const password = freshPassword();
const key = 'fake-e2e-eodhd-key';
const provider = (page: Page) => page.locator('[data-provider="eodhd"]');
// The suite is stateful (one user enrolls 2FA, saves a key, then deletes it); a retry after a partial run cannot
// repeat the enrollment, so a failure is reported instead of retried.
test.describe.configure({ mode: 'serial', retries: 0 });
test.use({ storageState: user.state });
test.beforeEach(clearAuthCounters);

test.beforeAll(async ({ browser }) => {
  await setUpProjectUser(browser, user, { persona: true, password });
  await setUpProjectUser(browser, other, { persona: true });
  const sql = postgres(e2eEnv()['DATABASE_URL_SUPERUSER'] ?? '', { max: 1 });
  try {
    // Only this project's BBCA opts into BYOK; its manual price remains the fallback.
    await sql`UPDATE assets SET price_mode = 'byok' WHERE symbol = 'BBCA' AND user_id = (SELECT id FROM users WHERE email = ${user.email})`;
  } finally {
    await sql.end();
  }
});

async function openMarket(page: Page) {
  await page.goto('/?settings=market');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('dialog', { name: 'Pengaturan', exact: true })).toBeVisible();
  await expect(provider(page)).toBeVisible();
}

async function saveKey(page: Page, value: string) {
  await provider(page)
    .getByRole('button', { name: /^(Atur|Ganti) key EODHD$/ })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Atur key EODHD' });
  await dialog.getByLabel('API key', { exact: true }).fill(value);
  await dialog.getByRole('button', { name: 'Simpan key' }).click();
  await expect(dialog).toBeHidden();
  await expect(provider(page)).toContainText(`Key ••••${value.slice(-4)}`);
  await expect(provider(page)).not.toContainText(value);
}

async function testKey(page: Page, status: string) {
  await provider(page).getByRole('button', { name: 'Tes koneksi EODHD' }).click();
  await expect(provider(page).getByRole('region', { name: 'Hasil tes EODHD' })).toContainText(status);
}

test('saving requires 2FA, then the user enrolls through Security', async ({ page, context }) => {
  await openMarket(page);
  await provider(page)
    .getByRole('button', { name: /^(Atur|Ganti) key EODHD$/ })
    .focus();
  await page.keyboard.press('Enter');
  const required = page.getByRole('dialog', { name: 'Wajib verifikasi dua langkah' });
  await expect(required).toBeVisible();
  await expect(required.getByLabel('API key')).toHaveCount(0);
  await screenshot(page, 'market-2fa-required');
  await required.getByRole('button', { name: 'Buka Keamanan' }).click();
  await page.getByRole('button', { name: 'Aktifkan', exact: true }).click();
  const enroll = page.getByRole('dialog', { name: 'Aktifkan aplikasi autentikator' });
  await enroll.getByLabel('Kata sandi', { exact: true }).fill(password);
  await enroll.getByRole('button', { name: 'Lanjut', exact: true }).click();
  const secret = enroll.locator('code').first();
  await expect(secret).toBeVisible();
  await enterCode(page, 'Kode 6 digit', totp((await secret.innerText()).replace(/\s/g, '')));
  await enroll.getByRole('button', { name: 'Verifikasi', exact: true }).click();
  await enroll.getByLabel('Saya sudah menyimpan kode cadangan').check();
  await enroll.getByRole('button', { name: 'Selesai', exact: true }).click();
  await expect(enroll).toBeHidden();
  await context.storageState({ path: user.state });
});

test('provider errors, offline and 429 retain prices, successful sync is private, and tests are limited', async ({
  page,
  browser,
}) => {
  await openMarket(page);
  const prices = page.getByRole('region', { name: 'Harga yang dipakai' });
  const before = (await prices.textContent()) ?? '';
  await saveKey(page, 'fake-e2e-invalid');
  await testKey(page, 'Key salah');
  await expect(prices).toHaveText(before);
  await saveKey(page, 'fake-e2e-offline');
  await testKey(page, 'Gagal terhubung');
  await page.getByRole('button', { name: 'Sinkronkan harga', exact: true }).click();
  await expect(page.getByText('Gagal — memakai harga terakhir')).toBeVisible();
  await expect(prices).toHaveText(before);
  await saveKey(page, 'fake-e2e-rate-limit');
  await testKey(page, 'Limit, coba lagi s.d.');
  await page.getByRole('button', { name: 'Sinkronkan harga', exact: true }).click();
  await expect(page.getByText(/Dijeda s.d./)).toBeVisible();
  await saveKey(page, key);
  await testKey(page, 'Terhubung');
  await expect(provider(page).getByRole('region', { name: 'Hasil tes EODHD' })).toContainText('BBCA');
  await expect(provider(page).getByRole('region', { name: 'Hasil tes EODHD' })).toContainText('8.750');
  await expect(provider(page).getByRole('region', { name: 'Hasil tes EODHD' })).toContainText('TLKM');
  await testKey(page, 'Terhubung');
  await provider(page).getByRole('button', { name: 'Tes koneksi EODHD' }).click();
  await expect(provider(page)).toContainText('Batas 5 tes per jam');
  await page.getByRole('button', { name: 'Sinkronkan harga', exact: true }).click();
  await expect(page.getByText(/harga diperbarui · EODHD/)).toBeVisible();
  await expect(prices).toContainText('EODHD · 1 penutupan');
  const stored = postgres(e2eEnv()['DATABASE_URL_SUPERUSER'] ?? '', { max: 1 });
  try {
    const history = await stored<{ price: string }[]>`SELECT q.price::text AS price
      FROM user_quotes q JOIN users u ON u.id = q.user_id
      WHERE u.email = ${user.email} AND q.provider = 'eodhd' AND q.symbol = 'JKSE.INDX'
      AND q.bucket_ts = '2025-12-30T00:00:00Z'::timestamptz`;
    expect(history.map((row) => row.price)).toEqual(['900.000000000000000000']);
  } finally {
    await stored.end();
  }
  await screenshot(page, 'market-synced');

  const second = await newContext(browser, { storageState: other.state });
  const otherPage = await second.newPage();
  await openMarket(otherPage);
  await expect(provider(otherPage)).toContainText('Belum ada key');
  await expect(otherPage.getByRole('region', { name: 'Harga yang dipakai' })).not.toContainText('EODHD');
  await otherPage.getByRole('button', { name: 'Buka log API' }).click();
  await expect(otherPage.getByText('Belum ada permintaan.')).toBeVisible();
  await second.close();

  await page.getByRole('button', { name: 'Buka log API' }).click();
  const log = page.getByRole('table');
  await expect(log).toContainText('401');
  await expect(log).toContainText('tanpa respons');
  await expect(log).toContainText('429');
  await expect(log).toContainText('200');
  await expect(log).not.toContainText(key);
  await expect(log).not.toContainText('api_token');
  await screenshot(page, 'market-api-log');
  await page.getByRole('button', { name: 'Kembali ke sumber' }).click();
  await provider(page).getByRole('button', { name: 'Hapus key EODHD' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Hapus key EODHD?' });
  await expect(confirm).toContainText('harga dari EODHD ikut dihapus');
  await confirm.getByRole('button', { name: 'Hapus key', exact: true }).click();
  await expect(provider(page)).toContainText('Belum ada key');
  await expect(prices).toHaveText(before);

  const sql = postgres(e2eEnv()['DATABASE_URL_SUPERUSER'] ?? '', { max: 1 });
  try {
    const rows =
      await sql`SELECT count(*)::int AS count FROM user_quotes WHERE user_id IN (SELECT id FROM users WHERE email IN (${user.email}, ${other.email}))`;
    expect(rows[0]?.['count']).toBe(0);
  } finally {
    await sql.end();
  }
});

for (const width of [1440, 1024, 768]) {
  test(`market popup fits and keyboard closes back to the underlying page (${String(width)})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openMarket(page);
    const dialog = page.getByRole('dialog', { name: 'Pengaturan', exact: true });
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await screenshot(page, `market-${String(width)}`);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
  });
}

test('English and light/dark market settings fit desktop and both tablet widths', async ({ page }) => {
  await page.goto('/?settings=profile');
  await page.getByRole('combobox', { name: 'Bahasa', exact: true }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.keyboard.press('Escape');
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('button', { name: 'User menu' }).click();
    await page.getByRole('menuitemradio', { name: theme, exact: true }).click();
    await page.keyboard.press('Escape');
    for (const width of [1440, 1024, 768]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/?settings=market');
      const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
      await expect(dialog.getByRole('region', { name: 'IDX stocks & IHSG', exact: true })).toBeVisible();
      expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await screenshot(page, `market-en-${theme.toLowerCase()}-${String(width)}`);
      await page.keyboard.press('Escape');
    }
  }
  await page.goto('/?settings=profile');
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('id');
  await expect(page.locator('html')).toHaveAttribute('lang', 'id');
});
