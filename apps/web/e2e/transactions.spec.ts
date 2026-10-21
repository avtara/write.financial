// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Transactions (FR-L1–L6) as its own invited user with the design persona seeded, on 1–15 Oct 2026 (`?range=`, so the
 * test does not depend on today): filters and search in the URL, the By day / By category / Flat views, a bulk
 * category change, an inline edit in the detail panel, a split with Urungkan, deleting with Urungkan restoring the
 * account balance (the M1 exit criterion), keyboard-only use, and the layout at 1440 (detail beside the table),
 * 1024 (detail in a Sheet), and 768 (no Account column). The tests change the balances one after another, so they
 * compare before and after rather than to the seed.
 */
import type { Page } from '@playwright/test';
import { cardBalance, expect, projectUser, screenshot, setUpProjectUser, test } from './support.ts';

const user = projectUser('transactions');
test.describe.configure({ mode: 'serial' });
test.use({ storageState: user.state, viewport: { width: 1440, height: 1000 } });

const RANGE = '2026-10-01..2026-10-15';

test.beforeAll(async ({ browser }) => {
  await setUpProjectUser(browser, user, { persona: true });
});

/** Opens the page on 1–15 Oct with `params` and waits until it is interactive (hydrated). */
async function open(page: Page, params = '') {
  await page.goto(`/transactions?range=${RANGE}${params}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { level: 1, name: 'Transaksi' })).toBeVisible();
}

const table = (page: Page) => page.getByRole('region', { name: 'Daftar transaksi' });
/** The row of a transaction, e.g. ("Shopee", "Rak buku 5 susun"). */
const row = (page: Page, name: string, text?: string) => {
  const rows = table(page).getByRole('group', { name, exact: true });
  return text === undefined ? rows.first() : rows.filter({ hasText: text }).first();
};
const rupiah = (value: number) => `Rp${value.toLocaleString('id-ID')}`;
/** "128 transaksi di 8 rekening · …" → 128. */
async function transactionCount(page: Page): Promise<number> {
  const header = page.getByText(/^\d+ transaksi di \d+ rekening/);
  return Number((await header.innerText()).split(' ')[0]);
}

test('the summary, account cards, and the By day table show the seeded October', async ({ page }) => {
  await open(page);
  // The seed's 128 plus what the `record` project kept (dated today, 15 Okt).
  expect(await transactionCount(page)).toBeGreaterThanOrEqual(128);
  const summary = page.getByRole('region', { name: 'Ringkasan transaksi' });
  await expect(summary.getByText('+Rp26.000.000')).toBeVisible();
  await expect(summary.getByText(/^\d+ transaksi · tidak dihitung$/)).toBeVisible();
  await expect(table(page).getByText('Kamis, 15 Okt')).toBeVisible();
  await expect(table(page).getByText(/Menampilkan 100 dari \d+ transaksi/)).toBeVisible();
  await screenshot(page, 'transactions-1440');
});

test('filters and search live in the URL', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /^Kategori/ }).click();
  const popover = page.getByRole('dialog', { name: 'Kategori' });
  await popover.getByLabel('Transportasi').check();
  await popover.getByRole('button', { name: /^Tampilkan/ }).click();
  await expect(page).toHaveURL(/category=/);
  await expect(table(page).getByText('Makan & Dapur')).toHaveCount(0);
  await expect(row(page, 'Grab')).toBeVisible();

  await page.locator('body').press('/');
  const search = page.getByRole('searchbox', { name: 'Cari transaksi' });
  await expect(search).toBeFocused();
  await search.fill('kantor');
  await expect(page).toHaveURL(/q=kantor/);
  await expect(row(page, 'Gojek')).toBeVisible();
  await expect(row(page, 'Grab')).toHaveCount(0);

  // The link is shareable: a reload keeps both.
  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Cari transaksi' })).toHaveValue('kantor');
  await expect(row(page, 'Gojek')).toBeVisible();

  await search.fill('netflix-tidak-ada');
  await expect(page.getByText('Tidak ada transaksi “netflix-tidak-ada”')).toBeVisible();
  await page.getByRole('button', { name: 'Hapus semua filter' }).click();
  await expect(page).not.toHaveURL(/category=|q=/);
  await expect(row(page, 'Warteg Bahari')).toBeVisible();
});

test('switches between By day, By category, and Flat', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Per kategori' }).click();
  await expect(page).toHaveURL(/view=category/);
  await expect(
    table(page)
      .getByText(/^\d+%$/)
      .first(),
  ).toBeVisible();
  await screenshot(page, 'transactions-by-category');
  await page.getByRole('tab', { name: 'Rata' }).click();
  await expect(page).toHaveURL(/view=flat/);
  await expect(table(page).getByText('15 Okt · 12.41')).toBeVisible();
  await page.getByRole('tab', { name: 'Per hari' }).click();
  await expect(table(page).getByText('Kamis, 15 Okt')).toBeVisible();
});

test('changes the category of two transactions at once, then back', async ({ page }) => {
  await open(page);
  for (const name of ['Grab', 'Starbucks']) {
    await row(page, name).getByRole('checkbox').check();
  }
  const bar = page.getByRole('toolbar', { name: 'Aksi transaksi terpilih' });
  await expect(bar).toContainText('2');
  await bar.getByRole('button', { name: 'Ubah kategori' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ubah kategori 2 transaksi' });
  await dialog.getByRole('button', { name: 'Pilih kategori' }).click();
  await page.getByRole('option', { name: /^Hobi/ }).click();
  await dialog.getByRole('button', { name: 'Terapkan' }).click();
  await expect(page.getByText('Kategori 2 transaksi diubah')).toBeVisible();
  await expect(row(page, 'Grab')).toContainText('Hobi');
  await expect(row(page, 'Starbucks')).toContainText('Hobi');

  // Back to what the seed had, one at a time from the row menu.
  for (const [name, category] of [
    ['Grab', 'Transportasi'],
    ['Starbucks', 'Hiburan'],
  ] as const) {
    await row(page, name)
      .getByRole('button', { name: `Menu ${name}` })
      .click();
    await page.getByRole('menuitem', { name: 'Ubah kategori' }).press('ArrowRight');
    await page.getByRole('menuitemcheckbox', { name: category }).click();
    await expect(row(page, name)).toContainText(category);
  }
});

test('edits a transaction in the detail panel', async ({ page }) => {
  await open(page);
  await row(page, 'Indomaret').click();
  const panel = page.getByRole('complementary', { name: 'Detail transaksi' });
  await expect(panel.getByRole('heading', { name: 'Indomaret' })).toBeVisible();
  await expect(page).toHaveURL(/tx=/);
  await panel.getByRole('button', { name: 'Ubah' }).click();
  const note = panel.getByRole('textbox', { name: 'Catatan' });
  await note.fill('Belanja mingguan');
  await panel.getByRole('button', { name: 'Simpan perubahan' }).click();
  await expect(page.getByText('Perubahan tersimpan')).toBeVisible();
  await expect(row(page, 'Indomaret')).toContainText('Belanja mingguan');
  await screenshot(page, 'transactions-detail-1440');
});

test('splits a transaction and Urungkan puts it back', async ({ page }) => {
  await open(page);
  await row(page, 'Shopee', 'Rak buku 5 susun').click();
  const panel = page.getByRole('complementary', { name: 'Detail transaksi' });
  await panel.getByRole('button', { name: 'Pisah' }).click();
  const dialog = page.getByRole('dialog', { name: 'Pisah transaksi' });
  await dialog.getByRole('textbox', { name: 'Jumlah bagian 1' }).fill('200000');
  await dialog.getByRole('textbox', { name: 'Jumlah bagian 2' }).fill('50000');
  await dialog.getByRole('button', { name: 'Kategori bagian 2' }).click();
  await page.getByRole('option', { name: /^Hobi/ }).click();
  await dialog.getByRole('textbox', { name: 'Keterangan bagian 2' }).fill('Lampu baca');
  await expect(dialog.getByText('Sisa Rp0 · pas')).toBeVisible();
  await screenshot(page, 'transactions-split');
  await dialog.getByRole('button', { name: 'Pisah jadi 2' }).click();
  await expect(page.getByText('Transaksi dipisah jadi 2')).toBeVisible();
  await expect(row(page, 'Shopee', 'Lampu baca')).toBeVisible();
  await page.getByRole('button', { name: 'Urungkan' }).click();
  await expect(row(page, 'Shopee', 'Lampu baca')).toHaveCount(0);
  await expect(row(page, 'Shopee', 'Rak buku 5 susun')).toContainText('−Rp250.000');
});

test('deleting a transaction returns its amount to the account, and Urungkan restores the balance', async ({
  page,
}) => {
  await open(page);
  const before = await cardBalance(page, 'BCA Tahapan');
  const count = await transactionCount(page);
  await row(page, 'Shopee', 'Rak buku 5 susun').click();
  const panel = page.getByRole('complementary', { name: 'Detail transaksi' });
  await panel.getByRole('button', { name: 'Hapus' }).click();
  const dialog = page.getByRole('dialog', { name: 'Hapus transaksi ini?' });
  await expect(dialog).toContainText(`Saldo BCA Tahapan${rupiah(before)}→menjadi${rupiah(before + 250_000)}`);
  await screenshot(page, 'transactions-delete');
  await dialog.getByRole('button', { name: 'Hapus' }).click();
  await expect(page.getByText('Transaksi dihapus')).toBeVisible();
  await expect.poll(() => cardBalance(page, 'BCA Tahapan')).toBe(before + 250_000);
  await expect(page.getByText(new RegExp(`^${String(count - 1)} transaksi di`))).toBeVisible();
  await page.getByRole('button', { name: 'Urungkan' }).click();
  await expect.poll(() => cardBalance(page, 'BCA Tahapan')).toBe(before);
  await expect(page.getByText(new RegExp(`^${String(count)} transaksi di`))).toBeVisible();
});

test('works with the keyboard only', async ({ page }) => {
  await open(page);
  await page.locator('body').press('/');
  await page.keyboard.type('Warteg');
  await expect(page).toHaveURL(/q=Warteg/);
  // On a focused row, Space selects it, Escape clears the selection, and Enter opens its detail.
  const target = row(page, 'Warteg Bahari');
  await target.focus();
  await page.keyboard.press('Space');
  await expect(target.getByRole('checkbox')).toBeChecked();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Detail transaksi' })).toBeVisible();
  // `G R` and `G T` move between pages.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('g');
  await page.keyboard.press('r');
  await expect(page).toHaveURL(/\/$/);
  await page.keyboard.press('g');
  await page.keyboard.press('t');
  await expect(page).toHaveURL(/\/transactions/);
});

for (const width of [1024, 768]) {
  test(`at ${String(width)} px the detail opens as a Sheet`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await row(page, 'Indomaret').click();
    const sheet = page.getByRole('dialog', { name: 'Detail transaksi' });
    await expect(sheet.getByRole('heading', { name: 'Indomaret' })).toBeVisible();
    const account = row(page, 'Warteg Bahari').getByText('BCA Tahapan');
    if (width === 768) await expect(account).toBeHidden();
    await screenshot(page, `transactions-${String(width)}`);
    await sheet.getByRole('button', { name: 'Tutup' }).click();
    await expect(page).not.toHaveURL(/tx=/);
  });
}
