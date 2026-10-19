// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Record Transaction (FR-T1–T4, T8, T9) as the invited user with the design persona loaded (`db:seed`): an expense
 * entered with the keyboard only changes the account balance and "Urungkan" restores it; an IDR → USD transfer of
 * Rp3.000.000 that arrives as US$182,10 at the reference rate 16350.0275 records an FX difference of −Rp22.660; a
 * filled form closed with Escape is kept as a draft and continued later; and the Quick Add bar saves with ↵.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import postgres from 'postgres';
import { e2eEnv } from './env.ts';
import { expect, loadAccount, screenshot, test, USER_STATE } from './support.ts';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: USER_STATE, viewport: { width: 1440, height: 900 } });

const env = e2eEnv();
const sql = () => postgres(env['DATABASE_URL_SUPERUSER'] ?? '', { max: 1, onnotice: () => undefined });

test.beforeAll(async () => {
  const { email } = loadAccount('user');
  const db = sql();
  try {
    const [row] = await db<{ accounts: number }[]>`
      SELECT count(*)::int AS accounts FROM accounts a JOIN users u ON u.id = a.user_id WHERE u.email = ${email}`;
    if (row?.accounts === 0) {
      execFileSync('node', ['src/cli.ts', 'seed', '--email', email], {
        cwd: path.resolve(import.meta.dirname, '../../../packages/db'),
        env: { ...process.env, ...env },
        stdio: 'inherit',
      });
    }
    // The reference rate of the golden example (PRD §7.2): shown as Rp16.350, exactly 16350.0275.
    await db`
      UPDATE fx_rates SET rate = '16350.0275'
      WHERE base = 'USD' AND quote = 'IDR' AND user_id = (SELECT id FROM users WHERE email = ${email})`;
  } finally {
    await db.end();
  }
});

/** The sheet, opened with `N`. */
async function openSheet(page: Page): Promise<Locator> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();
  // Wait for hydration: the Quick Add bar is interactive once its amount field is.
  await expect(page.getByRole('form', { name: 'Catat cepat' })).toBeVisible();
  await page.locator('body').press('n');
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading')).toHaveText(/^Catat /);
  await expect(sheet.getByRole('textbox', { name: 'Jumlah' })).toBeFocused();
  return sheet;
}

/** The balance the account picker shows for `account`, e.g. "Rp42.810.000". */
async function balanceOf(page: Page, sheet: Locator, account: string): Promise<string> {
  await sheet.getByRole('button', { name: 'Rekening' }).focus();
  await page.keyboard.press('Enter');
  const option = page.getByRole('option', { name: new RegExp(`^${account}`) });
  const text = (await option.innerText()).replace(/\s+/g, ' ');
  await page.keyboard.press('Escape');
  return /Rp[\d.]+/.exec(text)?.[0] ?? '';
}

const rupiah = (text: string) => Number(text.replace(/\D/g, ''));
const formatRupiah = (value: number) => `Rp${value.toLocaleString('id-ID')}`;

test('an expense entered with the keyboard changes the balance, and Urungkan restores it', async ({ page }) => {
  const sheet = await openSheet(page);
  const before = rupiah(await balanceOf(page, sheet, 'BCA Tahapan'));

  await sheet.getByRole('textbox', { name: 'Jumlah' }).focus();
  await page.keyboard.type('85rb');
  await sheet.getByRole('button', { name: 'Makan & Dapur' }).focus();
  await page.keyboard.press('Enter');
  await expect(sheet.getByRole('button', { name: 'Makan & Dapur' })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('textbox', { name: 'Catatan' }).focus();
  await page.keyboard.type('Makan siang');
  await sheet.getByRole('combobox', { name: 'Tag' }).focus();
  await page.keyboard.type('#kantor');
  await page.keyboard.press('Enter');
  await expect(
    sheet.getByText(`Saldo BCA Tahapan jadi ${formatRupiah(before - 85_000)} setelah disimpan.`),
  ).toBeVisible();
  await screenshot(page, 'record-expense-1440');
  await page.keyboard.press('Control+Enter');

  await expect(sheet).not.toBeVisible();
  const toast = page.getByText('Transaksi tersimpan');
  await expect(toast).toBeVisible();
  await expect(page.getByText(/Makan & Dapur · −Rp85\.000 · BCA Tahapan/)).toBeVisible();

  const again = await openSheet(page);
  expect(rupiah(await balanceOf(page, again, 'BCA Tahapan'))).toBe(before - 85_000);
  await page.keyboard.press('Escape');
  await expect(again).not.toBeVisible();

  // Record again and undo straight away from the toast.
  const third = await openSheet(page);
  await page.keyboard.type('85rb');
  await third.getByRole('button', { name: 'Makan & Dapur' }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+Enter');
  await page.getByRole('button', { name: 'Urungkan' }).click();
  await expect(page.getByText('Transaksi dibatalkan')).toBeVisible();
  const last = await openSheet(page);
  expect(rupiah(await balanceOf(page, last, 'BCA Tahapan'))).toBe(before - 85_000);
});

test('an IDR → USD transfer records the FX difference of −Rp22.660', async ({ page }) => {
  const sheet = await openSheet(page);
  await sheet.getByRole('radio', { name: 'Pengeluaran' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const transfer = sheet.getByRole('radio', { name: 'Transfer' });
  await expect(transfer).toBeFocused();
  // Radix selects on arrow focus only while the arrow key is still down, which races in CI; Space always selects.
  await page.keyboard.press('Space');
  await expect(transfer).toBeChecked();
  await expect(sheet.getByRole('heading', { name: 'Catat Transfer' })).toBeVisible();

  await sheet.getByRole('textbox', { name: /^Jumlah/ }).focus();
  await page.keyboard.type('3jt');
  await sheet.getByRole('button', { name: /^Ke:/ }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.type('Gotrade');
  await page.keyboard.press('Enter');
  await expect(sheet.getByText('Dikirim · IDR')).toBeVisible();
  await expect(sheet.getByText('1 USD = Rp16.350')).toBeVisible();
  await expect(sheet.getByText(/Seharusnya US\$183,49/)).toBeVisible();

  await sheet.getByRole('textbox', { name: 'Diterima di Gotrade' }).focus();
  await page.keyboard.type('182,10');
  await expect(sheet.getByText('Selisih dicatat otomatis −Rp22.660')).toBeVisible();
  await expect(sheet.getByText(/US\$1,39 lebih kecil dari seharusnya/)).toBeVisible();
  await sheet.getByRole('textbox', { name: 'Catatan' }).focus();
  await page.keyboard.type('Top-up Gotrade');
  await screenshot(page, 'record-transfer-fx-1440');
  await page.keyboard.press('Control+Enter');
  await expect(sheet).not.toBeVisible();
  await expect(page.getByText('Transaksi tersimpan')).toBeVisible();

  const db = sql();
  try {
    const rows = await db<{ sent: string; received: string; difference: string }[]>`
      SELECT tm.sent_minor::text AS sent, tm.received_minor::text AS received, tm.fx_diff_base_minor::text AS difference
      FROM transactions t JOIN transfer_meta tm ON tm.transaction_id = t.id
      WHERE t.description = 'Top-up Gotrade' AND t.deleted_at IS NULL`;
    expect(rows).toEqual([{ sent: '3000000', received: '18210', difference: '-22660' }]);
  } finally {
    await db.end();
  }
});

test('a filled form closed with Escape is kept as a draft and continued later', async ({ page }) => {
  const sheet = await openSheet(page);
  await page.keyboard.type('48rb');
  await sheet.getByRole('textbox', { name: 'Catatan' }).focus();
  await page.keyboard.type('Nonton bareng');
  await page.keyboard.press('Escape');
  const confirm = page.getByRole('dialog', { name: 'Buang transaksi ini?' });
  await expect(confirm).toBeVisible();
  await screenshot(page, 'record-discard-1440');
  await confirm.getByRole('button', { name: 'Simpan draf' }).click();
  await expect(page.getByText('Draf tersimpan')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const next = await openSheet(page);
  const drafts = next.getByRole('region', { name: 'Draf tersimpan' });
  await expect(drafts.getByText('Nonton bareng')).toBeVisible();
  await drafts.getByRole('button', { name: 'Lanjutkan' }).click();
  await expect(next.getByRole('textbox', { name: 'Catatan' })).toHaveValue('Nonton bareng');
  await expect(next.getByRole('textbox', { name: 'Jumlah' })).toHaveValue('48.000');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Buang transaksi ini?' }).getByRole('button', { name: 'Buang' }).click();
});

test('the Quick Add bar saves with Enter and guesses the category from the description', async ({ page }) => {
  await page.goto('/');
  const bar = page.getByRole('form', { name: 'Catat cepat' });
  await expect(bar).toBeVisible();
  await bar.getByRole('textbox', { name: 'Catatan' }).fill('Makan malam 45rb');
  await expect(bar.getByRole('button', { name: 'Kategori' })).toHaveText('Makan & Dapur');
  await screenshot(page, 'quick-add-1440');
  await bar.getByRole('textbox', { name: 'Catatan' }).press('Enter');
  await expect(page.getByText(/Makan & Dapur · −Rp45\.000 · BCA Tahapan/)).toBeVisible();
  await expect(bar.getByRole('textbox', { name: 'Catatan' })).toHaveValue('');
});

test('the sheet opens with N on a tablet too', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  const sheet = await openSheet(page);
  await expect(sheet.getByRole('radiogroup', { name: 'Jenis transaksi' })).toBeVisible();
  await screenshot(page, 'record-sheet-768');
});
