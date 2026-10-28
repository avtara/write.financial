// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app lock (FR-A6) as its own invited user with the design persona: Settings › Keamanan sets a 6-digit PIN for
 * this browser; five idle minutes later (the page clock fast-forwarded) the lock screen replaces the app — no amounts,
 * no shortcuts — and stays after a reload; wrong PINs count down, the right one opens the app again. "Lupa PIN? Masuk
 * dengan kata sandi" signs out to the sign-in page and removes the PIN, so signing in again opens the app unlocked.
 */
import { rmSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  expect,
  freshPassword,
  projectUser,
  purgeE2EUser,
  setUpProjectUser,
  signInWithPassword,
  test,
} from './support.ts';

const user = projectUser('app-lock');
const password = freshPassword();
const PIN = '246810';
test.describe.configure({ mode: 'serial' });
test.use({ storageState: user.state, viewport: { width: 1440, height: 900 } });

test.beforeAll(async ({ browser }) => {
  // The PIN lives in the browser and the second test signs out: always start from a fresh user and session.
  rmSync(user.state, { force: true });
  await purgeE2EUser(user.email);
  await setUpProjectUser(browser, user, { persona: true, password });
});

const lockScreen = (page: Page) => page.getByRole('main', { name: 'Aplikasi terkunci · Pengguna E2E' });

/** Settings › Keamanan › Kunci aplikasi: a new PIN, entered twice on the keypad (by mouse, then by keyboard). */
async function enablePin(page: Page) {
  await page.goto('/?settings=security');
  await page.waitForLoadState('networkidle');
  const toggle = page.getByRole('switch', { name: 'Kunci aplikasi' });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  const dialog = page.getByRole('dialog', { name: 'Buat PIN' });
  const keypad = dialog.getByRole('group', { name: 'Masukkan PIN baru' });
  for (const digit of PIN) await keypad.getByRole('button', { name: digit, exact: true }).click();
  await expect(dialog.getByRole('group', { name: 'Ulangi PIN baru' })).toBeVisible();
  await page.keyboard.type(PIN);
  await expect(dialog).toBeHidden();
  await expect(toggle).toBeChecked();
  await expect(page.getByLabel('Kunci otomatis')).toHaveValue('5');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Pengaturan' })).toBeHidden();
}

test('locks after five idle minutes, also across a reload, and opens with the right PIN', async ({ page }) => {
  await enablePin(page);
  await expect(page.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible();

  await page.clock.fastForward('04:30');
  await expect(page.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible();
  await page.clock.fastForward('00:40');
  await expect(lockScreen(page)).toBeVisible();
  await expect(lockScreen(page)).toContainText('Terkunci otomatis setelah 5 menit tidak aktif');
  // Instead of the app, not over it: no amount and no navigation exist, and the shortcuts are gone.
  await expect(page.getByRole('navigation', { name: 'Navigasi utama' })).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toMatch(/Rp\s?\d/);
  await page.keyboard.press('n');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(lockScreen(page)).toBeVisible();

  // Reopening after the idle minutes starts locked, without the app's content even in the first render.
  await page.reload();
  await expect(lockScreen(page)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navigasi utama' })).toHaveCount(0);

  await page.keyboard.type('111111');
  await expect(lockScreen(page).getByRole('alert')).toHaveText('PIN salah · sisa 4 percobaan');
  await page.keyboard.type('222222');
  await expect(lockScreen(page).getByRole('alert')).toHaveText('PIN salah · sisa 3 percobaan');
  await page.keyboard.type(PIN);
  await expect(lockScreen(page)).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible();
  await page.keyboard.press('n');
  await expect(page.getByRole('dialog', { name: 'Catat Transaksi' })).toBeVisible();
});

test('"Lupa PIN?" signs out to the sign-in page and removes the PIN from this device', async ({ page }) => {
  // Each test has its own browser context, and the PIN lives in that context's IndexedDB: set it here again.
  await enablePin(page);
  await expect(page.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible();
  await page.clock.fastForward('05:10');
  await expect(lockScreen(page)).toBeVisible();
  await lockScreen(page).getByRole('button', { name: 'Lupa PIN? Masuk dengan kata sandi' }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  await signInWithPassword(page, { name: 'Pengguna E2E', email: user.email, password });
  await expect(page.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible();
  await page.goto('/?settings=security');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('switch', { name: 'Kunci aplikasi' })).not.toBeChecked();
  await page.keyboard.press('Escape');
  await page.clock.fastForward('10:00');
  await expect(page.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible();
  await expect(lockScreen(page)).toHaveCount(0);
});
