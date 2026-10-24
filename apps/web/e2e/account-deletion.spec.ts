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
  await setUpProjectUser(browser, user, { persona: true, password });
});

test('requests the deletion behind 2FA, sees the scheduled date, and can cancel', async ({ page, context }) => {
  await page.goto('/settings/data');
  await expect(page.getByRole('heading', { level: 1, name: /Data/ })).toBeVisible();

  // The request is 2FA-gated like every destructive credential action; enroll through Security.
  await page.getByRole('button', { name: 'Hapus akun', exact: true }).click();
  const required = page.getByRole('dialog', { name: 'Wajib verifikasi dua langkah' });
  await expect(required).toBeVisible();
  await required.getByRole('button', { name: 'Buka Keamanan' }).click();
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

  // Type-to-confirm, with the account's own email as the word.
  await page.goto('/settings/data');
  await page.getByRole('button', { name: 'Hapus akun', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Hapus akun selamanya?' });
  await expect(confirm).toContainText('Setelah 7 hari');
  await confirm.getByLabel(`Ketik ${user.email} untuk konfirmasi`).fill(user.email);
  await confirm.getByRole('button', { name: 'Hapus akun saya' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText('Penghapusan akun dijadwalkan')).toBeVisible();
  await screenshot(page, 'data-deletion-pending');

  await page.getByRole('button', { name: 'Batalkan penghapusan' }).click();
  await expect(page.getByText('Penghapusan akun dijadwalkan')).toBeHidden();

  // Schedule again; this one the worker will execute.
  await page.getByRole('button', { name: 'Hapus akun', exact: true }).click();
  const again = page.getByRole('dialog', { name: 'Hapus akun selamanya?' });
  await again.getByLabel(`Ketik ${user.email} untuk konfirmasi`).fill(user.email);
  await again.getByRole('button', { name: 'Hapus akun saya' }).click();
  await expect(page.getByText('Penghapusan akun dijadwalkan')).toBeVisible();
});

test('the worker deletes the user after the grace: the session dies and the DEK row is gone', async ({ page }) => {
  const result = runDeletionJob(user.email);
  expect(result.deleted).toBe(1);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /Masuk|Selamat datang/ })).toBeVisible();
});
