// SPDX-License-Identifier: AGPL-3.0-only
/** FR-I1–I5 and FR-G2/G5/G6, design 09/13: an isolated persona with no market credentials. */
import type { Page } from '@playwright/test';
import { expect, projectUser, screenshot, setUpProjectUser, test } from './support.ts';

const user = projectUser('investments');
test.describe.configure({ mode: 'serial' });
test.use({ storageState: user.state, viewport: { width: 1440, height: 1024 } });
test.beforeAll(async ({ browser }) => {
  await setUpProjectUser(browser, user, { persona: true });
});

async function open(page: Page) {
  await page.goto('/investments');
  await expect(page.getByRole('heading', { level: 1, name: 'Investasi' })).toBeVisible();
  await page.waitForLoadState('networkidle');
}
async function assetMenu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Menu SPY', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

test('golden valuation, honest missing returns, USD toggle, search and class grouping', async ({ page }) => {
  await open(page);
  const summary = page.getByRole('region', { name: 'Ringkasan investasi' });
  await expect(summary).toContainText('Nilai portofolioRp61.420.000');
  await expect(summary).toContainText('ModalRp53.931.000');
  await expect(summary).toContainText('+Rp7.489.000');
  await expect(summary).toContainText('Dividen 12 bulanRp0');
  await expect(page.getByRole('region', { name: 'Alokasi aset' })).toContainText('3,8%');
  await expect(page.getByRole('region', { name: 'Pertumbuhan portofolio' })).toContainText('Portofolio—SPY—IHSG—');
  await page.getByRole('button', { name: 'USD', exact: true }).click();
  await expect(summary).toContainText('Nilai portofolioUS$3.756,57');
  await page.getByRole('button', { name: 'IDR', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Cari ticker atau nama' }).fill('yield');
  await expect(page.getByText('YieldMax', { exact: true })).toBeVisible();
  await screenshot(page, 'investments-search');
  await page.getByRole('searchbox', { name: 'Cari ticker atau nama' }).fill('');
  await page.getByRole('group', { name: 'Kelompokkan' }).getByRole('button', { name: 'Kelas aset', exact: true }).click();
  await expect(page.getByRole('table')).toContainText('Kripto');
  await page.getByRole('group', { name: 'Kelompokkan' }).getByRole('button', { name: 'Daftar saya', exact: true }).click();
  await screenshot(page, 'investments-1440');
});

test('providers off retain manual values, report source outcomes and open the real API log', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Menu SPY', exact: true }).click();
  await page.getByRole('menuitem', { name: /Ubah detail aset/ }).click();
  const asset = page.getByRole('dialog', { name: 'Ubah detail aset' });
  await asset.getByRole('combobox', { name: 'Sumber harga', exact: true }).click();
  await page.getByRole('option', { name: 'Bawaan server', exact: true }).click();
  await asset.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(asset).toBeHidden();
  await page.getByRole('button', { name: 'Sinkronkan', exact: true }).click();
  const sources = page.getByRole('region', { name: 'Sinkronisasi sumber harga' });
  await expect(sources).toContainText('Tanpa key — memakai harga manual atau terakhir');
  await expect(page.getByRole('button', { name: 'Sinkronkan', exact: true })).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Ringkasan investasi' })).toContainText('Rp61.420.000');
  await sources.getByRole('button', { name: 'Buka log API', exact: true }).click();
  const log = page.getByRole('dialog', { name: 'Log permintaan' });
  await expect(log).toContainText('Belum ada permintaan.');
  await screenshot(page, 'investments-providers-off-log');
  await log.getByRole('button', { name: 'Tutup', exact: true }).click();
});

test('buy with fee/tax from platform cash, DCA split, and persisted history', async ({ page }) => {
  await open(page);
  await assetMenu(page, 'Beli lagi');
  const sheet = page.getByRole('dialog', { name: 'Catat transaksi investasi' });
  await sheet.getByRole('textbox', { name: 'Jumlah (USD)' }).fill('50,00');
  await sheet.getByRole('textbox', { name: 'Biaya admin', exact: true }).fill('0,15');
  await sheet.getByRole('textbox', { name: 'Pajak', exact: true }).fill('0,02');
  await expect(sheet).toContainText('US$50,17');
  await expect(sheet).toContainText('Rp820.280');
  await expect(sheet).toContainText('DP Rumah');
  await expect(sheet).toContainText('Dana Pensiun');
  await screenshot(page, 'investments-buy');
  await sheet.getByRole('button', { name: 'Simpan beli' }).click();
  await expect(sheet).toBeHidden();
  await page.reload();
  await assetMenu(page, 'Lihat detail');
  const detail = page.getByRole('dialog', { name: 'SPY · SPDR S&P 500 ETF' });
  await expect(detail).toContainText('0,0725');
  await expect(detail).toContainText('60%');
  await expect(detail).toContainText('40%');
  await screenshot(page, 'investments-spy-detail');
});

test('partial sale requires a goal, validates its capacity and persists the chosen reduction', async ({ page }) => {
  await open(page);
  await assetMenu(page, 'Jual');
  const sheet = page.getByRole('dialog', { name: 'Catat transaksi investasi' });
  await sheet.getByRole('button', { name: '50%', exact: true }).click();
  await sheet.getByRole('button', { name: 'Simpan jual' }).click();
  await expect(sheet.getByRole('alert')).toContainText('Pilih tujuan yang dikurangi');
  await sheet.getByRole('radio', { name: 'Kurangi dari Dana Pensiun' }).check();
  await expect(sheet.getByRole('alert')).toContainText('Penjualan melebihi unit tujuan yang dipilih');
  await sheet.getByRole('button', { name: '25%', exact: true }).click();
  await expect(sheet.getByRole('alert')).toBeHidden();
  await screenshot(page, 'investments-sell-goal-choice');
  await sheet.getByRole('button', { name: 'Simpan jual' }).click();
  await expect(sheet).toBeHidden();
  await page.reload();
  await assetMenu(page, 'Lihat detail');
  const detail = page.getByRole('dialog', { name: 'SPY · SPDR S&P 500 ETF' });
  await expect(detail).toContainText('80%');
  await expect(detail).toContainText('20%');
  await expect(detail).toContainText('Jual & koreksi');
});

test('targets cannot exceed 100%, and goal asset sources cannot exceed other goals shares', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Atur target', exact: true }).click();
  const targets = page.getByRole('dialog', { name: 'Target alokasi' });
  await targets.getByRole('textbox', { name: 'Target Kripto', exact: true }).fill('8');
  await expect(targets.getByRole('button', { name: 'Simpan target' })).toBeDisabled();
  await targets.getByRole('button', { name: 'Ambil 1,0% dari Saham AS' }).click();
  await targets.getByRole('button', { name: 'Simpan target' }).click();
  await expect(targets).toBeHidden();
  await page.goto('/goals');
  await page.getByRole('button', { name: 'Menu DP Rumah', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Ubah tujuan', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByRole('textbox', { name: 'Persentase SPY', exact: true }).fill('90');
  await form.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(form).toContainText('Melebihi 100%');
  await screenshot(page, 'investments-goal-source-validation');
});

test('unavailable prices value the holding at cost and allow account-only goals', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Menu SPY', exact: true }).click();
  await page.getByRole('menuitem', { name: /Ubah detail aset/ }).click();
  const asset = page.getByRole('dialog', { name: 'Ubah detail aset' });
  await asset.getByRole('textbox', { name: 'Harga manual (USD)', exact: true }).fill('');
  await asset.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(asset).toBeHidden();
  await expect(page.getByRole('status', { name: 'Status harga pasar' })).toContainText('SPY belum punya harga, dinilai dengan harga modal.');
  await page.goto('/goals');
  await page.getByRole('button', { name: 'Lihat saldo rekening saja', exact: true }).click();
  const dp = page.getByRole('region', { name: 'Tujuan tabungan' }).getByRole('listitem').filter({ hasText: 'DP Rumah' });
  await expect(dp).toContainText('Rp5.000.000');
  await screenshot(page, 'investments-goals-account-only');
  await page.getByRole('button', { name: 'Hitung lagi dengan investasi', exact: true }).click();
  await expect(dp).not.toContainText('Rp5.000.000');
});

for (const width of [1024, 768]) {
  test(`responsive investment layout at ${String(width)}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1024 });
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await screenshot(page, `investments-${String(width)}`);
  });
}

test('light English and privacy views preserve usable chart and sheet controls', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Menu pengguna', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Terang', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Menu pengguna', exact: true }).click();
  const saved = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.startsWith('/_serverFn/'));
  await page.getByRole('menuitemradio', { name: 'English', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByRole('heading', { level: 1, name: 'Investments' })).toBeVisible();
  await screenshot(page, 'investments-light-en');
  await page.getByRole('button', { name: 'User menu', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Hide balances', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Investment summary' })).not.toContainText('61,420,000');
  await screenshot(page, 'investments-private');
});
