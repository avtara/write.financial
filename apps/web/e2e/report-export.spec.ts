// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Report export (FR-LP3, design yLlRY) as its own invited user with the design persona on 15 Okt 2026: the Ekspor
 * dialog previews "4 halaman · A4" from the chosen sections, and the worker job run inline (`report-export-jobs.ts`)
 * renders a real PDF with chromium, stores it, and the saved list downloads it (FR-LP4's saved reports).
 */
import { readFileSync } from 'node:fs';
import { expect, projectUser, runExportJob, runReportJobs, screenshot, setUpProjectUser, test } from './support.ts';

const user = projectUser('report-export');
test.describe.configure({ mode: 'serial' });
test.use({ storageState: user.state, viewport: { width: 1440, height: 1024 } });

test.beforeAll(async ({ browser }) => {
  await setUpProjectUser(browser, user, { persona: true });
  // No worker runs in the E2E stack: the reports job publishes September, the export job stores its PDF.
  expect(runReportJobs(user.email).generated).toBe(1);
  expect(runExportJob(user.email, 'pdf').stored).toBe(1);
});

test('previews the page count and downloads the real PDF', async ({ page }) => {
  // The inline chromium render plus its retries exceed the default minute.
  test.setTimeout(150_000);
  await page.goto('/reports');
  await expect(page.getByRole('heading', { level: 1, name: 'Laporan' })).toBeVisible();
  await expect(page.locator('header p')).toContainText('September 2026');
  await page.getByRole('button', { name: /Ekspor laporan/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Ekspor laporan' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('4 halaman · A4');
  await expect(dialog).toContainText('Ringkasan & kekayaan bersih');
  await expect(dialog).toContainText('Arus uang & pemasukan');
  await expect(dialog).toContainText('Transaksi terbesar & langganan');
  await expect(dialog).toContainText('Samarkan nomor rekening');
  await screenshot(page, 'report-export-dialog');
  await dialog.getByRole('button', { name: 'Batal' }).click();
  await expect(dialog).toBeHidden();

  // The saved list offers it as a download.
  const saved = page.getByRole('region', { name: 'Laporan tersimpan' });
  // The saved-files rows name the file (Laporan-2026-09.pdf); the format label may stay lowercase.
  await expect(saved).toContainText(/\.pdf|PDF/);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    saved.getByRole('link', { name: /Unduh/ }).first().click(),
  ]);
  const filePath = await download.path();
  const head = readFileSync(filePath).subarray(0, 5).toString('latin1');
  expect(head).toBe('%PDF-');
  const body = readFileSync(filePath).toString('latin1');
  // Exactly the four previewed sections — one page each.
  expect(body.match(/\/Type\s*\/Page[^s]/g)?.length).toBe(4);
});
