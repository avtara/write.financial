// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Notifications (FR-S5) and Settings › Notifikasi (FR-ST3) as the Review queue's own invited user (`REVIEW_USER`),
 * after `review` ran the scheduled jobs to 18 Okt: Netflix's H-1 reminder and the due/overdue bills are in the bell's
 * popover ("Anggaran & tagihan"), an action opens `/review` (never records), "Tandai dibaca" leaves "Semua sudah
 * dibaca" with the next reminder, the page filters, searches, and pages; the settings hide a kind from the app and
 * move the reminder time. Keyboard only, and the rail's bell at 1024/768.
 */
import type { Page } from '@playwright/test';
import { expect, REVIEW_USER, screenshot, test } from './support.ts';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: REVIEW_USER.state, viewport: { width: 1440, height: 1000 } });

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

const bell = (page: Page) => page.getByRole('complementary').getByRole('button', { name: /^Notifikasi/ });
const popover = (page: Page) => page.getByRole('dialog', { name: 'Notifikasi' });

test('the bell lists the reminder and the due bills; an action opens the Review queue', async ({ page }) => {
  await open(page, '/');
  await expect(bell(page)).toHaveAccessibleName(/^Notifikasi, \d+ baru$/);
  await bell(page).click();
  const panel = popover(page);
  await expect(panel.getByRole('tab', { name: /^Anggaran & tagihan/ })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('article', { name: 'Netflix ditagih 18 Okt' })).toContainText(
    'Rp186.000 dari BCA Tahapan',
  );
  await expect(panel.getByRole('article', { name: 'Netflix jatuh tempo hari ini' })).toBeVisible();
  await screenshot(page, 'notifications-popover');
  // Actions only open a page: nothing is recorded from here.
  await panel
    .getByRole('article', { name: 'Netflix jatuh tempo hari ini' })
    .getByRole('button', { name: 'Buka Perlu ditinjau' })
    .click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(popover(page)).toHaveCount(0);
});

test('"Tandai dibaca" leaves "Semua sudah dibaca" with the next reminder', async ({ page }) => {
  await open(page, '/');
  await bell(page).click();
  const panel = popover(page);
  await expect(panel.getByRole('article').first()).toBeVisible();
  await panel.getByRole('button', { name: 'Tandai dibaca' }).click();
  await expect(panel).toContainText('Semua sudah dibaca');
  await expect(panel).toContainText(
    /Pengingat berikutnya: .+ ditagih .+ \(Rp[\d.]+\), dikirim (H-\d+|Hari H) jam \d{2}\.\d{2}\./,
  );
  await expect(bell(page)).toHaveAccessibleName('Notifikasi');
});

test('the page filters by type, searches, and keeps the 90-day note', async ({ page }) => {
  await open(page, '/notifications');
  await expect(page.getByRole('heading', { level: 1, name: 'Semua notifikasi' })).toBeVisible();
  const filters = page.getByRole('group', { name: 'Saring notifikasi' });
  await expect(filters.getByRole('button', { name: /^Belum dibaca 0$/ })).toBeVisible();
  await filters.getByRole('button', { name: /^Pengingat tagihan \d+$/ }).click();
  await expect(page).toHaveURL(/type=bill_reminder/);
  await expect(page.getByRole('article', { name: 'Netflix ditagih 18 Okt' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Netflix jatuh tempo hari ini' })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Cari notifikasi' }).fill('netflix');
  await expect(page).toHaveURL(/q=netflix/);
  await expect(page.getByRole('article', { name: 'Netflix ditagih 18 Okt' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Cari notifikasi' }).fill('tidak-ada-yang-cocok');
  await expect(page).toHaveURL(/q=tidak-ada-yang-cocok/);
  await expect(page.getByText('Tidak ada notifikasi')).toBeVisible();
  await expect(page.getByText('Notifikasi disimpan 90 hari, lalu dihapus otomatis.')).toBeVisible();
  await screenshot(page, 'notifications-page');
});

test('keyboard only: Tab to the bell, open it with Enter, close with Escape', async ({ page }) => {
  await open(page, '/');
  for (let tab = 0; tab < 10; tab++) {
    await page.keyboard.press('Tab');
    if (await bell(page).evaluate((element) => element === document.activeElement)) break;
  }
  await expect(bell(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(popover(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popover(page)).toHaveCount(0);
  await expect(bell(page)).toBeFocused();
});

test('Settings › Notifikasi hides a kind from the app and moves the reminder time', async ({ page }) => {
  await open(page, '/settings/notifications');
  await expect(page.getByText('Langganan & tagihan rutin sebelum jatuh tempo · jam 09.00')).toBeVisible();
  await page.getByRole('switch', { name: 'Di aplikasi untuk Pengingat tagihan' }).click();
  await page.getByRole('switch', { name: 'Email untuk Peringatan anggaran' }).click();
  await page.getByRole('combobox', { name: 'Jam pengingat' }).selectOption('07:00');
  await page.getByRole('button', { name: 'Simpan perubahan' }).click();
  // The section shares its name with the toast region; the toast is the list item.
  const toast = page.getByRole('listitem').filter({ hasText: 'Pengaturan notifikasi disimpan' });
  await expect(toast).toContainText(/\d+ pengingat dipindah ke jam 07\.00\./);

  // Hidden in the app: the page no longer lists bill reminders.
  await open(page, '/notifications?type=bill_reminder');
  await expect(page.getByText('Tidak ada notifikasi')).toBeVisible();
  await open(page, '/settings/notifications');
  await expect(page.getByRole('switch', { name: 'Di aplikasi untuk Pengingat tagihan' })).not.toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Jam pengingat' })).toHaveValue('07:00');
  // Back as it was.
  await page.getByRole('switch', { name: 'Di aplikasi untuk Pengingat tagihan' }).click();
  await page.getByRole('combobox', { name: 'Jam pengingat' }).selectOption('09:00');
  await page.getByRole('button', { name: 'Simpan perubahan' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tersinkron ke semua perangkat' })).toBeVisible();
});

for (const width of [1024, 768]) {
  test(`the rail's bell opens the popover at ${String(width)} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, '/');
    await bell(page).click();
    await expect(popover(page)).toBeVisible();
    const box = await popover(page).boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    await screenshot(page, `notifications-${String(width)}`);
  });
}
