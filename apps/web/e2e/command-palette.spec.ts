// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ⌘K (FR-S4), keyboard only, as the invited user with the design persona's ledger: open with Ctrl+K, find a seeded
 * transaction by merchant, open it, find it again under "Baru dibuka", the no-results state, the `G` navigation
 * sequence, the tablet rail's search button, and a category result opening Settings › Kategori.
 */
import { expect, loadAccount, seedDesignPersona, test, USER_STATE } from './support.ts';

test.use({ storageState: USER_STATE });
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await seedDesignPersona(loadAccount('user').email);
});

const PALETTE = 'Cari atau jalankan perintah';

test('finds a seeded transaction by merchant and lists it under "Baru dibuka"', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Cari… Ctrl K' })).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: PALETTE });
  const input = dialog.getByRole('combobox');
  await expect(input).toBeFocused();
  await expect(dialog.getByRole('group', { name: 'Halaman' }).getByRole('option', { name: /Ringkasan/ })).toBeVisible();

  await page.keyboard.type('shopee');
  const transactions = dialog.getByRole('group', { name: /^Transaksi/ });
  const shopee = transactions.getByRole('option', { name: /^Shopee/ }).first();
  await expect(shopee).toContainText('Belanja Online');
  await expect(shopee).toContainText('−Rp');
  await expect(shopee).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: '/tmp/wf-cmdk-results.png' });
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();

  await page.keyboard.press('Control+k');
  const recent = dialog.getByRole('group', { name: 'Baru dibuka' });
  await expect(recent.getByRole('option', { name: /^Shopee/ }).first()).toContainText('Transaksi ·');
  await page.screenshot({ path: '/tmp/wf-cmdk-open.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('offers to create what matches nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: PALETTE });
  await expect(dialog.getByRole('combobox')).toBeFocused();
  await page.keyboard.type('cicilan motor');
  await expect(dialog.getByRole('listbox').getByText('Tidak ada hasil untuk “cicilan motor”')).toBeVisible();
  await page.screenshot({ path: '/tmp/wf-cmdk-empty.png' });
  await page.keyboard.press('Escape');
});

test('navigates with the G sequence, and opens from the tablet rail', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/settings/profile');
  await page.keyboard.press('g');
  await page.keyboard.press('r');
  await expect(page).toHaveURL(/\/$/);
  const rail = page.getByRole('complementary');
  const search = rail.getByRole('button', { name: 'Cari' });
  await search.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: PALETTE });
  await expect(dialog.getByRole('combobox')).toBeFocused();
  await page.keyboard.type('bca');
  await expect(
    dialog
      .getByRole('group', { name: /^Rekening/ })
      .getByRole('option', { name: /BCA/ })
      .first(),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();

  // A category opens Settings › Kategori.
  await page.keyboard.press('Control+k');
  await expect(dialog.getByRole('combobox')).toBeFocused();
  await page.keyboard.type('makan');
  const category = dialog.getByRole('group', { name: /^Kategori/ }).getByRole('option', { name: /Makan & Dapur/ });
  await expect(category).toBeVisible();
  for (let step = 0; step < 12 && (await category.getAttribute('aria-selected')) !== 'true'; step++) {
    await page.keyboard.press('ArrowDown');
  }
  await expect(category).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings\/categories$/);
});
