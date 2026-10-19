// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Kategori and Settings › Tag (FR-K1–K3) as the invited user from `m0`: create, rename, merge, and delete
 * a category with the keyboard only at 1440 px; create two look-alike tags and merge them from the similar-tags
 * suggestion at 1024 px; and the categories layout at 768 px. The spec makes its own data, so it does not depend on
 * the design seed.
 */
import type { Page } from '@playwright/test';
import { expect, screenshot, test, USER_STATE } from './support.ts';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: USER_STATE });

const row = (page: Page, name: string) =>
  page.getByRole('region', { name: 'Kategori', exact: true }).getByRole('listitem').filter({ hasText: name });

/** Opens "Kategori baru" from the keyboard, types the name, and submits with Enter. */
async function createCategory(page: Page, name: string) {
  await page.getByRole('button', { name: 'Kategori baru' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Kategori baru' });
  await expect(dialog).toBeVisible();
  // Focus starts on the type ("Pengeluaran"); the name is the next field.
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Nama kategori')).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(row(page, name)).toBeVisible();
}

/** Opens a row's ⋯ menu from the keyboard and picks the item whose label starts with `letter` (typeahead). */
async function openMenuItem(page: Page, name: string, item: string) {
  await page.getByRole('button', { name: `Menu ${name}` }).focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  for (let step = 0; step < 8; step++) {
    if (await menu.getByRole('menuitem', { name: item }).evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press('ArrowDown');
  }
  await expect(menu.getByRole('menuitem', { name: item })).toBeFocused();
  await page.keyboard.press('Enter');
}

test('a category is created, renamed, merged, and deleted with the keyboard only (1440)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/settings/categories');
  // Hydrated: the controls below answer the keyboard.
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Kategori', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Pengeluaran · \d+$/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Biaya keuangan' }).getByText('Sistem').first()).toBeVisible();

  await createCategory(page, 'Kursus');
  await screenshot(page, 'categories-created');

  await openMenuItem(page, 'Kursus', 'Edit kategori');
  const edit = page.getByRole('dialog', { name: 'Edit kategori' });
  await expect(edit.getByLabel('Nama kategori')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Kursus Bahasa');
  await page.keyboard.press('Enter');
  await expect(edit).toBeHidden();
  await expect(row(page, 'Kursus Bahasa')).toBeVisible();

  await createCategory(page, 'Kursus Musik');
  await openMenuItem(page, 'Kursus Musik', 'Gabungkan dengan…');
  const merge = page.getByRole('dialog', { name: 'Gabungkan Kursus Musik' });
  await expect(merge.getByRole('combobox', { name: 'Gabungkan ke' })).toBeFocused();
  await page.keyboard.press('Enter');
  const option = page.getByRole('option', { name: /Kursus Bahasa/ });
  for (let step = 0; step < 40; step++) {
    if (await option.evaluate((node) => node === document.activeElement || node.hasAttribute('data-highlighted')))
      break;
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Enter');
  await expect(merge.getByRole('status')).toContainText('dipindah dari Kursus Musik ke Kursus Bahasa');
  await screenshot(page, 'categories-merge');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(merge.getByRole('button', { name: 'Gabungkan' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(merge).toBeHidden();
  await expect(page.getByText('Kursus Musik digabung ke Kursus Bahasa')).toBeVisible();
  await expect(row(page, 'Kursus Musik')).toHaveCount(0);

  await openMenuItem(page, 'Kursus Bahasa', 'Hapus kategori');
  const confirm = page.getByRole('alertdialog', { name: 'Hapus kategori Kursus Bahasa?' });
  await expect(confirm.getByText('Kategori ini belum dipakai. Tindakan ini tidak bisa dibatalkan.')).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Batal' })).toBeFocused();
  await screenshot(page, 'categories-delete');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(confirm).toBeHidden();
  await expect(page.getByText('Kursus Bahasa dihapus')).toBeVisible();
  await expect(row(page, 'Kursus Bahasa')).toHaveCount(0);
});

test('two look-alike tags are merged from the suggestion (1024)', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/settings/tags');
  // Hydrated: the controls below answer the keyboard.
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Tag', exact: true })).toBeVisible();
  for (const input of ['Reimburse', '#Reimburse Kantor']) {
    await page.getByRole('button', { name: 'Tag baru' }).click();
    const field = page.getByRole('textbox', { name: 'Nama tag baru' });
    await field.fill(input);
    await expect(page.getByText(/^Disimpan sebagai #reimburse/)).toBeVisible();
    await field.press('Enter');
    await expect(field).toBeHidden();
  }
  const suggestion = page.getByRole('region', { name: /tag terlihat sama/ }).filter({ hasText: '#reimburse-kantor' });
  await expect(suggestion).toBeVisible();
  await screenshot(page, 'tags-similar');
  await suggestion.getByRole('button', { name: 'Tinjau & gabungkan' }).click();
  await expect(page.getByRole('heading', { name: 'Gabungkan tag' })).toBeVisible();
  await expect(page.getByText('#reimburse-kantor dihapus dan menjadi nama lain dari #reimburse')).toBeVisible();
  await screenshot(page, 'tags-merge');
  await page.getByRole('button', { name: 'Gabungkan 2 tag' }).click();
  await expect(page.getByText('2 tag digabung ke #reimburse')).toBeVisible();
  const merged = page.getByRole('list', { name: 'Daftar tag' }).getByRole('listitem').filter({ hasText: 'reimburse' });
  await expect(merged).toHaveCount(1);
  await expect(merged).toContainText('juga dikenali: #reimburse-kantor');
  await expect(page.getByRole('region', { name: /tag terlihat sama/ }).filter({ hasText: '#reimburse' })).toHaveCount(
    0,
  );
});

test('the categories layout fits the tablet width (768)', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/settings/categories');
  // Hydrated: the controls below answer the keyboard.
  await page.waitForLoadState('networkidle');
  await expect(
    page.getByRole('navigation', { name: 'Bagian pengaturan' }).getByRole('link', { name: 'Tag' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kategori baru' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await screenshot(page, 'categories-768');
});
