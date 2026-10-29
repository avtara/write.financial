// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Utang & cicilan (FR-R7, FR-U1–U5) as its own invited user with the design persona on 15 Okt 2026, plus a BCA Visa
 * •• 7710 credit card (limit Rp15.000.000, statement on the 20th, due on the 5th) added in `beforeAll`: the debt-free
 * page, the impact simulation of a draft (v3Igd), then the Section 18 scenario end to end — Tokopedia Kulkas
 * Rp3.000.000 on the card split 3× while recording it, Superindo Rp1.000.000 on the card without installments, and a
 * Rp2.000.000 transfer into the card allocated to the installment first, recalculated to 333.334 / 333.333 / 333.333
 * with Rp13.000.000 of the limit left — and the layout at 1440, 1024, and 768 px.
 */
import type { Locator, Page } from '@playwright/test';
import postgres from 'postgres';
import { e2eEnv } from './env.ts';
import { expect, projectUser, screenshot, setUpProjectUser, test } from './support.ts';

const user = projectUser('debts');
test.describe.configure({ mode: 'serial' });
test.use({ storageState: user.state, viewport: { width: 1440, height: 900 } });

test.beforeAll(async ({ browser }) => {
  await setUpProjectUser(browser, user, { persona: true });
  const sql = postgres(e2eEnv()['DATABASE_URL_SUPERUSER'] ?? '', { max: 1, onnotice: () => undefined });
  try {
    await sql`
      INSERT INTO accounts (user_id, type, provider_name, display_name, last4, currency, opening_date, color,
        cc_limit_minor, cc_statement_day, cc_due_day, include_in_available, sort_order)
      SELECT users.id, 'credit_card', 'BCA', 'BCA Visa', '7710', 'IDR', '2026-10-01', 'blue', 15000000, 20, 5, false,
        (SELECT coalesce(max(sort_order), 0) + 1 FROM accounts WHERE user_id = users.id)
      FROM users WHERE users.email = ${user.email}`;
  } finally {
    await sql.end();
  }
});

/** `/debts`, hydrated. */
async function openDebts(page: Page): Promise<void> {
  await page.goto('/debts');
  await expect(page.getByRole('heading', { level: 1, name: 'Utang & cicilan' })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

/** The Record sheet, opened with `N` on the Debts page. */
async function openSheet(page: Page): Promise<Locator> {
  await openDebts(page);
  await page.locator('body').press('n');
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('textbox', { name: 'Jumlah' })).toBeFocused();
  return sheet;
}

/** Picks `account` in the sheet's picker named `picker`. */
async function pick(page: Page, sheet: Locator, picker: RegExp | string, account: string): Promise<void> {
  await sheet.getByRole('button', { name: picker }).click();
  await page.keyboard.type(account);
  await page.keyboard.press('Enter');
}

/** Records an expense of `amount` on BCA Visa; `split` turns "Pecah jadi cicilan" on. */
async function cardExpense(page: Page, amount: string, description: string, split: boolean): Promise<void> {
  const sheet = await openSheet(page);
  await page.keyboard.type(amount);
  await pick(page, sheet, 'Rekening', 'BCA Visa');
  await sheet.getByRole('button', { name: 'Makan & Dapur' }).click();
  await sheet.getByRole('textbox', { name: 'Catatan' }).fill(description);
  const installment = sheet.getByRole('region', { name: 'Pecah jadi cicilan' });
  await expect(installment).toContainText('Kartu kredit · sisa limit');
  if (split) {
    await installment.getByRole('switch', { name: /Pecah jadi cicilan/ }).check();
    await expect(installment.getByRole('list', { name: 'Jadwal cicilan' })).toContainText(
      '1/3 · tagihan 20 Okt1.000.000',
    );
    await expect(installment).toContainText('Rp3.000.000 masuk Utang & cicilan, tidak ikut tagihan berjalan kartu.');
    await screenshot(page, 'debts-record-split-1440');
    await expect(sheet.getByRole('button', { name: /Simpan · cicil 3×/ })).toBeVisible();
  } else {
    await expect(installment).toContainText('Mati · masuk tagihan berjalan, ditagih 20 Okt');
    await expect(installment).toContainText('Total kewajiban kartu jadi Rp4.000.000');
  }
  await page.keyboard.press('Control+Enter');
  await expect(sheet).not.toBeVisible();
  await expect(page.getByText('Transaksi tersimpan')).toBeVisible();
}

test('debt-free: the KPIs, "Kamu bebas utang", and the debt types (exCE7)', async ({ page }) => {
  await openDebts(page);
  // The persona's receivables (Section 19) are the only entries.
  await expect(page.getByText('Bebas utang · 2 piutang aktif Rp542.500')).toBeVisible();
  const kpis = page.getByRole('region', { name: 'Ringkasan utang' });
  await expect(kpis).toContainText('Sisa utangRp0tidak ada utang aktif');
  await expect(kpis).toContainText('Jatuh tempo terdekat18 OktNadia · piutang Rp242.500');
  await expect(kpis).toContainText('PiutangRp542.500');
  await expect(page.getByText('Kamu bebas utang')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Jenis utang' }).getByRole('button')).toHaveCount(6);
  await expect(page.getByRole('link', { name: 'Utang & cicilan' })).toBeVisible();
  await screenshot(page, 'debts-empty-1440');
});

test('a draft 0% installment shows its impact before it is saved (v3Igd)', async ({ page }) => {
  await openDebts(page);
  await page.getByRole('button', { name: 'Tambah utang / cicilan' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Tambah utang / cicilan' });
  await dialog.getByRole('radio', { name: 'Cicilan 0%' }).click();
  await dialog.getByRole('textbox', { name: 'Nama' }).fill('MacBook Air M4 — iBox');
  await dialog.getByRole('textbox', { name: 'Pokok' }).fill('18999000');
  await dialog.getByRole('textbox', { name: 'Penyedia' }).fill('Kredivo');
  const simulation = dialog.getByRole('region', { name: 'Simulasi dampak' });
  await expect(simulation).toContainText('Rp1.583.250');
  await expect(simulation).toContainText('6,09%');
  await expect(simulation).toContainText('36,54%');
  await expect(simulation).toContainText('30,45%');
  await expect(simulation).toContainText('sisa ruang 0,4 poin');
  await screenshot(page, 'debts-add-simulation-1440');
  await dialog.getByRole('button', { name: 'Batal' }).click();
  await expect(dialog).not.toBeVisible();
});

test('Section 18: Kulkas split 3×, Superindo on the bill, Rp2jt into the card → 333.334/333.333/333.333, 13.000.000 left', async ({
  page,
}) => {
  await cardExpense(page, '3jt', 'Tokopedia — Kulkas 2 pintu', true);
  await cardExpense(page, '1jt', 'Superindo — belanja bulanan', false);

  await openDebts(page);
  const strip = page.getByRole('region', { name: 'BCA Visa •• 7710' });
  await expect(strip).toContainText('Tagihan berjalan');
  await expect(strip).toContainText('Cicilan ditahan di limit');
  await expect(strip).toContainText('11.000.000');

  const sheet = await openSheet(page);
  const transfer = sheet.getByRole('radio', { name: 'Transfer' });
  await transfer.focus();
  await page.keyboard.press('Space');
  await expect(transfer).toBeChecked();
  await sheet.getByRole('textbox', { name: /^Jumlah/ }).fill('2jt');
  await pick(page, sheet, /^Ke:/, 'BCA Visa');
  const allocation = sheet.getByRole('region', { name: 'Alokasi pembayaran kartu' });
  await expect(allocation.getByRole('row', { name: /Tokopedia — Kulkas 2 pintu/ })).toContainText(
    '3.000.0002.000.0001.000.000',
  );
  await expect(allocation).toContainText('3× Rp333.334 · tenor tetap');
  await expect(allocation).toContainText('1× Rp1.000.000 · lunas 20 Okt');
  await expect(allocation).toContainText('Sisa limit11.000.00013.000.000');
  await screenshot(page, 'debts-record-payment-1440');
  await page.keyboard.press('Control+Enter');
  await expect(sheet).not.toBeVisible();

  await openDebts(page);
  await expect(page.getByRole('region', { name: 'BCA Visa •• 7710' })).toContainText('13.000.000');
  const plan = page.getByRole('article', { name: 'Tokopedia — Kulkas 2 pintu' });
  const schedule = plan.getByRole('region', { name: 'Jadwal cicilan' });
  await expect(schedule.getByRole('row')).toHaveCount(3);
  await expect(schedule.getByRole('row').nth(0)).toContainText('333.334');
  await expect(schedule.getByRole('row').nth(1)).toContainText('333.333');
  await expect(schedule.getByRole('row').nth(2)).toContainText('333.333');
  await expect(plan).toContainText(/67,\d{2}% lunas/);
  const kpis = page.getByRole('region', { name: 'Ringkasan utang' });
  await expect(kpis).toContainText('Rp2.000.000');
  await expect(kpis).toContainText('Rp1.333.334');
  await screenshot(page, 'debts-paid-1440');
});

for (const width of [1440, 1024, 768]) {
  test(`the page fits ${String(width)} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openDebts(page);
    await expect(page.getByRole('region', { name: 'Ringkasan utang' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await screenshot(page, `debts-${String(width)}`);
  });
}
