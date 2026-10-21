// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Review queue (FR-L7) and repeating transactions (FR-T6, FR-L8) as its own invited user with the design persona:
 * the scheduled jobs are run up to 18 Okt 10.00 (`runScheduleJobs`), so Netflix's Rp186.000 bill (BCA Tahapan) is
 * due next to the seed's overdue iCloud+ and September's leftover proposal (Rp1.150.000). Balances change only when
 * the user confirms: "Sudah dibayar" takes Rp186.000 from BCA Tahapan, "Terapkan" asks before it moves anything.
 * Also keyboard only (⌘K to a review item), the layout at 1440/1024/768, and "Ulangi" in the Record sheet with
 * "Hentikan pengulangan" and Urungkan in the transaction detail.
 */
import type { Page } from '@playwright/test';
import {
  cardBalance,
  clearAuthCounters,
  expect,
  REVIEW_USER,
  runScheduleJobs,
  screenshot,
  seedDesignPersona,
  signUpInvited,
  test,
} from './support.ts';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: REVIEW_USER.state, viewport: { width: 1440, height: 1000 } });

test.beforeAll(async ({ browser }) => {
  const { email } = REVIEW_USER;
  await clearAuthCounters();
  const page = await signUpInvited(browser, email, 'Tari Wulandari', 1440);
  await expect(page).toHaveURL(/\/onboarding\/profile$/);
  await page.context().storageState({ path: REVIEW_USER.state });
  await page.context().close();
  // The persona (it completes the onboarding).
  await seedDesignPersona(email);
  // Netflix (18 Okt) is due; its H-1 reminder (17 Okt 09.00) has been sent.
  runScheduleJobs(email, '2026-10-18T10:00:00+07:00');
});

/** Opens `/review` once it is interactive (hydrated). */
async function openReview(page: Page) {
  await page.goto('/review');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { level: 1, name: 'Perlu ditinjau' })).toBeVisible();
}

async function bcaBalance(page: Page): Promise<number> {
  await page.goto('/transactions?range=2026-10-01..2026-10-15');
  await page.waitForLoadState('networkidle');
  return cardBalance(page, 'BCA Tahapan');
}

const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true });
const badge = (page: Page) =>
  page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link', { name: /^Perlu ditinjau/ });

for (const width of [1024, 768]) {
  test(`the queue at ${String(width)} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openReview(page);
    await expect(page.getByRole('region', { name: /tagihan langganan jatuh tempo/ })).toBeVisible();
    await expect(card(page, 'Pindahkan sisa anggaran ke Dana Darurat')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await screenshot(page, `review-${String(width)}`);
  });
}

test('Netflix is due on /review; "Sudah dibayar" takes Rp186.000 from BCA Tahapan only then', async ({ page }) => {
  const before = await bcaBalance(page);
  await openReview(page);
  const bills = page.getByRole('region', { name: /tagihan langganan jatuh tempo/ });
  await expect(bills).toContainText('write.financial tidak tahu apakah tagihan sudah ditarik.');
  const netflix = card(page, 'Netflix');
  await expect(netflix).toContainText('Rp186.000');
  await expect(netflix).toContainText('18 Okt');
  await expect(netflix).toContainText('belum tercatat. Saldo BCA Tahapan belum dipotong.');
  await expect(card(page, 'iCloud+')).toContainText('Jatuh tempo lewat 6 hari');
  // Confidence is shown for AI results only; these are schedules.
  await expect(page.getByText(/Yakin \d+%/)).toHaveCount(0);
  const pending = Number((await badge(page).innerText()).replace(/\D/g, ''));
  expect(pending).toBeGreaterThanOrEqual(3);
  await screenshot(page, 'review-1440');

  // Nothing changed while the bill waited.
  expect(await bcaBalance(page)).toBe(before);

  await openReview(page);
  await card(page, 'Netflix').getByRole('button', { name: 'Sudah dibayar' }).click();
  await expect(page.getByRole('region', { name: 'Notifikasi' })).toContainText('Netflix · −Rp186.000');
  await expect(card(page, 'Netflix')).toHaveCount(0);
  await expect(badge(page)).toHaveText(`Perlu ditinjau${String(pending - 1)}`);
  expect(await bcaBalance(page)).toBe(before - 186_000);
});

test('September\'s proposal: "Terapkan" changes nothing until "Konfirmasi"', async ({ page }) => {
  const before = await bcaBalance(page);
  await openReview(page);
  const proposal = card(page, 'Pindahkan sisa anggaran ke Dana Darurat');
  await expect(proposal).toContainText('Rp1.150.000');
  await expect(page.getByRole('region', { name: /Usulan penutupan periode/ })).toContainText(
    'periode September 2026 sudah ditutup',
  );
  await proposal.getByRole('button', { name: 'Terapkan' }).click();
  const dialog = page.getByRole('dialog', { name: 'Terapkan usulan?' });
  await expect(dialog).toContainText('Belum ada yang berubah sampai kamu konfirmasi.');
  await expect(dialog).toContainText('Pindahkan sisa anggaran ke Dana Darurat: BCA Tahapan →');
  await dialog.getByRole('button', { name: 'Batal' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await bcaBalance(page)).toBe(before);

  await openReview(page);
  await card(page, 'Pindahkan sisa anggaran ke Dana Darurat').getByRole('button', { name: 'Terapkan' }).click();
  await page.getByRole('dialog', { name: 'Terapkan usulan?' }).getByRole('button', { name: 'Konfirmasi' }).click();
  await expect(page.getByRole('region', { name: 'Notifikasi' })).toContainText('Usulan diterapkan');
  await expect(card(page, 'Pindahkan sisa anggaran ke Dana Darurat')).toHaveCount(0);
  expect(await bcaBalance(page)).toBe(before - 1_150_000);
});

test('keyboard only: ⌘K finds the iCloud+ bill, and Enter marks it paid', async ({ page }) => {
  const before = await bcaBalance(page);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Cari atau jalankan perintah' });
  // The palette's content loads on first open; type once its field has the focus.
  await expect(palette.getByRole('combobox')).toBeFocused();
  await page.keyboard.type('icloud');
  // iCloud+'s past bills are transactions too; the pending one is in "Perlu ditinjau", after them.
  const result = palette.getByRole('group', { name: /Perlu ditinjau/ }).getByRole('option', { name: /iCloud\+/ });
  await expect(result).toBeVisible();
  while ((await result.getAttribute('aria-selected')) !== 'true') await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/review\?item=/);
  const icloud = card(page, 'iCloud+');
  await expect(icloud.getByRole('button', { name: 'Belum' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(icloud.getByRole('button', { name: 'Sudah dibayar' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(card(page, 'iCloud+')).toHaveCount(0);
  expect(await bcaBalance(page)).toBe(before - 45_000);
});

test('"Ulangi" repeats a new expense weekly; the detail stops it after asking, and Urungkan brings it back', async ({
  page,
}) => {
  await page.goto('/transactions?range=2026-10-01..2026-10-15');
  await page.waitForLoadState('networkidle');
  // Opened with Enter on the header's button, the sheet keeps the focus (on Jumlah) once its data has loaded.
  await page
    .getByRole('main')
    .getByRole('button', { name: /^Catat/ })
    .first()
    .focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Catat Transaksi' });
  await expect(sheet.getByRole('button', { name: /^Hiburan/ })).toBeVisible();
  await expect(sheet.getByRole('textbox', { name: 'Jumlah' })).toBeFocused();
  await sheet.getByRole('textbox', { name: 'Jumlah' }).fill('150000');
  await sheet.getByRole('button', { name: /^Hiburan/ }).click();
  await sheet.getByRole('textbox', { name: 'Catatan', exact: true }).fill('Futsal mingguan');
  await sheet.getByRole('button', { name: 'Ulangi', exact: true }).click();
  await sheet.getByRole('radio', { name: 'Mingguan' }).click();
  const repeat = sheet.getByRole('region', { name: 'Ulangi setiap minggu' });
  await expect(repeat).toContainText('Tiap Kamis · masuk Perlu ditinjau dulu');
  await expect(repeat.getByRole('list', { name: 'Jadwal berikutnya' })).toHaveText('22 Okt29 Okt5 Nov');
  await sheet.getByRole('button', { name: /^Simpan/ }).click();
  await expect(sheet).toHaveCount(0);

  const row = page.getByRole('region', { name: 'Daftar transaksi' }).getByRole('group', { name: 'Futsal mingguan' });
  await row.first().click();
  const detail = page.getByRole('complementary').filter({ hasText: 'Detail transaksi' });
  await expect(detail.getByText('Berulang · Mingguan')).toBeVisible();
  const section = detail.getByRole('region', { name: 'Ulangi' });
  await expect(section.getByRole('list', { name: 'Berikutnya' })).toHaveText('22 Okt29 Okt5 Nov');
  await section.getByRole('switch', { name: 'Ulangi transaksi ini' }).click();
  const confirm = page.getByRole('dialog', { name: 'Hentikan pengulangan?' });
  await expect(confirm).toContainText('Jadwal mulai 22 Okt dihapus dari kalender dan pengingat H-1 dimatikan.');
  await expect(confirm).toContainText('Transaksi 15 Okt tetap tercatat · saldo tidak berubah');
  await confirm.getByRole('button', { name: 'Hentikan' }).click();
  const toast = page.getByRole('region', { name: 'Notifikasi' });
  await expect(toast).toContainText('Pengulangan dihentikan');
  await expect(detail.getByText('Tidak berulang')).toBeVisible();
  await expect(detail.getByText(/Pengulangan dihentikan · \d+ jadwal dihapus/)).toBeVisible();
  // The "Tercatat" toast may still offer its own Urungkan.
  await toast
    .getByRole('listitem')
    .filter({ hasText: 'Pengulangan dihentikan' })
    .getByRole('button', { name: 'Urungkan' })
    .click();
  await expect(toast).toContainText('Pengulangan dinyalakan lagi');
  await expect(detail.getByText('Berulang · Mingguan')).toBeVisible();
});
