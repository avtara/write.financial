// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Laporan (FR-LP1, LP2, LP5) as its own invited user with the design persona on 15 Okt 2026: the final September
 * monthly (25.800.000 / 18.300.000 / +7.500.000 / 29,1% / kekayaan bersih 112.223.000 per 30 Sep, 121 transaksi),
 * the quarter and custom switchers as Sementara aggregates, the honest goal positions from the dated snapshots, and
 * the new-user timeline. Read-only: the spec changes nothing.
 */
import type { Page } from '@playwright/test';
import { expect, projectUser, runReportJobs, screenshot, setUpProjectUser, test } from './support.ts';

const user = projectUser('reports');
const freshUser = projectUser('reports-fresh');
test.describe.configure({ mode: 'serial' });
test.use({ storageState: user.state, viewport: { width: 1440, height: 1024 } });

test.beforeAll(async ({ browser }) => {
  await setUpProjectUser(browser, user, { persona: true });
  // The plain (non-persona) user for the empty timeline.
  await setUpProjectUser(browser, freshUser, { persona: false });
  // No worker runs in the E2E stack: the reports job that would have published September's report runs here.
  expect(runReportJobs(user.email).generated).toBe(1);
});

async function open(page: Page): Promise<void> {
  await page.goto('/reports');
  await expect(page.getByRole('heading', { level: 1, name: 'Laporan' })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

test('shows the final September monthly with the seed goldens', async ({ page }) => {
  await open(page);
  const header = page.locator('header p').filter({ hasText: '121 transaksi' });
  await expect(header).toContainText('September 2026');
  await expect(header).toContainText('1–30 Sep');
  // Only September is closed for this persona, so no compare line: previous stays null, never an invented August.
  await expect(header).not.toContainText('dibandingkan');
  await expect(header).toContainText('121 transaksi');
  await expect(header).toContainText('Final');
  await expect(page.getByText('Rp25.800.000').first()).toBeVisible();
  await expect(page.getByText('Rp18.300.000').first()).toBeVisible();
  // The delta context formats without the currency symbol (the tile label names the currency).
  await expect(page.getByText('+7.500.000').first()).toBeVisible();
  await expect(page.getByText('29,1%').first()).toBeVisible();
  await expect(page.getByText('Rp112.223.000').first()).toBeVisible();
  await screenshot(page, 'reports-september');

  // The final report never changes, however many times it is reopened.
  await page.reload();
  await expect(header).toContainText('September 2026');
  await expect(page.getByText('Rp25.800.000').first()).toBeVisible();
});

test('reports goal positions from the dated snapshot, not current values', async ({ page }) => {
  await open(page);
  const goals = page.getByRole('region', { name: /Tujuan/i });
  await expect(goals).toContainText('30 Sep');
  await expect(goals).toContainText('Dana Darurat');
  await expect(goals).toContainText('7.625.000');
  await screenshot(page, 'reports-goals');
});

test('switches to the quarter and a custom range as provisional aggregates', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Kuartal' }).click();
  await page.getByRole('button', { name: 'Q3 2026', exact: true }).click();
  await expect(page.locator('header p').getByText('Sementara')).toBeVisible();
  await screenshot(page, 'reports-quarter');

  await page.getByRole('button', { name: 'Kustom' }).click();
  await page.getByLabel('Dari tanggal').fill('2026-10-01');
  await page.getByLabel('s.d.').fill('2026-10-15');
  await page.getByRole('button', { name: 'Terapkan' }).click();
  await expect(page.locator('header p').getByText('Sementara')).toBeVisible();
  await expect(page.locator('header p')).toContainText('1–15 Okt');
  await screenshot(page, 'reports-custom');
});

test('greet a new user with the timeline to the first report', async ({ page, browser }) => {
  const context = await (browser as unknown as { newContext(o: object): Promise<unknown> }).newContext({
    storageState: freshUser.state,
    viewport: { width: 1440, height: 1024 },
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
  });
  const page2 = await (context as unknown as { newPage(): Promise<Page> }).newPage();
  await page2.goto('/reports');
  await expect(page2.getByRole('heading', { level: 1, name: 'Laporan' })).toBeVisible();
  await expect(page2.getByText('Laporan pertamamu sedang menunggu periode pertama')).toBeVisible();
  await expect(page2.getByText('Mulai mencatat')).toBeVisible();
  await screenshot(page2, 'reports-empty');
  await context.close?.();
});
