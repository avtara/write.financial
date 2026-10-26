// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The M7 exit (FR-AI3) as its own invited user with the design persona on 15 Okt 2026: ⌘J and the ⌘K "Tanya Asisten"
 * row show the "Belum ada penyedia AI" state, the user enrolls 2FA and configures BYOK through Settings › AI agent
 * (fake provider, `e2e/ai-fetch.ts` — no real AI API is ever reached), the Assistant answers "berapa pengeluaran
 * Oktober?" from the ledger (the spending data card with the seed's Rp16.500.000 and a source chip), "45.000 GoPay"
 * becomes a draft card (Makan & Dapur jadi 93%, saldo GoPay Rp367.000) whose "Ubah" prefills the Record sheet and
 * whose "Simpan" records the row with source=assistant, and an unconfirmed draft never reaches /transactions.
 * Amounts and sources are also read from PostgreSQL.
 */
import type { Page } from '@playwright/test';
import postgres from 'postgres';
import { e2eEnv } from './env.ts';
import {
  clearAuthCounters,
  enterCode,
  expect,
  freshPassword,
  projectUser,
  screenshot,
  setUpProjectUser,
  test,
  totp,
} from './support.ts';

const user = projectUser('assistant');
const password = freshPassword();
/** The enrolled authenticator's base32 secret, captured in the setup test for the re-authentication dialog. */
let totpSecret = '';
// The suite is stateful (2FA enrollment, saved AI settings, a recorded draft); a retry after a partial run cannot
// repeat the enrollment, so a failure is reported instead of retried — like `market-api.spec.ts`.
test.describe.configure({ mode: 'serial', retries: 0 });
test.use({ storageState: user.state, viewport: { width: 1440, height: 1024 } });

test.beforeAll(async ({ browser }) => {
  await setUpProjectUser(browser, user, { persona: true, password });
});

test.beforeEach(clearAuthCounters);

const sql = () => postgres(e2eEnv()['DATABASE_URL_SUPERUSER'] ?? '', { max: 1, onnotice: () => undefined });

/** The user's recorded rows for one description: the amount, category, and source of the transaction plus its postings. */
async function moneyRows(description: string) {
  const db = sql();
  try {
    return await db<
      { amount: string; category: string | null; source: string; postings: string }[]
    >`SELECT t.category_id::text AS category,
             (SELECT coalesce(sum(p.amount_minor), 0)::text FROM postings p WHERE p.transaction_id = t.id) AS postings,
             t.source::text AS source,
             t.id::text AS id
      FROM transactions t JOIN users u ON u.id = t.user_id
      WHERE u.email = ${user.email} AND t.description = ${description}
      ORDER BY t.id`;
  } finally {
    await db.end();
  }
}

const assistant = (page: Page) => page.getByRole('dialog', { name: 'Asisten' });
const composer = (page: Page) => assistant(page).getByRole('textbox', { name: 'Pertanyaan untuk Asisten' });
const draftCard = (page: Page) => assistant(page).getByRole('group', { name: 'Draft transaksi' });

/**
 * Presses a chord until the page answers: Chromium can deliver the first keystrokes before React has hydrated the
 * shortcut listener, and a lost chord is indistinguishable from a closed sheet. Each press re-checks, so a chord that
 * toggles (⌘K) still settles on "open".
 */
async function pressUntil(page: Page, keys: string, open: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.keyboard.press(keys);
    await page.waitForTimeout(200);
    if (await open()) return;
  }
  await expect.poll(open, { timeout: 5_000 }).toBe(true);
}

const paletteOpen = (page: Page) => page.getByRole('dialog', { name: 'Cari atau jalankan perintah' }).isVisible();

/** Opens the Assistant with ⌘J and sends `question` (the stub answers from the ledger or proposes a draft). */
async function ask(page: Page, question: string) {
  await pressUntil(page, 'Control+j', () => assistant(page).isVisible());
  await composer(page).fill(question);
  await assistant(page).getByRole('button', { name: 'Kirim' }).click();
}

/**
 * If the save opened "Masuk lagi untuk melanjutkan" (the session is older than the fresh window), signs in again with
 * the password and the enrolled authenticator; the AI settings save retries on its own afterwards.
 */
async function reauthIfAsked(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Masuk lagi untuk melanjutkan' });
  if (!(await dialog.isVisible())) return;
  await dialog.getByLabel('Kata sandi').fill(password);
  await dialog.getByRole('button', { name: 'Lanjut' }).click();
  await enterCode(page, 'Kode verifikasi', totp(totpSecret));
  await dialog.getByRole('button', { name: 'Verifikasi' }).click();
}

test('opens with ⌘J and through the ⌘K "Tanya Asisten" row into the not-connected state', async ({ page }) => {
  await page.goto('/');

  await pressUntil(page, 'Control+j', () => assistant(page).isVisible());
  await expect(assistant(page).getByRole('heading', { name: 'Belum ada penyedia AI' })).toBeVisible();
  await expect(
    assistant(page).getByText(
      'Asisten memakai API key milikmu (BYOK) dari OpenRouter, ZenMux, atau endpoint OpenAI-compatible.',
    ),
  ).toBeVisible();
  await expect(assistant(page).getByText('Pencarian ⌘K tetap berfungsi tanpa AI.')).toBeVisible();
  await screenshot(page, 'assistant-not-connected');

  // The design's action opens Settings › AI agent, which demands 2FA before anything can be saved.
  await assistant(page).getByRole('button', { name: 'Buka Pengaturan → AI agent' }).click();
  const settings = page.getByRole('dialog', { name: 'Pengaturan' });
  await expect(settings.getByRole('heading', { name: 'AI agent (BYOK)' })).toBeVisible();
  await expect(
    settings.getByText('Aktifkan verifikasi dua langkah di Keamanan sebelum menyimpan konfigurasi AI.'),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).not.toBeVisible();

  // The ⌘K palette forwards a query that matches nothing to the Assistant.
  await pressUntil(page, 'Control+k', () => paletteOpen(page));
  const palette = page.getByRole('dialog', { name: 'Cari atau jalankan perintah' });
  await palette.getByRole('combobox').fill('zz tidak ada hasil');
  await expect(palette.getByRole('listbox').getByText('Tidak ada hasil untuk “zz tidak ada hasil”')).toBeVisible();
  await palette.getByRole('option', { name: 'Tanya Asisten' }).click();
  await expect(assistant(page).getByRole('heading', { name: 'Belum ada penyedia AI' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('configures BYOK after enrolling 2FA and tests the connection against the fake provider', async ({
  page,
  context,
}) => {
  // The AI settings save needs 2FA: enroll an authenticator through Keamanan (and keep its secret for re-auth).
  await page.goto('/?settings=security');
  const settings = page.getByRole('dialog', { name: 'Pengaturan' });
  await settings.getByRole('button', { name: 'Aktifkan', exact: true }).click();
  const enroll = page.getByRole('dialog', { name: 'Aktifkan aplikasi autentikator' });
  await enroll.getByLabel('Kata sandi', { exact: true }).fill(password);
  await enroll.getByRole('button', { name: 'Lanjut', exact: true }).click();
  const secret = enroll.locator('code').first();
  await expect(secret).toBeVisible();
  totpSecret = (await secret.innerText()).replace(/\s/g, '');
  await enterCode(page, 'Kode 6 digit', totp(totpSecret));
  await enroll.getByRole('button', { name: 'Verifikasi', exact: true }).click();
  await enroll.getByLabel('Saya sudah menyimpan kode cadangan').check();
  await enroll.getByRole('button', { name: 'Selesai', exact: true }).click();
  await expect(enroll).toBeHidden();

  await page.goto('/?settings=ai');
  await expect(settings.getByRole('heading', { name: 'AI agent (BYOK)' })).toBeVisible();
  await settings.getByRole('button', { name: /OpenRouter/ }).click();
  await settings.getByLabel('API key').fill('sk-e2e-fake-0000');
  await settings.getByLabel('Atau ketik ID model').fill('e2e/test-model');
  await settings.getByRole('switch', { name: 'Baca data keuangan' }).check();
  await settings.getByRole('switch', { name: 'Buat draf transaksi' }).check();
  await settings.getByRole('radio', { name: 'Harga manual' }).check();
  await settings.getByLabel('Input per 1 jt token (USD)').fill('1');
  await settings.getByLabel('Output per 1 jt token (USD)').fill('2');
  await settings.getByLabel('Per permintaan (USD)').fill('0');
  await settings.getByLabel('Per gambar (USD)').fill('0');
  await settings.getByRole('button', { name: 'Simpan perubahan' }).click();
  await reauthIfAsked(page);
  await expect(page.getByText('Konfigurasi AI disimpan')).toBeVisible();
  await expect(settings.getByText('••••0000 · terenkripsi')).toBeVisible();
  await screenshot(page, 'assistant-ai-settings');

  // The deliberate connection test: a real billed request, answered by the fake provider.
  await settings.getByRole('button', { name: 'Tes', exact: true }).click();
  await expect(settings.getByRole('status').filter({ hasText: 'Terhubung — inferensi berhasil.' })).toBeVisible();
  await page.keyboard.press('Escape');
  await context.storageState({ path: user.state });
});

test('answers "berapa pengeluaran Oktober?" from the ledger with a data card and a source chip', async ({ page }) => {
  await page.goto('/');
  await ask(page, 'berapa pengeluaran Oktober?');

  const card = assistant(page).getByRole('region', { name: 'Pengeluaran per kategori' });
  await expect(card).toBeVisible();
  // The seed persona's October total (the dashboard KPI golden), as the tool read it from this user's ledger.
  await expect(card).toContainText('Chat');
  await expect(card).toContainText('16.500.000');
  await expect(assistant(page).getByText(/Pengeluaran 2026-10-01–2026-10-31 total Rp16\.500\.000/)).toBeVisible();
  await screenshot(page, 'assistant-answer');

  const chip = assistant(page).getByRole('link', { name: 'Lihat transaksi' });
  await chip.click();
  await expect(page).toHaveURL(/\/transactions/);
  await expect(page.getByRole('dialog', { name: 'Asisten' })).not.toBeVisible();
});

test('records the confirmed "45.000 GoPay" draft with source=assistant', async ({ page }) => {
  await page.goto('/');
  await ask(page, '45.000 GoPay');
  const draft = draftCard(page);
  await expect(draft).toBeVisible();
  await expect(draft.getByText('belum disimpan')).toBeVisible();
  await expect(draft.getByText('GoPay', { exact: true }).first()).toBeVisible();
  await expect(draft.getByText('Makan & Dapur', { exact: true })).toBeVisible();
  // The impact: the budget line of Makan & Dapur (3.200.000 spent + 45.000 of 3.500.000) and GoPay's balance.
  await expect(draft.getByText('Makan & Dapur jadi 93%')).toBeVisible();
  await expect(draft.getByText(/saldo GoPay Rp367\.000/)).toBeVisible();
  await expect(draft.getByText(/di bawah batas Rp500\.000/)).toBeVisible();
  await expect(draft.getByText(/Kam, 15 Okt · 12\.10/)).toBeVisible();
  await screenshot(page, 'assistant-draft');

  // "Ubah" hands the draft to the Record sheet, prefilled; nothing is recorded from there.
  await draft.getByRole('button', { name: 'Ubah' }).click();
  const sheet = page.getByRole('dialog', { name: 'Catat Transaksi' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('textbox', { name: 'Catatan', exact: true })).toHaveValue('GoPay');
  await expect(sheet.getByRole('textbox', { name: 'Jumlah' })).toHaveValue('45.000');
  await expect(sheet.getByRole('button', { name: 'Makan & Dapur' })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByRole('button', { name: 'Rekening' })).toContainText('GoPay');
  await sheet.getByRole('textbox', { name: 'Catatan', exact: true }).fill('GoPay via Asisten');
  await page.keyboard.press('Escape');
  await expect(sheet).not.toBeVisible();
  expect(await moneyRows('GoPay')).toEqual([]);

  // Back in the Assistant (the transcript survives while the page keeps the sheet mounted), the user confirms.
  await pressUntil(page, 'Control+j', () => assistant(page).isVisible());
  await expect(draftCard(page)).toBeVisible();
  await draftCard(page).getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(draftCard(page).getByText('Tersimpan · dikonfirmasi olehmu')).toBeVisible();
  await expect(page.getByText('Transaksi tersimpan').last()).toBeVisible();
  await screenshot(page, 'assistant-draft-saved');

  const [row] = await moneyRows('GoPay');
  expect(row?.postings).toBe('-45000');
  expect(row?.category).not.toBeNull();
  expect(row?.source).toBe('assistant');

  await draftCard(page).getByRole('button', { name: 'Buka di Transaksi' }).click();
  const detail = page.getByRole('complementary', { name: 'Detail transaksi' });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'GoPay' })).toBeVisible();
  await expect(detail.getByText('via Asisten')).toBeVisible();
  await screenshot(page, 'assistant-recorded');
});

test('a draft without a confirm records nothing', async ({ page }) => {
  await page.goto('/');
  await ask(page, '30.000 GoPay');
  await expect(draftCard(page)).toBeVisible();
  await expect(draftCard(page).getByText('belum disimpan')).toBeVisible();
  // Never confirmed: close the Assistant and check the ledger.
  await page.keyboard.press('Escape');
  await expect(assistant(page)).not.toBeVisible();

  await page.goto('/transactions?period=2026-10');
  const list = page.getByRole('region', { name: 'Daftar transaksi' });
  await expect(list.getByRole('group', { name: new RegExp('GoPay') })).toHaveCount(1);
  const rows = await moneyRows('GoPay');
  expect(rows).toHaveLength(1);
  expect(rows[0]?.postings).toBe('-45000');
  await screenshot(page, 'assistant-unconfirmed');
});
