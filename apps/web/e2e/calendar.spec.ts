// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Kalender (FR-C1–C3) as the invited user with the design persona on 15 Okt 2026: Netflix's bill on the 18th as a
 * scheduled event, a day's panel, "Catat di tanggal ini" opening the record sheet on that day at 12.00, the legend,
 * the week and year views, November's projection from October's paydays, the keyboard, and the layout at 1440, 1024,
 * and 768 px. Reads only (the sheet is closed unsaved), before `subscriptions` pauses Netflix.
 */
import type { Page } from '@playwright/test';
import { expect, loadAccount, screenshot, seedDesignPersona, test, USER_STATE } from './support.ts';

test.use({ storageState: USER_STATE, viewport: { width: 1440, height: 900 } });

test.beforeAll(async () => {
  await seedDesignPersona(loadAccount('user').email);
});

/** `/calendar` (with `search`), hydrated. */
async function openCalendar(page: Page, search = ''): Promise<void> {
  await page.goto(`/calendar${search}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Kalender' })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('October shows Netflix on the 18th as a scheduled bill, with today’s panel open', async ({ page }) => {
  await openCalendar(page);
  await expect(page.getByRole('link', { name: 'Kalender' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: 'Kamis, 15 Oktober 2026' })).toBeVisible();
  const kpis = page.getByRole('region', { name: 'Ringkasan kalender' });
  await expect(kpis).toContainText('15 hari berjalan');
  const month = page.getByRole('region', { name: 'Oktober 2026', exact: true });
  await expect(month.getByRole('button', { name: /^Kamis, 1 Oktober 2026/ })).toHaveAttribute('data-surplus', 'true');
  const netflix = month.getByRole('button', { name: /^Minggu, 18 Oktober 2026/ });
  await expect(netflix).toContainText('Netflix');
  await netflix.click();
  const panel = page.getByRole('region', { name: 'Minggu, 18 Oktober 2026' });
  await expect(panel).toContainText('3 hari lagi');
  await expect(panel).toContainText(/NetflixLangganan · BCA Tahapan · terjadwal.*−Rp186\.000/);
  await expect(panel.getByRole('button', { name: 'Catat di tanggal ini' })).toHaveCount(0);
  await panel.getByRole('link', { name: 'Buka di Langganan' }).click();
  await expect(page.getByRole('dialog', { name: 'Netflix' })).toBeVisible();
});

test('"Catat di tanggal ini" opens the record sheet on that day at 12.00', async ({ page }) => {
  await openCalendar(page);
  await page
    .getByRole('region', { name: 'Oktober 2026', exact: true })
    .getByRole('button', { name: /^Minggu, 11 Oktober 2026/ })
    .click();
  const panel = page.getByRole('region', { name: 'Minggu, 11 Oktober 2026' });
  await expect(panel.getByRole('list', { name: 'Pengeluaran per kategori' })).toBeVisible();
  await panel.getByRole('button', { name: 'Catat di tanggal ini' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { level: 2 })).toHaveText(/^Catat /);
  await expect(sheet).toContainText('11 Okt 2026, 12.00');
  await screenshot(page, 'calendar-record-1440');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('works with the keyboard only: a day, the legend, and recording on it', async ({ page }) => {
  await openCalendar(page);
  const month = page.getByRole('region', { name: 'Oktober 2026', exact: true });
  await month.getByRole('button', { name: /^Senin, 5 Oktober 2026/ }).focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('region', { name: 'Senin, 5 Oktober 2026' });
  await expect(panel).toBeVisible();
  const income = month.getByRole('list', { name: 'Tampilkan di kalender' }).getByRole('button', { name: 'Pemasukan' });
  await income.focus();
  await page.keyboard.press('Space');
  await expect(income).toHaveAttribute('aria-pressed', 'false');
  await expect(month).toContainText('Pemasukan disembunyikan · hanya pengeluaran');
  await page.keyboard.press('Space');
  await expect(income).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: 'Catat di tanggal ini' }).focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('5 Okt 2026, 12.00');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('the week view: this week so far, Netflix ahead, and recording on a day', async ({ page }) => {
  await openCalendar(page, '?view=week');
  await expect(page.getByText('12–18 Okt')).toBeVisible();
  const kpis = page.getByRole('region', { name: 'Ringkasan kalender' });
  await expect(kpis).toContainText('Keluar minggu ini');
  await expect(kpis).toContainText(/TerjadwalRp186\.000Netflix/);
  const sunday = page.getByRole('listitem', { name: 'Minggu, 18 Oktober 2026' });
  await expect(sunday).toContainText(/terjadwal\s*Netflix−Rp186\.000/);
  await page.getByRole('button', { name: 'Catat di 14 Okt' }).click();
  await expect(page.getByRole('dialog')).toContainText('14 Okt 2026, 12.00');
  await page.keyboard.press('Escape');
  await screenshot(page, 'calendar-week-1440');
});

test('the year view opens a month; November shows its schedule and October’s paydays as a projection', async ({
  page,
}) => {
  await openCalendar(page, '?view=year');
  const months = page.getByRole('list', { name: 'Bulan-bulan 2026' }).getByRole('link');
  await expect(months).toHaveCount(12);
  await expect(months.nth(9)).toHaveAttribute('aria-current', 'date');
  await expect(months.nth(10)).toHaveAttribute('data-future', 'true');
  await screenshot(page, 'calendar-year-1440');
  await months.nth(10).click();
  await expect(page.getByText('Bulan belum dimulai · yang tampil adalah jadwal & proyeksi')).toBeVisible();
  const first = page
    .getByRole('region', { name: 'November 2026', exact: true })
    .getByRole('button', { name: /^Minggu, 1 November/ });
  await first.click();
  const panel = page.getByRole('region', { name: 'Minggu, 1 November 2026' });
  await expect(panel).toContainText('Perkiraan dari pola Okt. Angka pasti muncul setelah kamu mencatat transaksinya.');
  await expect(panel).toContainText(/Pemasukan rutin · proyeksi\+Rp/);
});

test('the layout holds at 1024 and 768 px', async ({ page }) => {
  for (const width of [1024, 768]) {
    await page.setViewportSize({ width, height: 900 });
    for (const search of ['', '?view=week', '?view=year']) {
      await openCalendar(page, search);
      await expect(page.getByRole('region', { name: 'Ringkasan kalender' })).toBeVisible();
      await expectNoSidewaysScroll(page);
    }
    await openCalendar(page);
    await screenshot(page, `calendar-${String(width)}`);
  }
});
