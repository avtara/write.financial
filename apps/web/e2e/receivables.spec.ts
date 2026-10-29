// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Piutang (FR-U7, FR-L5) as its own invited user with the design persona on 15 Okt 2026: the Receivables tab of
 * Section 19 (KZZZy, Rp542.500), then the exit scenario — "Catat piutang" Bima Aditya Rp500.000 from BCA (H7g1A) →
 * receivables Rp1.042.500, BCA Rp42.310.000, October spending still Rp16.500.000; "Terima pembayaran" Raka Rp200.000
 * into GoPay (ivnWw) → Rp100.000 left (75%), October income still Rp26.000.000 — a bill split with Nadia from the
 * Record sheet (IGHyP), the layout at 1440, 1024, and 768 px, and the tab in English on the light theme.
 */
import type { Locator, Page } from '@playwright/test';
import { cardBalance, expect, openUserMenu, projectUser, screenshot, setUpProjectUser, test } from './support.ts';

const user = projectUser('receivables');
test.describe.configure({ mode: 'serial' });
test.use({ storageState: user.state, viewport: { width: 1440, height: 1024 } });

test.beforeAll(async ({ browser }) => {
  await setUpProjectUser(browser, user, { persona: true });
});

/** `/debts?tab=receivables`, hydrated. */
async function openReceivables(page: Page): Promise<void> {
  await page.goto('/debts?tab=receivables');
  await expect(page.getByRole('heading', { level: 1, name: 'Utang & cicilan' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('tab', { name: /^Piutang/ })).toHaveAttribute('aria-selected', 'true');
}

/** The Overview's KPI group `name` ("Pemasukan", "Pengeluaran"). */
async function overviewKpi(page: Page, name: string): Promise<Locator> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  return page.getByRole('region', { name: 'Angka utama' }).getByRole('group', { name });
}

test('Section 19: the active receivables, the 90-day history, and how they are counted (KZZZy)', async ({ page }) => {
  await openReceivables(page);
  await expect(page.getByText('Bebas utang · 2 piutang aktif Rp542.500')).toBeVisible();
  const kpis = page.getByRole('region', { name: 'Ringkasan utang' });
  await expect(kpis).toContainText('Jatuh tempo terdekat18 OktNadia · piutang Rp242.500');
  await expect(kpis).toContainText('PiutangRp542.5002 orang · 1 jatuh tempo 3 hari lagi');
  await expect(page.getByText(/^Piutang = uangmu yang ada di orang lain/)).toBeVisible();
  const nadia = page.getByRole('article', { name: 'Nadia' });
  await expect(nadia).toContainText('3 hari lagi');
  await expect(nadia).toContainText('Pisah tagihan · Nonton bareng CGV Grand Indonesia · 15 Okt · dari BCA Tahapan');
  await expect(nadia).toContainText('Jatuh tempo Min, 18 Okt · pengingat H-1 jam 09.00');
  const raka = page.getByRole('article', { name: 'Raka Pratama' });
  await expect(raka).toContainText('Sebagian');
  await expect(raka).toContainText('Rp300.000dari Rp400.000 · 25,00% kembali');
  await expect(raka).toContainText('terakhir dibayar Rp100.000 pada 10 Okt');
  const history = page.getByRole('region', { name: 'Lunas · 90 hari' });
  await expect(history).toContainText('DimasPatungan kado · Rp150.000lunas 2 Okt ke GoPay');
  await expect(history).toContainText('Sari');
  await expect(page.getByRole('complementary', { name: 'Cara write.financial menghitung' })).toContainText(
    'Memberi pinjaman dicatat sebagai transfer ke piutang, bukan pengeluaran.',
  );
  await screenshot(page, 'receivables-list-1440');
});

test('exit: Bima Aditya Rp500.000 from BCA → receivables Rp1.042.500, BCA Rp42.310.000, spending unchanged (H7g1A)', async ({
  page,
}) => {
  await openReceivables(page);
  await page.getByRole('button', { name: 'Catat piutang' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Catat piutang' });
  await expect(dialog).toContainText('pernah:Nadia·Raka Pratama·Dimas');
  await dialog.getByRole('combobox', { name: 'Siapa' }).fill('Bima Aditya');
  await dialog.getByRole('textbox', { name: 'Jumlah' }).fill('500000');
  await dialog.getByRole('textbox', { name: 'Catatan' }).fill('Pinjam untuk servis motor');
  await expect(dialog.getByRole('button', { name: 'Akhir bulan · 31 Okt' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('switch', { name: /Ingatkan aku H-1 jam 09\.00/ })).toBeChecked();
  const after = dialog.getByRole('region', { name: 'Setelah disimpan' });
  await expect(after).toContainText('Saldo BCA Tahapan42.810.00042.310.000');
  await expect(after).toContainText('Piutang542.5001.042.500');
  await expect(after).toContainText('Pengeluaran Oktober16.500.000tetap');
  await expect(after).toContainText('Kekayaan bersih');
  await screenshot(page, 'receivables-record-1440');
  await dialog.getByRole('button', { name: 'Catat piutang' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Piutang Bima Aditya dicatat')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ringkasan utang' })).toContainText('PiutangRp1.042.500');
  await expect(page.getByRole('article', { name: 'Bima Aditya' })).toContainText('Jatuh tempo Sab, 31 Okt');

  await page.goto('/transactions');
  await page.waitForLoadState('networkidle');
  expect(await cardBalance(page, 'BCA Tahapan')).toBe(42_310_000);
  await expect(await overviewKpi(page, 'Pengeluaran')).toContainText('Rp16.500.000');
});

test('exit: Raka pays Rp200.000 into GoPay → Rp100.000 left (75%), income unchanged (ivnWw)', async ({ page }) => {
  await openReceivables(page);
  await page.getByRole('article', { name: 'Raka Pratama' }).getByRole('button', { name: 'Terima pembayaran' }).click();
  const dialog = page.getByRole('dialog', { name: 'Terima pembayaran · Raka Pratama' });
  await expect(dialog).toContainText('Sisa Rp300.000 dari Rp400.000 · tempo 31 Okt');
  await dialog.getByRole('button', { name: 'Rp200.000', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Masuk ke' })).toContainText('GoPay');
  const after = dialog.getByRole('region', { name: 'Setelah disimpan' });
  await expect(after).toContainText('Sisa piutang Raka300.000100.000');
  await expect(after).toContainText('Saldo GoPay412.000612.000');
  await expect(after).toContainText('Pemasukan Oktober26.000.000tetap');
  await expect(after).toContainText('75,00% kembali · sisa Rp100.000 tetap jatuh tempo 31 Okt');
  await screenshot(page, 'receivables-receive-1440');
  await dialog.getByRole('button', { name: 'Terima Rp200.000' }).click();
  await expect(dialog).not.toBeVisible();
  const raka = page.getByRole('article', { name: 'Raka Pratama' });
  await expect(raka).toContainText('Rp100.000dari Rp400.000 · 75,00% kembali');
  await expect(page.getByRole('region', { name: 'Ringkasan utang' })).toContainText('PiutangRp842.500');
  await expect(await overviewKpi(page, 'Pemasukan')).toContainText('Rp26.000.000');
});

test('a bill split with Nadia: only the user’s half is spending, Nadia’s half a receivable (IGHyP)', async ({
  page,
}) => {
  await openReceivables(page);
  await page.locator('body').press('n');
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('textbox', { name: 'Jumlah' })).toBeFocused();
  await page.keyboard.type('485000');
  await sheet.getByRole('button', { name: 'Makan & Dapur' }).click();
  await sheet.getByRole('textbox', { name: 'Catatan' }).fill('Sate Khas Senayan');
  await sheet.getByRole('button', { name: /Pisah tagihan/ }).click();
  const split = page.getByRole('dialog', { name: 'Pisah tagihan' });
  await split.getByRole('combobox', { name: 'Nama orang ke-2' }).fill('Nadia');
  await expect(split.getByRole('list', { name: 'Orang' })).toContainText('jadi piutang · jatuh tempo 22 Okt');
  await expect(split.getByRole('status')).toContainText('Total cocok: 242.500 + 242.500 = 485.000');
  const after = split.getByRole('region', { name: 'Setelah disimpan' });
  await expect(after).toContainText('Pengeluaran Oktober16.985.00016.742.500');
  await expect(after).toContainText('Batas aman harian');
  await expect(after).toContainText('PiutangRp842.500Rp1.085.000');
  await screenshot(page, 'receivables-split-1440');
  await split.getByRole('button', { name: 'Simpan pembagian' }).click();
  await expect(split).not.toBeVisible();
  await expect(page.getByText('1 piutang dicatat di Utang & cicilan')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ringkasan utang' })).toContainText('PiutangRp1.085.000');
  await expect(await overviewKpi(page, 'Pengeluaran')).toContainText('Rp16.742.500');
});

for (const width of [1440, 1024, 768]) {
  test(`the Piutang tab fits ${String(width)} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1024 });
    await openReceivables(page);
    await expect(page.getByRole('region', { name: 'Piutang aktif' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await screenshot(page, `receivables-${String(width)}`);
  });
}

test('the Piutang tab in English on the light theme', async ({ page }) => {
  await openReceivables(page);
  await openUserMenu(page);
  await page.getByRole('menuitemradio', { name: 'Terang' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await openUserMenu(page);
  const saved = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname.startsWith('/_serverFn/'),
  );
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  expect((await saved).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole('tab', { name: /^Receivables/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('complementary', { name: 'How write.financial calculates' })).toBeVisible();
  await screenshot(page, 'receivables-en-light-1440');
  await page.getByRole('article', { name: 'Raka Pratama' }).getByRole('button', { name: 'Receive payment' }).click();
  await expect(page.getByRole('dialog', { name: 'Receive payment · Raka Pratama' })).toContainText(
    'Incoming transfer, not income',
  );
  await screenshot(page, 'receivables-en-light-receive-1440');
});
