// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Statement import (FR-L9, design e56WO/Z0eAyw/El2vm) as its own invited user with the design persona on 15 Okt 2026:
 * a BCA CSV is detected bank-side, 48 rows parse into 41 to import, 5 in-file duplicates, and 2 unreadable rows with
 * reasons; "Impor 41 transaksi" confirms them through the review queue in one go and the money lands in the account.
 * The file itself is parsed on the device and never leaves it (D4).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, projectUser, screenshot, setUpProjectUser, test } from './support.ts';

const user = projectUser('import');
test.describe.configure({ mode: 'serial' });
test.use({ storageState: user.state, viewport: { width: 1440, height: 1024 } });

test.beforeAll(async ({ browser }) => {
  await setUpProjectUser(browser, user, { persona: true });
});

/** 48 BCA rows: 41 unique, 5 repeats of earlier rows (in-file duplicates), 2 unreadable. */
function bcaStatement(): string {
  const row = (index: number) => {
    const day = ((index % 12) + 1).toString().padStart(2, '0');
    const amount = (150_000 + index * 1_000).toLocaleString('id-ID');
    return `${day}/09/2026,PEMBAYARAN TAGIHAN ${index},,${amount},9000000`;
  };
  const rows: string[] = ['Tanggal,Keterangan,Masuk,Keluar,Saldo Akhir'];
  for (let index = 1; index <= 41; index += 1) rows.push(row(index));
  // Five exact repeats of earlier rows of the same file: in-file duplicates.
  for (const index of [1, 2, 3, 4, 5]) rows.push(row(index));
  rows.push('31/09/2026,PEMBAYARAN TIDAK VALID,,100.000,9000000'); // no such calendar day
  rows.push('06/09/2026,PEMBAYARAN TAK TERBACA,,bukan angka,9000000'); // unreadable amount
  return rows.join('\n');
}

test('imports a BCA statement: 41 recorded, 5 duplicates skipped, 2 unreadable with reasons', async ({ page }) => {
  await page.goto('/transactions');
  await expect(page.getByRole('heading', { level: 1, name: 'Transaksi' })).toBeVisible();
  await page.getByRole('button', { name: 'Impor mutasi' }).click();
  const dialog = page.getByRole('dialog', { name: /Impor mutasi|Impor/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('File diproses di perangkatmu dan tidak disimpan');
  await dialog.getByRole('combobox', { name: /Pilih rekening/ }).click();
  await page.getByRole('option', { name: /BCA Tahapan/ }).click();

  const file = path.join(mkdtempSync(path.join(tmpdir(), 'wf-import-')), 'mutasi.csv');
  writeFileSync(file, bcaStatement(), 'utf8');
  await dialog.getByRole('button', { name: /Pilih file CSV atau XLSX/ }).click();
  await dialog.locator('input[type="file"]').setInputFiles(file);

  await expect(dialog).toContainText('terdeteksi format BCA');
  await expect(dialog).toContainText('Ditemukan48');
  await expect(dialog).toContainText('Akan diimpor41');
  await expect(dialog).toContainText('Duplikat dilewati5');
  await expect(dialog).toContainText('Gagal dibaca2');
  await expect(dialog).toContainText("Baris 47: format tanggal '31/09/2026' tidak valid");
  await expect(dialog).toContainText('Baris 48: kolom jumlah berisi');
  await screenshot(page, 'import-review');

  await dialog.getByRole('button', { name: 'Impor 41 transaksi' }).click();
  await expect(dialog).toContainText('Impor selesai');
  await expect(dialog).toContainText('41 transaksi tercatat');
  await expect(dialog).toContainText('5 duplikat dilewati');
  await screenshot(page, 'import-done');
  await dialog.getByRole('button', { name: 'Selesai' }).click();
  await expect(dialog).toBeHidden();
});
