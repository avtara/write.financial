// SPDX-License-Identifier: AGPL-3.0-only
/**
 * M7.1 auto rules (FR-AI1) as their own invited user with the design persona on 15 Okt 2026: create a rule with an
 * IF/THEN editor and a trial preview, apply its output as a suggestion in the unsaved Quick Add draft, turn four
 * manual category corrections into a suggestion, create that rule, and apply a backfill only after selecting rows and
 * confirming. Amounts, postings, and balances are read from PostgreSQL before and after and never change.
 */
import type { Page } from '@playwright/test';
import postgres from 'postgres';
import { expect, projectUser, runRulesBackfillJob, screenshot, setUpProjectUser, test } from './support.ts';
import { e2eEnv } from './env.ts';

const user = projectUser('rules');
/** Unique to this spec's own user: seeded persona merchants cannot match the rule or the backfill. */
const FIXTURE = 'Kopi Kenangan Uji';
test.describe.configure({ mode: 'serial' });
test.use({ storageState: user.state, viewport: { width: 1440, height: 1024 } });

test.beforeAll(async ({ browser }) => {
  await setUpProjectUser(browser, user, { persona: true });
});

const sql = () => postgres(e2eEnv()['DATABASE_URL_SUPERUSER'] ?? '', { max: 1, onnotice: () => undefined });

/** The user's money rows for one description: the amount and category of the transaction plus its postings. */
async function moneyRows(description: string) {
  const db = sql();
  try {
    const rows = await db<
      { amount: string; category: string | null; postings: string; deleted: boolean }[]
    >`SELECT t.category_id::text AS category,
             (SELECT coalesce(sum(p.amount_minor), 0)::text FROM postings p WHERE p.transaction_id = t.id) AS postings,
             t.deleted_at IS NOT NULL AS deleted,
             t.id::text AS id
      FROM transactions t JOIN users u ON u.id = t.user_id
      WHERE u.email = ${user.email} AND t.description = ${description}
      ORDER BY t.id`;
    return rows;
  } finally {
    await db.end();
  }
}

const bar = (page: Page) => page.getByRole('form', { name: 'Catat cepat' });

/** A retry starts from the same data (the project user is reused): drop only this spec's rules and entries. */
async function resetRulesData(): Promise<void> {
  const db = sql();
  try {
    await db`UPDATE users SET locale = 'id'::locale WHERE email = ${user.email}`;
    await db`DELETE FROM auto_rules WHERE user_id = (SELECT id FROM users WHERE email = ${user.email})`;
    await db`DELETE FROM auto_rule_suggestion_dismissals WHERE user_id = (SELECT id FROM users WHERE email = ${user.email})`;
    await db`DELETE FROM transactions WHERE user_id = (SELECT id FROM users WHERE email = ${user.email})
             AND (description = 'Gojek ke kantor' OR description LIKE 'Kopi Kenangan%')`;
  } finally {
    await db.end();
  }
}

/** One Quick Add entry with a category picked explicitly (no history guess). */
async function quickAdd(page: Page, description: string, amount: string, category: string) {
  const form = bar(page);
  await form.getByRole('textbox', { name: 'Catatan' }).fill(description);
  await form.getByRole('textbox', { name: 'Jumlah' }).fill(amount);
  await form.getByRole('button', { name: 'Kategori' }).click();
  await page.getByRole('option', { name: category }).click();
  await form.getByRole('button', { name: 'Simpan' }).click();
  await expect(page.getByText('Transaksi tersimpan').last()).toBeVisible();
  // The bar clears only after the save; the next entry fills the fresh form.
  await expect(form.getByRole('textbox', { name: 'Catatan' })).toHaveValue('');
}

/** Edits one recorded transaction's category through the detail panel. */
async function correctCategory(page: Page, description: string, category: string, fromCategory: string, index: number) {
  await page.goto('/transactions?period=2026-10');
  await page
    .getByRole('region', { name: 'Daftar transaksi' })
    .getByRole('group', { name: new RegExp(description) })
    .nth(index)
    .click();
  const panel = page.getByRole('complementary', { name: 'Detail transaksi' });
  await expect(panel.getByRole('heading', { name: description })).toBeVisible();
  await panel.getByRole('button', { name: 'Ubah' }).click();
  await expect(
    panel.getByRole('group', { name: 'Kategori' }).getByRole('button', { name: fromCategory }),
  ).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('group', { name: 'Kategori' }).getByRole('button', { name: category }).click();
  await panel.getByRole('button', { name: 'Simpan perubahan' }).click();
  await expect(page.getByText('Perubahan tersimpan').last()).toBeVisible();
}

test('creates a rule with a trial preview and applies it in the unsaved Quick Add draft', async ({ page }) => {
  await resetRulesData();
  await page.goto('/?settings=rules');
  const dialog = page.getByRole('dialog', { name: 'Pengaturan' });
  await expect(dialog.getByRole('heading', { name: 'Aturan otomatis' })).toBeVisible();
  await expect(dialog.getByText('Belum ada aturan. Tambahkan satu, atau mulai dari saran koreksimu.')).toBeVisible();

  await dialog.getByRole('button', { name: 'Aturan baru' }).click();
  await dialog.getByLabel('Nama aturan').fill('Berangkat ke kantor');
  await dialog.getByLabel('Deskripsi', { exact: true }).fill('gojek, krl');
  // Hari · salah satu · Kamis.
  await dialog.getByRole('button', { name: 'Tambah kondisi' }).click();
  await dialog.getByRole('combobox', { name: 'Tambah kondisi' }).selectOption({ label: 'Hari' });
  await dialog.getByRole('group', { name: 'Hari' }).getByRole('button', { name: 'Kamis' }).click();
  // Jam · sebelum 10.00.
  await dialog.getByRole('button', { name: 'Tambah kondisi' }).click();
  await dialog.getByRole('combobox', { name: 'Tambah kondisi' }).selectOption({ label: 'Jam' });
  await dialog.getByLabel('Jam', { exact: true }).fill('10:00');
  // MAKA kategori Transportasi and #kantor.
  await dialog.getByRole('button', { name: 'Tambah tindakan' }).click();
  await dialog.getByRole('combobox', { name: 'Tambah tindakan' }).selectOption({ label: 'Atur kategori' });
  await dialog.getByLabel('Kategori', { exact: true }).selectOption({ label: 'Transportasi' });
  await dialog.getByRole('button', { name: 'Tambah tindakan' }).click();
  await dialog.getByRole('combobox', { name: 'Tambah tindakan' }).selectOption({ label: 'Tambah tag' });
  await dialog.getByLabel('Tag', { exact: true }).fill('kantor');

  await dialog.getByLabel('Deskripsi uji').fill('Gojek ke kantor');
  await dialog.getByLabel('Jam uji').fill('09:30');
  await dialog.getByLabel('Rekening uji').selectOption({ label: 'BCA Tahapan' });
  await dialog.getByRole('button', { name: 'Uji' }).click();
  await expect(dialog.getByText('Cocok dengan contoh transaksi')).toBeVisible();
  await expect(dialog.getByText(/Deskripsi berisi salah satu: gojek, krl · cocok/)).toBeVisible();
  await expect(dialog.getByText(/Hasil: Transportasi · #kantor/)).toBeVisible();
  await expect(dialog.getByText(/transaksi 2026-10 cocok/)).toBeVisible();
  await screenshot(page, 'rules-editor-1440');

  await dialog.getByRole('button', { name: 'Simpan aturan' }).click();
  await expect(dialog.getByText('Berangkat ke kantor', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Aktif · 1')).toBeVisible();
  await screenshot(page, 'rules-settings-1440');

  for (const [width, height] of [
    [1024, 768],
    [768, 1024],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(dialog.getByRole('heading', { name: 'Aturan otomatis' })).toBeVisible();
    await screenshot(page, `rules-settings-${String(width)}`);
  }
  await page.setViewportSize({ width: 1440, height: 1024 });

  // The English catalog on the same surface, through the user menu's language switch.
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: /^(Menu pengguna|User menu)$/ }).click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(page.getByRole('link', { name: 'Overview' })).toBeVisible();
  await expect
    .poll(async () => (await page.context().cookies()).find((cookie) => cookie.name === 'wf_locale')?.value)
    .toBe('en');
  await page.goto('/?settings=rules');
  const english = page.getByRole('dialog', { name: 'Settings' });
  await expect(english.getByRole('heading', { name: 'Auto rules' })).toBeVisible();
  await expect(english.getByRole('button', { name: 'New rule' })).toBeVisible();
  await screenshot(page, 'rules-settings-en-1440');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^(Menu pengguna|User menu)$/ }).click();
  await page.getByRole('menuitemradio', { name: 'Bahasa Indonesia' }).click();
  await expect(page.getByRole('link', { name: 'Ringkasan' })).toBeVisible();
  await expect
    .poll(async () => (await page.context().cookies()).find((cookie) => cookie.name === 'wf_locale')?.value)
    .toBe('id');
  await page.goto('/?settings=rules');
  await expect(dialog.getByRole('heading', { name: 'Aturan otomatis' })).toBeVisible();

  // The unsaved Quick Add draft: the rule's category and tag appear before saving; nothing is recorded yet.
  await page.goto('/');
  const before = await moneyRows('Gojek ke kantor');
  expect(before).toEqual([]);
  await bar(page).getByRole('textbox', { name: 'Catatan' }).fill('Gojek ke kantor');
  await bar(page).getByRole('textbox', { name: 'Jumlah' }).fill('25.000');
  const suggestion = bar(page).getByRole('region', { name: 'Aturan “Berangkat ke kantor” cocok' });
  await expect(suggestion).toBeVisible();
  await expect(suggestion.getByText('Kategori: Transportasi')).toBeVisible();
  await expect(suggestion.getByText('#kantor')).toBeVisible();
  await screenshot(page, 'rules-quick-add-suggestion');
  expect(await moneyRows('Gojek ke kantor')).toEqual([]);
  await suggestion.getByRole('button', { name: 'Terapkan' }).click();
  await expect(bar(page).getByRole('button', { name: 'Kategori' })).toHaveText('Transportasi');
  await bar(page).getByRole('button', { name: 'Simpan' }).click();
  await expect(page.getByText('Transaksi tersimpan').last()).toBeVisible();
  const [saved] = await moneyRows('Gojek ke kantor');
  expect(saved?.postings).toBe('-25000');
  expect(saved?.category).not.toBeNull();
});

test('suggests a rule after four manual corrections and applies a confirmed backfill', async ({ page }) => {
  await resetRulesData();
  await page.goto('/');
  // Four distinct corrections of one description, plus one untouched row for the backfill.
  for (let index = 0; index < 5; index += 1) await quickAdd(page, FIXTURE, '25.000', 'Makan & Dapur');
  for (let index = 0; index < 4; index += 1)
    await correctCategory(page, FIXTURE, 'Transportasi', 'Makan & Dapur', index);

  await page.goto('/?settings=rules');
  const dialog = page.getByRole('dialog', { name: 'Pengaturan' });
  await expect(dialog.getByText('Saran dari pola koreksimu')).toBeVisible();
  await expect(
    dialog.getByText(new RegExp(`4× kamu mengubah “${FIXTURE}” dari Makan & Dapur ke Transportasi`)),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Buat aturan' }).click();
  await expect(dialog.getByLabel('Nama aturan')).toHaveValue(FIXTURE);
  // Saving is the user's confirmation of the suggested rule.
  await dialog.getByRole('button', { name: 'Simpan aturan' }).click();
  await expect(dialog.getByText(FIXTURE, { exact: true })).toBeVisible();

  const before = await moneyRows(FIXTURE);
  expect(before).toHaveLength(5);
  const beforeMoney = before.map((row) => row.postings);
  const distinctCategories = new Set(before.map((row) => row.category));
  expect(distinctCategories.size).toBe(2);

  await dialog.getByRole('button', { name: 'Terapkan ke transaksi lama' }).click();
  // The dialog queued it; this run has no resident worker, so the real job is executed inline.
  runRulesBackfillJob();
  const backfill = page.getByRole('dialog', { name: 'Terapkan ke transaksi lama' });
  await expect(backfill.getByRole('list', { name: 'Usulan perubahan' })).toBeVisible();
  await screenshot(page, 'rules-backfill-review');
  // Previewing writes nothing.
  expect((await moneyRows(FIXTURE)).map((row) => row.postings)).toEqual(beforeMoney);

  await expect(backfill.getByText('Tidak ada perubahan')).toHaveCount(4);
  const apply = backfill.getByRole('button', { name: 'Terapkan 1 perubahan' });
  await apply.click();
  const confirm = page.getByRole('alertdialog', { name: 'Terapkan ke transaksi lama?' });
  await expect(confirm).toBeVisible();
  await screenshot(page, 'rules-backfill-confirm');
  await confirm.getByRole('button', { name: 'Terapkan 1 perubahan' }).click();
  await expect(backfill.getByText(/^1 diterapkan/)).toBeVisible();

  const after = await moneyRows(FIXTURE);
  // Money is untouched; exactly the one previously untouched row changed category.
  expect(after.map((row) => row.postings)).toEqual(beforeMoney);
  expect(after.filter((row, index) => row.category !== before[index]?.category)).toHaveLength(1);
  expect(new Set(after.map((row) => row.category)).size).toBe(1);
  await screenshot(page, 'rules-backfill-done');
});
