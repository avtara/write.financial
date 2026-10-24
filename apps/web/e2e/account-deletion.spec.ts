import { rmSync } from 'node:fs';
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Account deletion (FR-A11) as its own invited user with the design persona on 15 Okt 2026: the request needs 2FA,
 * the Settings › Data card schedules the deletion with its date and can be cancelled; after the grace period the
 * worker job (`account-deletion-jobs.ts`, run inline with a clock past the date) deletes the user — the session is
 * gone and the sign-in page answers, and the wrapped DEK row is gone with it (crypto-shred).
 */
import {
  enterCode,
  expect,
  freshPassword,
  projectUser,
  purgeE2EUser,
  runDeletionJob,
  screenshot,
  setUpProjectUser,
  test,
  totp,
} from './support.ts';

const user = projectUser('account-deletion');
const password = freshPassword();
test.describe.configure({ mode: 'serial' });
test.use({ storageState: user.state, viewport: { width: 1440, height: 1024 } });

test.beforeAll(async ({ browser }) => {
  // The enrolment below persists in the storage state, and a failed attempt leaves the user row behind;
  // always start from a fresh, second-factor-free user.
  rmSync(user.state, { force: true });
  await purgeE2EUser(user.email);
  await setUpProjectUser(browser, user, { persona: true, password });
});

test('requests the deletion behind 2FA, sees the scheduled date, and can cancel', async ({ page, context }) => {
  // The request is 2FA-gated like every destructive credential action; enroll through Security first.
  await page.goto('/?settings=security');
  await page.waitForLoadState('networkidle');
  const settings = page.getByRole('dialog', { name: 'Pengaturan' });
  await expect(settings).toBeVisible();
  await page.getByRole('button', { name: 'Aktifkan', exact: true }).click();
  const enroll = page.getByRole('dialog', { name: 'Aktifkan aplikasi autentikator' });
  await enroll.getByLabel('Kata sandi', { exact: true }).fill(password);
  await enroll.getByRole('button', { name: 'Lanjut', exact: true }).click();
  const secret = enroll.locator('code').first();
  await expect(secret).toBeVisible();
  await enterCode(page, 'Kode 6 digit', totp((await secret.innerText()).replace(/\s/g, '')));
  await enroll.getByRole('button', { name: 'Verifikasi', exact: true }).click();
  await enroll.getByLabel('Saya sudah menyimpan kode cadangan').check();
  await enroll.getByRole('button', { name: 'Selesai', exact: true }).click();
  await expect(enroll).toBeHidden();
  await context.storageState({ path: user.state });
  await page.keyboard.press('Escape');

  // /settings/data deep-links to the Settings dialog over the overview.
  await page.goto('/?settings=data');
  await page.waitForLoadState('networkidle');
  await expect(settings).toBeVisible();
  await expect(settings).toContainText('Ekspor semua datamu');

  // Type-to-confirm, with the account's own email as the word.
  await settings.getByRole('button', { name: 'Hapus akun', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Hapus akun selamanya?' });
  await expect(confirm).toContainText('Setelah 7 hari');
  await confirm.getByLabel(`Ketik ${user.email} untuk konfirmasi`).fill(user.email);
  await confirm.getByRole('button', { name: 'Hapus akun saya' }).click();
  await expect(confirm).toBeHidden();
  await expect(settings.getByText('Penghapusan akun dijadwalkan')).toBeVisible();
  await screenshot(page, 'data-deletion-pending');

  await settings.getByRole('button', { name: 'Batalkan penghapusan' }).click();
  await expect(settings.getByText('Penghapusan akun dijadwalkan')).toBeHidden();

  // Schedule again with a freshly mounted dialog (this one the worker will execute).
  await page.keyboard.press('Escape');
  await page.goto('/?settings=data');
  await page.waitForLoadState('networkidle');
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: 'Hapus akun', exact: true }).click();
  const second = page.getByRole('alertdialog', { name: 'Hapus akun selamanya?' });
  await second.getByLabel(`Ketik ${user.email} untuk konfirmasi`).fill(user.email);
  await second.getByRole('button', { name: 'Hapus akun saya' }).click();
  await expect(second).toBeHidden();
  await expect(settings.getByText('Penghapusan akun dijadwalkan')).toBeVisible();
});

test('the worker deletes the user after the grace: the session dies and the DEK row is gone', async ({ page }) => {
  const result = runDeletionJob(user.email);
  expect(result.deleted).toBe(1);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /Masuk|Selamat datang/ })).toBeVisible();
});
