// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tabungan (FR-G1, G3, G4, FR-B6; design 13) as its own invited user with the design persona on 15 Okt 2026: the
 * goldens (Rp17.325.000 in 6 goals, October Rp3.500.000 of Rp4.650.000, Dana Darurat 0,5 → with Bibit RDPU as a
 * source 0,6 months), "Setor manual" Rp1.000.000 (21% → 22%, Nov 2027 → Okt 2027), "Tarik dana", a new sinking fund
 * joining the payday set-aside from November (Rp1.150.000 → Rp1.400.000 a month, October's stays Rp1.150.000),
 * "Tujuan baru" with 8× Rp2.250.000, STNK reached and
 * completed with "Urungkan", paid from in the Record sheet (Terpakai) with its Rp38.000 moved to Servis motor, the
 * payday set-aside of 25 Okt waiting in the Review queue (`runScheduleJobs`) until "Sudah ditransfer", which puts each
 * share in Bank Jago for its sinking fund (Dana Darurat unchanged), and the layout
 * at 1440, 1024, and 768 px. It changes the persona's goals, which no other project sees.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, projectUser, runScheduleJobs, screenshot, setUpProjectUser, test } from './support.ts';

const user = projectUser('goals');
test.describe.configure({ mode: 'serial' });
test.use({ storageState: user.state, viewport: { width: 1440, height: 1198 } });

test.beforeAll(async ({ browser }) => {
  await setUpProjectUser(browser, user, { persona: true });
});

/** `/goals`, hydrated. */
async function openGoals(page: Page): Promise<void> {
  await page.goto('/goals');
  await expect(page.getByRole('heading', { level: 1, name: 'Tabungan' })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

/** Runs `item` of a goal's ⋮ menu. */
async function menu(page: Page, goal: string, item: string): Promise<void> {
  await page.getByRole('button', { name: `Menu ${goal}` }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** Chooses `option` in the Radix select `select`. */
async function choose(page: Page, select: Locator, option: string): Promise<void> {
  await select.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

const goalRow = (page: Page, name: string) =>
  page.getByRole('region', { name: 'Tujuan tabungan' }).getByRole('listitem').filter({ hasText: name });

test('the persona’s goals: Rp17.325.000 in 6 goals, October Rp3.500.000 of Rp4.650.000, the sinking funds', async ({
  page,
}) => {
  await openGoals(page);
  await expect(page.getByText('6 tujuan aktif · Oktober 2026')).toBeVisible();
  const kpis = page.getByRole('region', { name: 'Ringkasan tabungan' });
  await expect(kpis).toContainText('Total terkumpulRp17.325.000di 6 tujuan');
  await expect(kpis).toContainText('Setoran OktoberRp3.500.000dari rencana Rp4.650.000 · sisa tgl 25');
  await expect(kpis).toContainText('Dana darurat0,5 bulantarget 3 bulan pengeluaran');
  const list = page.getByRole('region', { name: 'Tujuan tabungan' });
  await expect(list.getByRole('tab', { name: 'Aktif · 6' })).toHaveAttribute('aria-selected', 'true');
  await expect(goalRow(page, 'Servis motor')).toContainText('Rp240.000/bulan · tgl 25 · Des 2026');
  await expect(goalRow(page, 'Servis motor')).toContainText('2 bulan lagi');
  await expect(goalRow(page, 'Perpanjang STNK')).toContainText('80%');
  await expect(goalRow(page, 'Perpanjang STNK')).toContainText('Hampir tercapai');
  await expect(goalRow(page, 'Liburan Bali')).toContainText('Rp867.000/bulan · tgl 25 · Mar 2027');
  await expect(goalRow(page, 'Liburan Bali')).toContainText('Sesuai rencana');
  await expect(goalRow(page, 'Dana Darurat')).toContainText('Rp3.500.000/bulan · tgl 1 & 14 · Nov 2027');
  const month = page.getByRole('region', { name: 'Setoran Oktober' });
  await expect(month.getByRole('listitem')).toHaveCount(3);
  await expect(month.getByRole('listitem').nth(2)).toContainText('Sisihkan dana tidak rutin');
  await expect(month.getByRole('listitem').nth(2)).toContainText('Terjadwal');
  const sinking = page.getByRole('region', { name: 'Dana tidak rutin' });
  await expect(sinking).toContainText('Disisihkan tiap tgl 25 · BCA Tahapan → Bank Jago');
  await expect(sinking).toContainText('Total per bulanRp1.150.000/bulan');
  await expect(page.getByRole('link', { name: 'Tabungan' })).toHaveAttribute('aria-current', 'page');
  await expectNoSidewaysScroll(page);
  await screenshot(page, 'goals-1440');
});

test('Bibit RDPU as a source: Dana Darurat Rp11.125.000, 21%, 0,6 months, reached Nov 2027', async ({ page }) => {
  await openGoals(page);
  await menu(page, 'Dana Darurat', 'Ubah tujuan');
  const form = page.getByRole('dialog', { name: 'Ubah Dana Darurat' });
  await expect(form.getByRole('checkbox', { name: /Target dinamis/ })).toBeChecked();
  await form.getByRole('button', { name: 'Tambah sumber' }).click();
  await choose(page, form.getByRole('combobox', { name: 'Rekening sumber' }).nth(1), 'Bibit');
  // Dana Darurat's Bank Jago row is a fixed amount too: the new row is the last.
  await form.getByRole('textbox', { name: 'Nominal tetap' }).last().fill('3.000.000');
  await form.getByRole('button', { name: 'Simpan' }).click();
  await expect(form).toBeHidden();
  await expect(goalRow(page, 'Dana Darurat')).toContainText('Rp11.125.000');
  await expect(goalRow(page, 'Dana Darurat')).toContainText('21%');
  await expect(goalRow(page, 'Dana Darurat')).toContainText('Sesuai rencana');
  await page.getByRole('button', { name: 'Dana Darurat', exact: true }).click();
  const detail = page.getByRole('dialog', { name: 'Dana Darurat' });
  await expect(detail).toContainText('Target 3× pengeluaran bulanan');
  await expect(detail).toContainText('21% · 0,6 bulan pengeluaran');
  await expect(detail).toContainText('Tercapai Nov 2027');
  await expect(detail).toContainText('Tiap tgl 1 · perlu konfirmasi');
  await expect(detail.getByRole('listitem').filter({ hasText: '14 Okt' })).toContainText('+3.000.000');
  await screenshot(page, 'goals-detail');
  await detail.getByRole('button', { name: 'Tutup' }).click();
  await expect(page.getByRole('region', { name: 'Ringkasan tabungan' })).toContainText('Dana darurat0,6 bulan');
});

test('Setor manual Rp1.000.000: 21% → 22%, 0,6 → 0,7 months, Nov 2027 → Okt 2027, recorded as a transfer', async ({
  page,
}) => {
  await openGoals(page);
  await menu(page, 'Dana Darurat', 'Tarik dana');
  const withdraw = page.getByRole('dialog', { name: 'Tarik dana dari Dana Darurat?' });
  await withdraw.getByRole('textbox', { name: 'Jumlah' }).fill('2.000.000');
  await expect(withdraw).toContainText('Progres21% → 17%');
  await expect(withdraw).toContainText('Ketahanan0,6 → 0,5 bulan');
  await withdraw.getByRole('button', { name: 'Batal' }).click();

  await menu(page, 'Dana Darurat', 'Setor manual');
  const deposit = page.getByRole('dialog', { name: 'Setor ke Dana Darurat' });
  await expect(deposit).toContainText('Terkumpul Rp11.125.000 dari Rp54.000.000');
  await expect(deposit.getByRole('combobox', { name: 'Dari' })).toHaveText(/BCA Tahapan/);
  await expect(deposit.getByRole('combobox', { name: 'Ke' })).toHaveText(/Bank Jago/);
  await deposit.getByRole('button', { name: '1.000.000', exact: true }).click();
  await deposit.getByRole('textbox', { name: 'Catatan' }).fill('Bonus proyek freelance');
  await expect(deposit).toContainText('#dana-darurat');
  await expect(deposit).toContainText('Progres21% → 22%');
  await expect(deposit).toContainText('Ketahanan0,6 → 0,7 bulan');
  await expect(deposit).toContainText('Estimasi tercapaiNov 2027 → Okt 2027');
  await screenshot(page, 'goals-deposit');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(deposit).toBeHidden();
  await expect(page.getByText('Setoran tercatat')).toBeVisible();
  await expect(page.getByText('Transfer BCA Tahapan → Bank Jago dibuat di Transaksi.')).toBeVisible();
  const kpis = page.getByRole('region', { name: 'Ringkasan tabungan' });
  await expect(kpis).toContainText('Setoran OktoberRp4.500.000dari rencana Rp4.650.000');
  await expect(goalRow(page, 'Dana Darurat')).toContainText('22%');
  await expect(page.getByRole('region', { name: 'Setoran Oktober' }).getByRole('listitem')).toHaveCount(4);

  // Back to BCA: Rp11.125.000 again, the withdrawal labeled like the deposit.
  await menu(page, 'Dana Darurat', 'Tarik dana');
  await withdraw.getByRole('textbox', { name: 'Jumlah' }).fill('1.000.000');
  await withdraw.getByRole('button', { name: 'Tarik Rp1.000.000' }).click();
  await expect(withdraw).toBeHidden();
  await expect(page.getByText('Dana ditarik')).toBeVisible();
  await expect(goalRow(page, 'Dana Darurat')).toContainText('Rp11.125.000');

  await page.goto('/transactions?tag=dana-darurat&type=transfer');
  await expect(page.getByText('Bonus proyek freelance').or(page.getByText('Dana Darurat').first())).toBeVisible();
});

test('Dana tidak rutin baru: Asuransi motor Rp250.000 over Nov–Apr joins the payday set-aside', async ({ page }) => {
  await openGoals(page);
  await page.getByRole('button', { name: 'Dana baru' }).click();
  const form = page.getByRole('dialog', { name: 'Dana tidak rutin baru' });
  await form.getByRole('textbox', { name: 'Nama' }).fill('Asuransi motor');
  await form.getByRole('textbox', { name: 'Target' }).fill('1.500.000');
  await form.getByLabel('Jatuh tempo').fill('2027-04');
  await expect(form).toContainText('Rp250.0006 bulan · Nov–Apr');
  await expect(form).toContainText('Total dana tidak rutin jadi Rp1.400.000/bulan (dari Rp1.150.000)');
  await expect(form.getByRole('switch', { name: /Sisihkan tiap gajian/ })).toBeChecked();
  await expect(form).toContainText(
    'Tiap 25 masuk Perlu ditinjau, tercatat sebagai transfer ke Bank Jago setelah kamu konfirmasi',
  );
  await screenshot(page, 'goals-sinking-new');
  await form.getByRole('button', { name: 'Buat dana' }).click();
  await expect(form).toBeHidden();
  const sinking = page.getByRole('region', { name: 'Dana tidak rutin' });
  await expect(sinking.getByRole('button', { name: /^Asuransi motor/ })).toContainText('Rp250.000/bulan');
  await expect(sinking).toContainText('Total per bulanRp1.400.000/bulan');
  // Asuransi motor runs Nov–Apr: October's set-aside stays Rp1.150.000.
  await expect(page.getByRole('region', { name: 'Setoran Oktober' }).getByRole('listitem').last()).toContainText(
    'Rp1.150.000',
  );
});

test('Tujuan baru: Laptop kerja baru Rp18.000.000 by Jun 2027, 8× Rp2.250.000 on the 25th (keyboard only)', async ({
  page,
}) => {
  await openGoals(page);
  await page.getByRole('button', { name: 'Tujuan baru' }).focus();
  await page.keyboard.press('Enter');
  const form = page.getByRole('dialog', { name: 'Tujuan tabungan baru' });
  await expect(form.getByRole('textbox', { name: 'Nama tujuan' })).toBeFocused();
  await page.keyboard.type('Laptop kerja baru');
  await form.getByRole('radio', { name: 'Laptop' }).focus();
  await page.keyboard.press('Space');
  await form.getByRole('textbox', { name: 'Target' }).focus();
  await page.keyboard.type('18000000');
  await form.getByLabel('Tenggat').fill('2027-06');
  await choose(page, form.getByRole('combobox', { name: 'Simpan di rekening' }), 'Mandiri');
  await form.getByRole('switch', { name: /Setoran rutin bulanan/ }).focus();
  await page.keyboard.press('Space');
  await expect(form.getByRole('textbox', { name: 'Jumlah / bulan' })).toHaveValue('2.250.000');
  await expect(form.getByRole('combobox', { name: 'Tanggal' })).toHaveValue('25');
  await expect(form.getByRole('combobox', { name: 'Dari' })).toHaveText(/BCA Tahapan/);
  await expect(form).toContainText('8× setoran (Nov 2026 – Jun 2027) · label #laptop-kerja-baru');
  await screenshot(page, 'goals-new');
  await form.getByRole('button', { name: 'Buat tujuan' }).focus();
  await page.keyboard.press('Enter');
  await expect(form).toBeHidden();
  await expect(page.getByText('Laptop kerja baru dibuat')).toBeVisible();
  await expect(goalRow(page, 'Laptop kerja baru')).toContainText('Rp2.250.000/bulan · tgl 25 · Jun 2027');
  await expect(page.getByText('8 tujuan aktif · Oktober 2026')).toBeVisible();
});

test('STNK reached with "Pas target", completed with Urungkan, paid from, and its Rp38.000 moved', async ({ page }) => {
  await openGoals(page);
  await menu(page, 'Perpanjang STNK', 'Setor manual');
  const deposit = page.getByRole('dialog', { name: 'Setor ke Perpanjang STNK' });
  await expect(deposit).toContainText('kurang Rp170.000');
  await deposit.getByRole('button', { name: /Pas target/ }).click();
  await choose(page, deposit.getByRole('combobox', { name: 'Dari' }), 'Mandiri');
  await expect(deposit).toContainText('Progres80% → 100%');
  await expect(deposit).toContainText('Tercapai setelah setoran ini');
  await deposit.getByRole('button', { name: 'Setor Rp170.000' }).click();

  const reached = page.getByRole('dialog', { name: 'Perpanjang STNK tercapai' });
  await expect(reached).toContainText(
    'Rp850.000 terkumpul, 4 bulan lebih cepat dari rencana Feb 2027. Dananya siap dipakai kapan saja.',
  );
  await expect(reached).toContainText('Mulai 25 Okt tidak lagi disisihkan. Rencana setoran bulanan turun Rp43.000.');
  await screenshot(page, 'goals-reached');
  await reached.getByRole('button', { name: 'Tandai selesai' }).click();
  await expect(page.getByText('Perpanjang STNK selesai', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Selesai · 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Urungkan' }).click();
  await expect(page.getByText('Perpanjang STNK aktif lagi')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Selesai · 0' })).toBeVisible();
  await expect(goalRow(page, 'Perpanjang STNK')).toContainText('Rp43.000/bulan');

  // "Pakai dana": the Samsat bill paid with STNK's money (FR-G4).
  await page.getByRole('button', { name: 'Perpanjang STNK', exact: true }).click();
  await page.getByRole('dialog', { name: 'Perpanjang STNK' }).getByRole('button', { name: 'Pakai dana' }).click();
  const sheet = page.getByRole('dialog', { name: /^Catat/ });
  await sheet.getByRole('textbox', { name: 'Jumlah' }).fill('812000');
  await sheet.getByRole('button', { name: 'Transportasi' }).click();
  await sheet.getByRole('textbox', { name: 'Catatan', exact: true }).fill('Perpanjang STNK — Samsat Jaksel');
  const use = sheet.getByRole('region', { name: 'Bayar dari tujuan Perpanjang STNK' });
  await expect(use).toContainText('100% · Rp850.000');
  await expect(use).toContainText('Sisa Rp38.000 bisa dipindah ke tujuan lain setelah disimpan.');
  await expect(use.getByRole('button', { name: 'Pakai dana tujuan' })).toHaveAttribute('aria-pressed', 'true');
  await screenshot(page, 'goals-pay-from');
  await sheet.getByRole('button', { name: /^Simpan/ }).click();
  await expect(page.getByText('Perpanjang STNK ditandai Terpakai')).toBeVisible();
  await page.getByRole('button', { name: 'Pindahkan sisa' }).click();

  const move = page.getByRole('dialog', { name: 'Pindahkan sisa Perpanjang STNK' });
  await expect(move.getByRole('heading', { name: 'Pindahkan sisa Rp38.000' })).toBeVisible();
  await move.getByRole('radio', { name: /^Servis motor/ }).check();
  await expect(move).toContainText('Servis motorRp720.000 → Rp758.000 dari Rp1.200.00060% → 63%');
  await screenshot(page, 'goals-move');
  await move.getByRole('button', { name: 'Pindahkan' }).click();
  await expect(page.getByText('Sisa dipindah ke Servis motor')).toBeVisible();
  await expect(page.getByText('Servis motor sekarang Rp758.000 dari Rp1.200.000 (63%).')).toBeVisible();
  await expect(goalRow(page, 'Servis motor')).toContainText('Rp758.000');
  // Used: STNK's Rp43.000 is no longer set aside on the 25th; October's is Liburan Bali + Servis motor.
  await expect(page.getByRole('region', { name: 'Dana tidak rutin' })).toContainText(
    'Total per bulanRp1.357.000/bulan',
  );
  await expect(page.getByRole('region', { name: 'Setoran Oktober' }).getByRole('listitem').last()).toContainText(
    'Rp1.107.000',
  );
  await page.getByRole('tab', { name: 'Selesai · 1' }).click();
  await expect(goalRow(page, 'Perpanjang STNK')).toContainText('Terpakai');
});

test('"Sisihkan tiap gajian" on the 25th waits in Perlu ditinjau and is recorded once confirmed', async ({ page }) => {
  // The payday set-aside (BCA Tahapan → Bank Jago, Rp1.107.000: no STNK, Asuransi motor only from November) is due on
  // 25 Okt.
  runScheduleJobs(user.email, '2026-10-25T10:00:00+07:00');
  await openGoals(page);
  const setAside = page.getByRole('region', { name: 'Setoran Oktober' }).getByRole('listitem').last();
  await expect(setAside).toContainText('Sisihkan dana tidak rutin');
  await expect(setAside).toContainText('Perlu ditinjau');
  // Nothing moved while it waits.
  await expect(goalRow(page, 'Dana Darurat')).toContainText('Rp11.125.000');

  await page.goto('/review');
  await page.waitForLoadState('networkidle');
  const card = page.getByRole('article', { name: 'Sisihkan dana tidak rutin', exact: true });
  await expect(card).toContainText('Rp1.107.000');
  await expect(card).toContainText('25 Okt');
  await screenshot(page, 'goals-review');
  await card.getByRole('button', { name: 'Sudah ditransfer' }).click();
  await expect(card).toHaveCount(0);

  await openGoals(page);
  await expect(setAside).toContainText('Tercatat');
  await expect(setAside).toContainText('+1.107.000');
  // Each share is now its fund's money in Bank Jago; Dana Darurat's fixed Rp8.125.000 there is unchanged.
  await expect(goalRow(page, 'Dana Darurat')).toContainText('Rp11.125.000');
  await expect(goalRow(page, 'Liburan Bali')).toContainText('Rp3.667.000');
  await expect(goalRow(page, 'Servis motor')).toContainText('Rp998.000');
});

test('the layout holds at 1024 and 768 px', async ({ page }) => {
  for (const width of [1024, 768]) {
    await page.setViewportSize({ width, height: 1100 });
    await openGoals(page);
    await expect(page.getByRole('region', { name: 'Ringkasan tabungan' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Setoran Oktober' })).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, `goals-${String(width)}`);
    await page.getByRole('button', { name: 'Dana Darurat', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Dana Darurat' })).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, `goals-detail-${String(width)}`);
    await page.keyboard.press('Escape');
  }
});
