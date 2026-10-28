// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Ringkasan (FR-D1, D2, D3, D4, FR-S7, FR-TB2/TB3) as its own invited user with the design persona on 15 Okt 2026:
 * October's KPIs (Rp26.000.000 in, Rp16.500.000 out, Rp9.500.000 saved, saving rate 36,5%), the money flow, the Week
 * and Year switch with the keyboard only, the custom range 14 Sep – 13 Okt ("30 hari · melintasi 2 periode"), the
 * layout at 1440, 1024, and 768 px, the last data while offline, and last "Atur dashboard", which saves a layout and
 * leaves the defaults again when it ends.
 */
import type { Page } from '@playwright/test';
import { expect, projectUser, screenshot, setUpProjectUser, test } from './support.ts';

const user = projectUser('dashboard');
test.describe.configure({ mode: 'serial' });
test.use({ storageState: user.state, viewport: { width: 1440, height: 900 } });

test.beforeAll(async ({ browser }) => {
  await setUpProjectUser(browser, user, { persona: true });
});

/** `/` (or `path`), hydrated: the scope links respond once the Quick Add bar is interactive. */
async function openOverview(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1, name: /^Selamat (pagi|siang|sore|malam), / })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

/** No element sticks out of the page sideways. */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('October shows the persona’s KPIs, accounts, money flow, budget, calendar, and subscriptions', async ({
  page,
}) => {
  await openOverview(page);
  await expect(page.getByText('Ini ringkasan uangmu periode 1–15 Oktober 2026.')).toBeVisible();
  const kpis = page.getByRole('region', { name: 'Angka utama' });
  await expect(kpis.getByRole('group', { name: 'Pemasukan' })).toContainText('Rp26.000.000');
  await expect(kpis.getByRole('group', { name: 'Pengeluaran' })).toContainText('Rp16.500.000');
  await expect(kpis.getByRole('group', { name: 'Ditabung & Investasi' })).toContainText('Rp9.500.000');
  await expect(kpis.getByRole('group', { name: 'Saving Rate' })).toContainText('36,5%');
  await expect(kpis.getByRole('group', { name: 'Saving Rate' })).toContainText('Target 30%');
  await expect(kpis.getByRole('group', { name: 'Pengeluaran' })).toContainText('vs Sep');

  await expect(page.getByRole('region', { name: 'Rekening & dompet' })).toContainText('Rp55.023.000');
  const flow = page.getByRole('region', { name: /^Arus Uang/ });
  await expect(flow).toContainText('Pemasukan Rp26.000.000 ke');
  await expect(flow.getByRole('button', { name: /^Gaji, Rp18\.500\.000/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Anggaran Kategori' })).toContainText('lewat batas');
  await expect(page.getByRole('region', { name: 'Langganan' })).toContainText('Rp904.900');
  await expect(page.getByRole('region', { name: 'Kalender Pengeluaran' }).getByRole('grid')).toBeVisible();
  await expectNoSidewaysScroll(page);
  await screenshot(page, 'dashboard-month-1440');
});

test('Week and Year switch with the keyboard only', async ({ page }) => {
  await openOverview(page);
  const scopes = page.getByRole('navigation', { name: 'Rentang ringkasan' });
  await scopes.getByRole('link', { name: 'Minggu' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\?scope=week$/);
  await expect(page.getByText('Ini ringkasan uangmu minggu ini, 12–18 Oktober 2026.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Angka utama' })).toContainText('vs Sen–Kam lalu');
  await expect(page.getByRole('heading', { name: 'Anggaran Minggu Ini' })).toBeVisible();
  await screenshot(page, 'dashboard-week-1440');

  await scopes.getByRole('link', { name: 'Tahun' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\?scope=year$/);
  await expect(page.getByText('Ini ringkasan uangmu sepanjang 2026, Januari – Oktober.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Kalender 2026' })).toBeVisible();
  await screenshot(page, 'dashboard-year-1440');

  await scopes.getByRole('link', { name: 'Bulan' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Ini ringkasan uangmu periode 1–15 Oktober 2026.')).toBeVisible();
  // The calendar: one Tab stop, arrows move between days, Enter shows the day.
  await page
    .getByRole('region', { name: 'Kalender Pengeluaran' })
    .getByRole('button', { name: /^Kamis, 1 Oktober/ })
    .focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 3, name: 'Jumat, 2 Oktober' })).toBeVisible();
});

test('14 Sep – 13 Okt is "30 hari · melintasi 2 periode", picked with the range picker', async ({ page }) => {
  await openOverview(page);
  await page.getByRole('button', { name: /^Pilih periode: Okt 2026/ }).click();
  await page.getByRole('button', { name: /^Rentang khusus/ }).click();
  await expect(page).toHaveURL(/\?range=2026-10-01\.\.2026-10-15$/);
  await page.getByRole('button', { name: /^Rentang khusus: / }).click();
  await page.getByLabel('Dari').fill('2026-09-14');
  await page.getByLabel('Sampai').fill('2026-10-13');
  await expect(page.getByText('30 hari · melintasi 2 periode')).toBeVisible();
  await page.getByRole('button', { name: 'Terapkan' }).click();
  await expect(page).toHaveURL(/\?range=2026-09-14\.\.2026-10-13$/);
  await expect(page.getByText(/· 30 hari · melintasi 2 periode\.$/)).toBeVisible();
  await screenshot(page, 'dashboard-range-1440');
});

test('1024 stacks the paired cards and draws two levels of the money flow; 768 has no sideways scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openOverview(page);
  const flow = page.getByRole('region', { name: /^Arus Uang/ });
  await expect(flow.getByRole('button', { name: /^Kebutuhan, / })).toBeVisible();
  await expect(flow.getByRole('button', { name: /^Makan & Dapur/ })).toHaveCount(0);
  await flow.getByRole('button', { name: /^Kebutuhan, / }).focus();
  await page.keyboard.press('Enter');
  await expect(flow.getByRole('button', { name: /^Makan & Dapur/ })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Catat cepat' }).getByRole('textbox', { name: 'Catatan' })).toBeHidden();
  const cashflow = await page.getByRole('region', { name: 'Pemasukan vs Pengeluaran' }).boundingBox();
  const budget = await page.getByRole('region', { name: 'Anggaran Kategori' }).boundingBox();
  expect(budget?.y ?? 0).toBeGreaterThan((cashflow?.y ?? 0) + (cashflow?.height ?? 0) - 1);
  await expectNoSidewaysScroll(page);
  await screenshot(page, 'dashboard-1024');

  await page.setViewportSize({ width: 768, height: 1024 });
  await openOverview(page);
  await expect(page.getByRole('region', { name: 'Angka utama' })).toBeVisible();
  await expectNoSidewaysScroll(page);
  await screenshot(page, 'dashboard-768');
});

test('offline, the last data stays available', async ({ page, context }) => {
  await openOverview(page);
  await context.setOffline(true);
  await page.getByRole('navigation', { name: 'Rentang ringkasan' }).getByRole('link', { name: 'Minggu' }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Kamu sedang offline' });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('NETWORK_OFFLINE');
  await alert.getByRole('button', { name: /^Lihat data terakhir · 15 Okt/ }).click();
  await expect(page.getByText(/^Kamu sedang offline · menampilkan data terakhir dari 15 Okt/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Angka utama' })).toContainText('Rp26.000.000');
  await screenshot(page, 'dashboard-offline-1440');
  await context.setOffline(false);
});

test('"Atur dashboard" saves hidden, resized, and added cards across a reload; Reset and "Urungkan" work', async ({
  page,
}) => {
  await openOverview(page);
  const bar = page.getByRole('region', { name: 'Mode atur dashboard' });
  const subscriptions = page.getByRole('region', { name: 'Langganan', exact: true });
  const goals = page.getByRole('region', { name: 'Tujuan tabungan', exact: true });
  const widthOf = async (name: string) =>
    (await page.getByRole('region', { name, exact: true }).boundingBox())?.width ?? 0;
  await expect(subscriptions).toBeVisible();
  expect(await widthOf('Anggaran Kategori')).toBeLessThan((await widthOf('Rekening & dompet')) / 2);

  await page.getByRole('button', { name: 'Atur dashboard' }).click();
  await expect(bar).toBeVisible();
  await page.getByRole('button', { name: 'Sembunyikan Langganan' }).click();
  await page.getByRole('radiogroup', { name: 'Lebar Anggaran Kategori' }).getByRole('radio', { name: 'Penuh' }).click();
  await page.getByRole('button', { name: 'Tambah Tujuan tabungan' }).click();
  await expect(bar).toContainText('Tersembunyi: 1');
  await screenshot(page, 'dashboard-customize-1440');
  await bar.getByRole('button', { name: 'Simpan tata letak' }).click();
  await expect(bar).toBeHidden();
  // The added card reads its data once saved: the persona's goals.
  await expect(goals).toContainText('Dana Darurat');
  await expect(subscriptions).toHaveCount(0);

  // Saved to the account: the same after a reload.
  await openOverview(page);
  await expect(goals).toContainText('Dana Darurat');
  await expect(subscriptions).toHaveCount(0);
  expect(await widthOf('Anggaran Kategori')).toBeGreaterThan((await widthOf('Rekening & dompet')) * 0.9);

  // Reset to the defaults, then "Urungkan" brings the saved layout back.
  await page.getByRole('button', { name: 'Atur dashboard' }).click();
  await bar.getByRole('button', { name: 'Reset ke default' }).click();
  await bar.getByRole('button', { name: 'Simpan tata letak' }).click();
  await expect(subscriptions).toBeVisible();
  await expect(goals).toHaveCount(0);
  await page.getByRole('region', { name: 'Notifikasi', exact: true }).getByRole('button', { name: 'Urungkan' }).click();
  await expect(page.getByText('Tata letak sebelumnya dikembalikan')).toBeVisible();
  await expect(subscriptions).toHaveCount(0);
  await expect(goals).toContainText('Dana Darurat');

  // Leave the defaults for the next run.
  await page.getByRole('button', { name: 'Atur dashboard' }).click();
  await bar.getByRole('button', { name: 'Reset ke default' }).click();
  await bar.getByRole('button', { name: 'Simpan tata letak' }).click();
  await expect(subscriptions).toBeVisible();
});
