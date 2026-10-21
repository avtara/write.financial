// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Langganan (FR-SUB1–SUB6) as the invited user with the design persona on 15 Okt 2026: the goldens (Rp904.900 per
 * month, ≈ Rp11.520.000 per year, Rp660.900 left in October, Netflix on the 18th as a scheduled bill), the overdue
 * iCloud+ bill confirmed through the Review queue, detected candidates added from "Deteksi dari transaksi", a new
 * subscription, pausing Netflix, ⌘K, the keyboard, and the layout at 1440, 1024, and 768 px. Runs after the specs
 * that assert the seed's figures: it changes them.
 */
import type { Page } from '@playwright/test';
import postgres from 'postgres';
import { e2eEnv } from './env.ts';
import { expect, loadAccount, screenshot, seedDesignPersona, test, USER_STATE } from './support.ts';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: USER_STATE, viewport: { width: 1440, height: 900 } });

test.beforeAll(async () => {
  const { email } = loadAccount('user');
  await seedDesignPersona(email);
  // What the worker's daily `detect-recurring` job would have found (FR-SUB4): Vidio and Google One, 3× each.
  const sql = postgres(e2eEnv()['DATABASE_URL_SUPERUSER'] ?? '', { max: 1, onnotice: () => undefined });
  try {
    await sql`
      INSERT INTO detected_recurring
        (user_id, merchant_key, merchant, day_of_month, amount_minor, currency, occurrences, last_seen_on, account_id)
      SELECT users.id, candidate.key, candidate.merchant, candidate.day, candidate.amount, 'IDR', 3, candidate.seen::date,
        (SELECT id FROM accounts WHERE user_id = users.id ORDER BY sort_order LIMIT 1)
      FROM users,
        (VALUES ('vidio', 'Vidio', 12, 39000, '2026-10-12'), ('google one', 'Google One', 5, 26900, '2026-10-05'))
          AS candidate(key, merchant, day, amount, seen)
      WHERE users.email = ${email}
      ON CONFLICT DO NOTHING`;
  } finally {
    await sql.end();
  }
});

/** `/subscriptions`, hydrated. */
async function openSubscriptions(page: Page): Promise<void> {
  await page.goto('/subscriptions');
  await expect(page.getByRole('heading', { level: 1, name: 'Langganan' })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('the persona’s subscriptions: Rp904.900 per month, Netflix on the 18th scheduled, the nav badge', async ({
  page,
}) => {
  await openSubscriptions(page);
  await expect(page.getByText('7 aktif · 4 tagihan tersisa bulan ini · berikutnya Netflix, 3 hari lagi')).toBeVisible();
  await expect(page.getByRole('link', { name: /^Langganan/ })).toHaveText(/Langganan7/);
  const kpis = page.getByRole('region', { name: 'Ringkasan biaya langganan' });
  await expect(kpis).toContainText('Per bulanRp904.900');
  await expect(kpis).toContainText('Per tahunRp11.520.000');
  await expect(kpis).toContainText('Sisa tagihan OktRp660.9004 tagihan · 18–28 Okt');

  const schedule = page.getByRole('region', { name: 'Jadwal tagihan Oktober' });
  const netflix = schedule.getByRole('button', { name: 'Netflix, 18 Okt, Akan ditagih' });
  await expect(netflix).toBeVisible();
  await netflix.hover();
  await expect(page.getByRole('tooltip')).toContainText('Minggu, 18 Okt · 3 hari lagi');
  await expect(page.getByRole('tooltip')).toContainText('PengingatH-1 · 17 Okt');
  await expect(schedule).toContainText('iCloud+ Rp45.000 seharusnya ditagih 9 Okt');

  const table = page.getByRole('region', { name: 'Semua langganan' });
  await expect(table.getByRole('row')).toHaveCount(8);
  await expect(table).toContainText('Total 7 langganan aktif · Rp904.900/bulan + Rp660.900/tahun');
  await expect(page.getByRole('region', { name: 'Review bulanan' })).toContainText(
    'Seberapa sering kamu pakai YouTube Premium?',
  );
  await expectNoSidewaysScroll(page);
  await screenshot(page, 'subscriptions-1440');
});

test('the layout holds at 1024 and 768 px', async ({ page }) => {
  for (const width of [1024, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await openSubscriptions(page);
    await expect(page.getByRole('region', { name: 'Ringkasan biaya langganan' })).toContainText('Rp904.900');
    await expectNoSidewaysScroll(page);
    await screenshot(page, `subscriptions-${String(width)}`);
  }
});

test('"Ya, catat" records the overdue iCloud+ bill through the Review queue', async ({ page }) => {
  await openSubscriptions(page);
  const schedule = page.getByRole('region', { name: 'Jadwal tagihan Oktober' });
  await schedule.getByRole('button', { name: 'Ya, catat' }).click();
  await expect(page.getByText('iCloud+ ditandai sudah dibayar')).toBeVisible();
  await expect(schedule.getByRole('button', { name: 'Ya, catat' })).toBeHidden();
  await expect(schedule.getByRole('button', { name: 'iCloud+, 9 Okt, Sudah dibayar' })).toBeVisible();
});

test('detected candidates: add Vidio, dismiss Google One', async ({ page }) => {
  await openSubscriptions(page);
  await page.getByRole('button', { name: 'Deteksi dari transaksi 2 baru' }).click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('heading', { name: '2 tagihan berulang terdeteksi' })).toBeVisible();
  await expect(panel).toContainText('Jika ditambahkan: Rp970.800/bulan (+Rp65.900)');
  await screenshot(page, 'subscriptions-detected');
  await panel.getByRole('listitem').filter({ hasText: 'Vidio' }).getByRole('button', { name: 'Tambahkan' }).click();
  await expect(page.getByText('1 langganan ditambahkan')).toBeVisible();
  await panel.getByRole('button', { name: 'Bukan langganan' }).click();
  await expect(page.getByText('Ditandai bukan langganan')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('region', { name: 'Semua langganan' }).getByRole('button', { name: 'Vidio', exact: true }),
  ).toBeVisible();
});

test('adds a subscription with the keyboard only, then pauses Netflix for a month', async ({ page }) => {
  await openSubscriptions(page);
  await page.getByRole('button', { name: 'Tambah langganan' }).focus();
  await page.keyboard.press('Enter');
  const form = page.getByRole('dialog', { name: 'Langganan baru' });
  await expect(form.getByRole('textbox', { name: 'Layanan' })).toBeFocused();
  await page.keyboard.type('Disney+ Hotstar');
  await form.getByRole('textbox', { name: 'Harga' }).focus();
  await page.keyboard.type('39000');
  await form.getByRole('button', { name: 'Simpan langganan' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Disney+ Hotstar ditambahkan')).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Semua langganan' }).getByRole('button', { name: 'Disney+ Hotstar', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Aksi untuk Netflix' }).click();
  await page.getByRole('menuitem', { name: 'Jeda' }).click();
  const pause = page.getByRole('dialog', { name: 'Jeda Netflix' });
  await expect(pause).toContainText('aktif lagi Rabu, 18 Nov');
  await screenshot(page, 'subscriptions-pause');
  await pause.getByRole('button', { name: 'Jeda 1 bulan' }).click();
  await expect(page.getByText('Netflix dijeda')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Dijeda 2' })).toBeVisible();
});

test('⌘K finds a subscription and opens its detail', async ({ page }) => {
  await openSubscriptions(page);
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Cari atau jalankan perintah' });
  await palette.getByRole('combobox').fill('chatgpt');
  await palette.getByRole('option', { name: /^ChatGPT/ }).click();
  const detail = page.getByRole('dialog', { name: 'ChatGPT' });
  await expect(detail).toContainText('Rp329.000');
  await expect(detail).toContainText('Bank Jago');
});
