// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Anggaran (FR-B1–B5), Settings › Periode bulanan (FR-P1–P3), and the Record sheet's budget impact (FR-T3) as the
 * invited user with the design persona on 15 Okt 2026: the October totals, September read-only through the switcher,
 * a start-day preview left without saving, an inline limit edit with the keyboard only, a leftover move undone from
 * the toast, and the layout at 1440, 1024, and 768 px. The spec leaves the budget as it found it.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, loadAccount, screenshot, seedDesignPersona, test, USER_STATE } from './support.ts';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: USER_STATE, viewport: { width: 1440, height: 900 } });

test.beforeAll(async () => {
  await seedDesignPersona(loadAccount('user').email);
});

/** `/budget`, hydrated: the inline limit buttons respond once the category list is interactive. */
async function openBudget(page: Page): Promise<void> {
  await page.goto('/budget');
  await expect(page.getByRole('heading', { level: 1, name: 'Anggaran' })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

/** The category row of `name`. */
const row = (page: Page, name: string): Locator =>
  page.getByRole('listitem').filter({ has: page.getByRole('button', { name: `Opsi ${name}` }) });

/** Opens the inline editor of `name`'s limit with the keyboard and replaces the value with `amount`. */
async function typeLimit(page: Page, name: string, amount: string): Promise<void> {
  await page.getByRole('button', { name: `Ubah batas ${name}` }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: `Ubah batas ${name}` })).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(amount);
}

test('October shows the spending against the plan on day 15', async ({ page }) => {
  await openBudget(page);
  await expect(page.getByText('Hari ke-15 dari 31 · 16 hari lagi menuju gajian berikutnya')).toBeVisible();

  const hero = page.getByRole('region', { name: 'Sisa anggaran Oktober' });
  await expect(hero.getByText('Hari ini · ideal 48%')).toBeVisible();
  await expect(hero.getByText('88% · ideal 48%')).toBeVisible();
  await expect(hero).toContainText(/Batas aman harian\s*Rp140\.000/);

  const groups = page.getByRole('region', { name: 'Kebutuhan & Keinginan' });
  await expect(groups).toContainText(/Kebutuhan\s*87%/);
  await expect(groups).toContainText(/Keinginan\s*90%/);
  await screenshot(page, 'budget-1440');
});

test('September through the switcher is read-only', async ({ page }) => {
  await openBudget(page);
  await page.getByRole('button', { name: 'Periode sebelumnya' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/[?&]period=/);
  await expect(page.getByRole('region', { name: 'Hasil September' })).toBeVisible();

  await expect(page.getByText('Hanya baca · bulan sudah ditutup')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Atur Anggaran' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^Ubah batas / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Opsi / })).toHaveCount(0);
  await expect(page.getByRole('region', { name: /^Perlu perhatian/ })).toHaveCount(0);
  await screenshot(page, 'budget-september-1440');
});

test('a later start day previews the prorated transition and is left without saving', async ({ page }) => {
  await page.goto('/settings/period');
  await expect(page.getByRole('heading', { name: 'Periode bulanan' })).toBeVisible();
  await page.waitForLoadState('networkidle');

  const start = page.getByRole('button', { name: /^Bulan keuangan dimulai/ });
  await expect(start).toHaveText('Tanggal 1');
  await start.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Tanggal 1', exact: true })).toBeFocused();
  // 1 → 22 → 25 in the 7-column grid.
  for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowRight']) {
    await page.keyboard.press(key);
  }
  await expect(page.getByRole('button', { name: 'Tanggal 25', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(start).toHaveText('Tanggal 25');

  await expect(page.getByText('Gaji PT Kinarya biasanya masuk tgl 1, bukan tgl 25')).toBeVisible();
  await expect(page.getByText('Tidak sejalan gajian')).toBeVisible();
  await expect(page.getByText('Transisi', { exact: true })).toBeVisible();
  await expect(page.getByText('1 Nov – 24 Nov', { exact: true })).toBeVisible();
  const next = page.getByRole('radio', { name: /^Mulai periode berikutnya/ });
  await expect(next).toBeChecked();
  await expect(page.locator('label').filter({ has: next })).toContainText('Rp18.750.000 → Rp15.000.000');
  await screenshot(page, 'period-25-1440');

  await page.getByRole('button', { name: 'Batal' }).click();
  await expect(start).toHaveText('Tanggal 1');
  await expect(page.getByText('Tidak sejalan gajian')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Bulan keuangan dimulai/ })).toHaveText('Tanggal 1');
});

test('the leftover move from "Perlu perhatian" is undone from the toast', async ({ page }) => {
  await openBudget(page);
  const limit = page.getByRole('button', { name: 'Ubah batas Belanja Online' });
  await expect(limit).toHaveText('2.000.000');

  const attention = page.getByRole('region', { name: /^Perlu perhatian/ });
  await attention.getByRole('button', { name: 'Pindahkan Rp400.000' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tutup kekurangan Belanja Online' });
  await expect(dialog).toBeVisible();
  await screenshot(page, 'budget-move-1440');
  await dialog.getByRole('button', { name: 'Pindahkan Rp400.000' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Rp400.000 dipindahkan ke Belanja Online')).toBeVisible();
  await expect(limit).toHaveText('2.400.000');
  await page.getByRole('button', { name: 'Urungkan' }).click();
  await expect(page.getByText('Pemindahan sisa dibatalkan')).toBeVisible();
  await expect(limit).toHaveText('2.000.000');
});

test('a limit is edited inline with the keyboard only; Escape cancels', async ({ page }) => {
  await openBudget(page);
  const transport = row(page, 'Transportasi');
  await expect(page.getByRole('button', { name: 'Ubah batas Transportasi' })).toHaveText('2.000.000');

  await typeLimit(page, 'Transportasi', '2500000');
  await expect(transport.getByText('↵')).toBeVisible();
  await screenshot(page, 'budget-inline-edit-1440');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Batas Transportasi jadi Rp2.500.000')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ubah batas Transportasi' })).toHaveText('2.500.000');

  await typeLimit(page, 'Hiburan', '9000000');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Ubah batas Hiburan' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ubah batas Hiburan' })).toHaveText('2.500.000');

  // Back to the seed's limit, so later specs see the persona's budget.
  await typeLimit(page, 'Transportasi', '2000000');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Ubah batas Transportasi' })).toHaveText('2.000.000');
});

test('the Record sheet shows what an expense does to the category budget', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('form', { name: 'Catat cepat' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.locator('body').press('n');
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('textbox', { name: 'Jumlah' })).toBeFocused();
  await page.keyboard.type('150rb');
  await sheet.getByRole('button', { name: 'Lihat semua' }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.type('Transportasi');
  await expect(page.getByRole('option', { name: /^Transportasi/ })).toContainText('sisa Rp600.000');
  await page.keyboard.press('Enter');

  await expect(sheet.getByText('Anggaran Transportasi jadi 78% · Rp1.550.000 / 2.000.000')).toBeVisible();
  await screenshot(page, 'record-budget-impact-1440');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Buang transaksi ini?' }).getByRole('button', { name: 'Buang' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const width of [1440, 1024, 768]) {
  test(`the budget page fits ${width} px without horizontal scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openBudget(page);
    await expect(page.getByRole('region', { name: 'Anggaran per kategori' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await screenshot(page, `budget-${width}`);
  });
}
