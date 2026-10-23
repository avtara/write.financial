// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Rekening & dompet" (M1, FR-R1–R6) as its own invited user with the design persona seeded: the available balance of
 * the 128 seed transactions, adding an account, reconciling with a correction, archive and restore, and the layout
 * at 1440 (inline detail panel), 1024 (rail + Sheet), and 768.
 */
import type { Page } from '@playwright/test';
import { expect, projectUser, screenshot, setUpProjectUser, test } from './support.ts';

const user = projectUser('accounts');
test.describe.configure({ mode: 'serial' });
test.use({ storageState: user.state });

test.beforeAll(async ({ browser }) => {
  await setUpProjectUser(browser, user, { persona: true });
});

/** Opens the page and waits until it is interactive (hydrated). */
async function open(page: Page) {
  await page.goto('/accounts');
  await page.waitForLoadState('networkidle');
}

const row = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}`) });

test('the seeded persona shows the available balance and the accounts at 1440', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Rekening & dompet' })).toBeVisible();
  const kpis = page.getByRole('region', { name: 'Ringkasan rekening' });
  await expect(kpis.getByText('Rp55.023.000')).toBeVisible();
  // Holdings still count toward assets, but are not spendable platform cash.
  await expect(kpis.getByText('Rp116.443.000')).toBeVisible();
  await expect(page.getByText('11 rekening · 6 untuk belanja, 5 platform investasi')).toBeVisible();
  await expect(row(page, 'BCA Tahapan')).toContainText('Rp42.810.000');
  // M5 separates platform cash from holdings; the cash subtitle uses the current USD/IDR rate.
  await expect(row(page, 'Gotrade')).toContainText('US$51,99≈ Rp850.037');
  await expect(row(page, 'BCA Tahapan')).not.toContainText('≈');
  const detail = page.getByRole('complementary', { name: 'Detail rekening' });
  await expect(detail.getByRole('heading', { name: 'BCA Tahapan' })).toBeVisible();
  await expect(detail.getByRole('img', { name: 'Saldo 6 bulan' })).toBeVisible();
  await screenshot(page, 'accounts-1440');
});

test('adds a cash account with the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  await page.getByRole('button', { name: 'Tambah rekening' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Rekening baru' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: 'Tunai' }).click();
  await dialog.getByRole('textbox', { name: 'Nama tampilan' }).fill('Dompet E2E');
  await dialog.getByRole('textbox', { name: 'Saldo awal' }).fill('100.000');
  await dialog.getByRole('button', { name: 'Tambah rekening' }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, 'Dompet E2E')).toContainText('Rp100.000');
  await expect(page.getByText('12 rekening · 7 untuk belanja, 5 platform investasi')).toBeVisible();
});

test('reconciles with a correction outside the reports', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  await page.getByRole('button', { name: 'Menu Dompet E2E' }).click();
  await page.getByRole('menuitem', { name: 'Sesuaikan saldo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sesuaikan saldo' });
  await dialog.getByRole('textbox', { name: 'Saldo sebenarnya' }).fill('90.000');
  await expect(dialog.getByRole('status')).toContainText('Rp10.000');
  await dialog.getByRole('radio', { name: /Koreksi tanpa transaksi/ }).check();
  await screenshot(page, 'accounts-reconcile');
  await dialog.getByRole('button', { name: 'Sesuaikan' }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, 'Dompet E2E')).toContainText('Rp90.000');
});

test('archives, restores, and finally deletes an account permanently', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  const archive = async () => {
    await page.getByRole('button', { name: 'Menu Dompet E2E' }).click();
    await page.getByRole('menuitem', { name: 'Arsipkan' }).click();
    const dialog = page.getByRole('dialog', { name: 'Arsipkan Dompet E2E?' });
    await dialog.getByRole('checkbox', { name: /Pindahkan saldo/ }).uncheck();
    await dialog.getByRole('button', { name: 'Arsipkan' }).click();
    await expect(dialog).toBeHidden();
  };
  await archive();
  await page.getByRole('tab', { name: /Diarsipkan 1/ }).click();
  await expect(page.getByRole('heading', { name: 'Rekening diarsipkan' })).toBeVisible();
  await expect(row(page, 'Dompet E2E')).toBeVisible();
  await screenshot(page, 'accounts-archived');
  await page.getByRole('button', { name: 'Pulihkan' }).click();
  await expect(page.getByRole('tab', { name: /Diarsipkan 0/ })).toBeVisible();
  await page.getByRole('tab', { name: /Aktif/ }).click();
  await expect(row(page, 'Dompet E2E')).toBeVisible();

  await archive();
  await page.getByRole('tab', { name: /Diarsipkan 1/ }).click();
  await page.getByRole('button', { name: 'Hapus permanen' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Hapus Dompet E2E permanen?' });
  await expect(confirm).toContainText('0 transaksinya');
  await confirm.getByRole('button', { name: 'Hapus permanen' }).click();
  await expect(page.getByRole('tab', { name: /Diarsipkan 0/ })).toBeVisible();
  await page.getByRole('tab', { name: /Aktif/ }).click();
  await expect(page.getByRole('region', { name: 'Ringkasan rekening' }).getByText('Rp55.023.000')).toBeVisible();
});

for (const width of [1024, 768]) {
  test(`at ${width} px the detail panel opens as a Sheet`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await expect(page.getByRole('complementary', { name: 'Detail rekening' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Ringkasan rekening' }).getByText('Rp55.023.000')).toBeVisible();
    await row(page, 'OVO').click();
    const sheet = page.getByRole('dialog', { name: 'OVO' });
    await expect(sheet.getByRole('img', { name: 'Saldo 6 bulan' })).toBeVisible();
    await screenshot(page, `accounts-${width}`);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });
}
