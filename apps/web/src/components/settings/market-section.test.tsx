// SPDX-License-Identifier: AGPL-3.0-only
import type { MarketCredentialView } from '@wf/db/market-credentials';
import type { ByokProvider, CredentialStatus } from '@wf/domain/market';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import type { MarketSettings } from '../../server/fn/market.ts';
import { MarketSection } from './market-section.tsx';

const server = vi.hoisted(() => ({
  getMarketApiLog: vi.fn(),
  removeMarketKey: vi.fn(),
  saveMarketKey: vi.fn(),
  setMarketKeyActive: vi.fn(),
  syncMarketSource: vi.fn(),
  testMarketKey: vi.fn(),
}));
vi.mock('../../server/fn/market.ts', () => server);
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@wf/ui/toast', () => toasts);

const TZ = 'Asia/Jakarta';
const now = new Date();
const later = new Date(now.getTime() + 60 * 60_000);
const lastWeek = new Date(now.getTime() - 7 * 86_400_000);

const key = (
  provider: ByokProvider,
  status: CredentialStatus,
  overrides: Partial<MarketCredentialView> = {},
): MarketCredentialView => ({
  id: provider,
  provider,
  last4: `${provider.slice(0, 2)}99`,
  active: true,
  status,
  quotaUsed: 0,
  quotaLimit: null,
  quotaResetAt: null,
  retryAfter: null,
  lastTestedAt: null,
  updatedAt: now,
  ...overrides,
});

const SETTINGS: MarketSettings = {
  twoFactorEnabled: true,
  keys: [
    key('eodhd', 'connected', { quotaUsed: 4, quotaLimit: 20 }),
    key('tiingo', 'connected', { active: false }),
    key('alpha_vantage', 'unverified'),
    key('finnhub', 'rate_limited', { retryAfter: later }),
    key('coingecko', 'quota_exhausted', { quotaUsed: 12_000, quotaLimit: 10_000, retryAfter: later }),
    key('goldapi', 'invalid_key'),
    key('metals_dev', 'error'),
    key('marketstack', 'untested'),
  ],
  quoteCounts: { eodhd: 2 },
  serverSources: [
    {
      provider: 'coinmarketcap',
      status: 'connected',
      pausedUntil: null,
      quotaUsed: 120,
      quotaLimit: 15_000,
      quotaResetAt: null,
      updatedAt: now,
    },
    {
      provider: 'fawazahmed0',
      status: 'rate_limited',
      pausedUntil: later,
      quotaUsed: 0,
      quotaLimit: null,
      quotaResetAt: null,
      updatedAt: now,
    },
  ],
  cmcConfigured: true,
  symbolCounts: { idx_equity: 2, us_equity: 30 },
};

const render = (settings: MarketSettings = SETTINGS, locale: 'id' | 'en' = 'id') =>
  renderApp(<MarketSection settings={settings} timeZone={TZ} />, { preferences: { locale } });
const row = (provider: ByokProvider) =>
  page.elementLocator(document.querySelector(`[data-provider="${provider}"]`) as Element);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MarketSection', () => {
  it('shows every class with its mode and each key’s status, frequency, quota, and saved prices', async () => {
    await render();
    for (const label of [
      'Kurs mata uang',
      'Saham & ETF AS',
      'Saham IDX & IHSG',
      'Kripto',
      'Emas',
      'Reksa dana',
      'SBN (ORI)',
    ]) {
      await expect.element(page.getByRole('region', { name: label })).toBeVisible();
    }
    await expect.element(page.getByText('Aktif · harian 17.00 & 08.00 WIB')).toBeVisible();
    await expect
      .element(page.getByText(/^Key ••••eo99 · Terhubung · Tiap 60 menit · 2 harga tersimpan$/))
      .toBeVisible();
    await expect.element(page.getByRole('progressbar', { name: 'Pemakaian kuota EODHD' })).toBeVisible();
    await expect.element(page.getByText('Kuota 4/20')).toBeVisible();
    await expect.element(page.getByText(/Key ••••ti99 · Nonaktif · Tiap 15 menit/)).toBeVisible();
    await expect
      .element(page.getByText(/Terhubung \(key tidak dapat diverifikasi\) · Terlalu banyak simbol/))
      .toBeVisible();
    await expect.element(page.getByText(/Limit, coba lagi s\.d\. \d\d\.\d\d/).first()).toBeVisible();
    await expect.element(page.getByText(/Kuota habis s\.d\. \d\d\.\d\d/)).toBeVisible();
    await expect.element(page.getByText(/Key salah/)).toBeVisible();
    await expect.element(page.getByText(/Gagal terhubung/)).toBeVisible();
    await expect.element(page.getByText(/Belum diuji/)).toBeVisible();
    await expect.element(page.getByText(/^Aktif · \d\d\.\d\d · 120\/15000 kredit bulan ini$/)).toBeVisible();
    await expect.element(page.getByText('Antam = spot × (1 + premium), ditandai estimasi')).toBeVisible();
    await expect
      .element(page.getByText('Key pribadi, data hanya untukmu · Tertunda/penutupan, bukan real-time'))
      .toBeVisible();
  });

  it('shows built-in sources waiting, not set up, or failed, and keys still to set', async () => {
    await render({
      ...SETTINGS,
      keys: [],
      serverSources: [
        {
          provider: 'coinmarketcap',
          status: 'unconfigured',
          pausedUntil: null,
          quotaUsed: 0,
          quotaLimit: null,
          quotaResetAt: null,
          updatedAt: now,
        },
        {
          provider: 'fawazahmed0',
          status: 'error',
          pausedUntil: null,
          quotaUsed: 0,
          quotaLimit: null,
          quotaResetAt: null,
          updatedAt: now,
        },
      ],
      cmcConfigured: false,
    });
    await expect.element(page.getByText('Belum diatur di server')).toBeVisible();
    await expect.element(page.getByText('Gagal terhubung')).toBeVisible();
    await expect.element(page.getByText('Belum ada key').first()).toBeVisible();
    await expect
      .element(row('tiingo').getByRole('link', { name: 'Dapatkan key gratis' }))
      .toHaveAttribute('href', 'https://www.tiingo.com/account/api/token');
    await render({ ...SETTINGS, keys: [], serverSources: [] }, 'en');
    await expect.element(page.getByText('Waiting for the first sync').first()).toBeVisible();
    // English clock: "Active · 21:23".
    await render({ ...SETTINGS, keys: [] }, 'en');
    await expect.element(page.getByText(/^Active · \d\d:\d\d · 120\/15000 credits this month$/)).toBeVisible();
  });

  it('tests a key and lists each symbol’s price and time, or why the test failed', async () => {
    server.testMarketKey.mockResolvedValueOnce({
      ok: true,
      value: {
        provider: 'eodhd',
        status: 'connected',
        pausedUntil: null,
        results: [
          { symbol: 'BBCA', currency: 'IDR', provider: 'eodhd', price: '8750', asOf: now },
          { symbol: 'SPY', currency: 'USD', provider: 'eodhd', price: '690.105', asOf: lastWeek },
          { symbol: 'TLKM', currency: 'IDR', provider: null, price: null, asOf: null },
        ],
      },
    });
    await render();
    await row('eodhd').getByRole('button', { name: 'Tes koneksi EODHD' }).click();
    const results = page.getByRole('region', { name: 'Hasil tes EODHD' });
    await expect.poll(() => results.query()?.textContent).toMatch(/Terhubung/);
    await expect.poll(() => results.query()?.textContent).toMatch(/BBCARp8\.750\d\d\.\d\d/);
    await expect.poll(() => results.query()?.textContent).toMatch(/SPYUS\$690,11\d+ \w+ \d\d\.\d\d/);
    await expect.poll(() => results.query()?.textContent).toMatch(/TLKMtidak ditemukan/);
    expect(server.testMarketKey).toHaveBeenCalledWith({ data: { provider: 'eodhd' } });

    // A test that hits the quota (no reset known) or a 429 without Retry-After.
    for (const status of ['quota_exhausted', 'rate_limited'] as const) {
      server.testMarketKey.mockResolvedValueOnce({
        ok: true,
        value: { provider: 'eodhd', status, pausedUntil: null, results: [] },
      });
      await row('eodhd').getByRole('button', { name: 'Tes koneksi EODHD' }).click();
      await expect.poll(() => results.query()?.textContent).toMatch(/s\.d\. —/);
    }
    server.testMarketKey.mockResolvedValueOnce({ ok: false, code: 'MARKET_TEST_LIMIT' });
    await row('eodhd').getByRole('button', { name: 'Tes koneksi EODHD' }).click();
    await expect
      .element(row('eodhd').getByRole('alert'))
      .toHaveTextContent('Batas 5 tes per jam untuk penyedia ini tercapai.');
    server.testMarketKey.mockRejectedValueOnce(new Error('offline'));
    await row('eodhd').getByRole('button', { name: 'Tes koneksi EODHD' }).click();
    await expect.element(row('eodhd').getByRole('alert')).toHaveTextContent('Tidak berhasil, coba lagi');
  });

  it('saves a key in the dialog with its license notes, and explains a refusal', async () => {
    server.saveMarketKey.mockResolvedValueOnce({ ok: false, code: 'TWO_FACTOR_REQUIRED' });
    server.saveMarketKey.mockRejectedValueOnce(new Error('offline'));
    server.saveMarketKey.mockResolvedValueOnce({ ok: true, value: key('massive', 'untested') });
    await render();
    await row('massive').getByRole('button', { name: 'Atur key Massive' }).click();
    const dialog = page.getByRole('dialog', { name: 'Atur key Massive' });
    await expect.element(dialog.getByText('Key pribadi, data hanya untukmu')).toBeVisible();
    const save = dialog.getByRole('button', { name: 'Simpan key' });
    await expect.element(save).toBeDisabled();
    await dialog.getByLabelText('API key').fill('fake-massive-key');
    await save.click();
    await expect.element(dialog.getByText(/verifikasi dua langkah/i)).toBeVisible();
    await save.click();
    await expect.element(dialog.getByText('Tidak berhasil, coba lagi')).toBeVisible();
    await save.click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(server.saveMarketKey).toHaveBeenLastCalledWith({
      data: { provider: 'massive', apiKey: 'fake-massive-key' },
    });

    await row('coingecko').getByRole('button', { name: 'Ganti key CoinGecko' }).click();
    await expect.element(page.getByText('Powered by CoinGecko')).toBeVisible();
    await page.getByRole('button', { name: 'Batal' }).click();
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await row('coingecko').getByRole('button', { name: 'Ganti key CoinGecko' }).click();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks for 2FA first and leads to Keamanan', async () => {
    const { router } = await render({ ...SETTINGS, twoFactorEnabled: false });
    await row('massive').getByRole('button', { name: 'Atur key Massive' }).click();
    const dialog = page.getByRole('dialog', { name: 'Wajib verifikasi dua langkah' });
    await expect
      .poll(() => dialog.query()?.textContent)
      .toMatch(/Aktifkan verifikasi dua langkah di Keamanan sebelum menyimpan API key\./);
    await dialog.getByRole('button', { name: 'Buka Keamanan' }).click();
    await vi.waitFor(() => {
      expect(router.state.location.search).toMatchObject({ settings: 'security' });
    });
  });

  it('switches a key off and on, and deletes it with its prices', async () => {
    server.setMarketKeyActive.mockResolvedValueOnce({ ok: true, value: key('eodhd', 'connected') });
    server.setMarketKeyActive.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    server.setMarketKeyActive.mockRejectedValueOnce(new Error('offline'));
    await render();
    await row('eodhd').getByRole('button', { name: 'Nonaktifkan' }).click();
    expect(server.setMarketKeyActive).toHaveBeenCalledWith({ data: { provider: 'eodhd', active: false } });
    await row('tiingo').getByRole('button', { name: 'Aktifkan' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith({ tone: 'error', title: 'Tidak berhasil, coba lagi' });
    });
    toasts.toast.mockClear();
    await row('tiingo').getByRole('button', { name: 'Aktifkan' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({ tone: 'error', title: 'Tidak berhasil, coba lagi' });
    });

    server.removeMarketKey.mockResolvedValueOnce({ ok: true, value: { quotesDeleted: 2 } });
    await row('eodhd').getByRole('button', { name: 'Hapus key EODHD' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Hapus key EODHD?' });
    await expect.poll(() => confirm.query()?.textContent).toMatch(/2 harga dari EODHD ikut dihapus/);
    await confirm.getByRole('button', { name: 'Hapus key' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith({ tone: 'success', title: 'Key EODHD dihapus' });
    });
    expect(server.removeMarketKey).toHaveBeenCalledWith({ data: { provider: 'eodhd' } });

    server.removeMarketKey.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    await row('tiingo').getByRole('button', { name: 'Hapus key Tiingo' }).click();
    await expect.poll(() => page.getByRole('alertdialog').query()?.textContent).toMatch(/0 harga dari Tiingo/);
    await page.getByRole('alertdialog').getByRole('button', { name: 'Hapus key' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith({ tone: 'error', title: 'Tidak berhasil, coba lagi' });
    });
    server.removeMarketKey.mockRejectedValueOnce(new Error('offline'));
    toasts.toast.mockClear();
    await row('tiingo').getByRole('button', { name: 'Hapus key Tiingo' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Hapus key' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({ tone: 'error', title: 'Tidak berhasil, coba lagi' });
    });
    await row('tiingo').getByRole('button', { name: 'Hapus key Tiingo' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Batal' }).click();
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('syncs source by source and tells what each did', async () => {
    const result = (market: string, status: string, extra: object = {}) => ({
      ok: true,
      value: { market, status, synced: 0, missing: 0, provider: null, pausedUntil: null, ...extra },
    });
    const gate = Promise.withResolvers<unknown>();
    server.syncMarketSource
      .mockResolvedValueOnce(result('us_equity', 'synced', { synced: 2, provider: 'tiingo' }))
      .mockReturnValueOnce(gate.promise)
      .mockResolvedValueOnce(result('crypto', 'paused', { pausedUntil: later }))
      .mockRejectedValueOnce(new Error('offline'));
    await render();
    await page.getByRole('button', { name: 'Sinkronkan harga' }).click();
    await expect.element(page.getByRole('button', { name: 'Sinkron 2/4…' })).toBeDisabled();
    gate.resolve(result('idx_equity', 'partial', { synced: 1, missing: 1 }));
    const list = page.getByRole('list').filter({ hasText: 'Saham & ETF AS' }).first();
    await expect.poll(() => list.query()?.textContent).toMatch(/2 harga diperbarui · Tiingo/);
    await expect.poll(() => list.query()?.textContent).toMatch(/1 diperbarui, 1 memakai harga terakhir/);
    await expect.poll(() => list.query()?.textContent).toMatch(/Dijeda s\.d\. \d\d\.\d\d — memakai harga terakhir/);
    await expect.poll(() => list.query()?.textContent).toMatch(/EmasGagal — memakai harga terakhir/);
    await expect.element(page.getByRole('button', { name: 'Sinkronkan harga' })).toBeEnabled();

    server.syncMarketSource
      .mockResolvedValueOnce(result('us_equity', 'no_key'))
      .mockResolvedValueOnce(result('idx_equity', 'failed'))
      .mockResolvedValueOnce(result('crypto', 'cached'))
      .mockResolvedValueOnce({ ok: false, code: 'UNAUTHENTICATED' });
    await page.getByRole('button', { name: 'Sinkronkan harga' }).click();
    await expect.poll(() => list.query()?.textContent).toMatch(/Tanpa key — memakai harga manual atau terakhir/);
    await expect.poll(() => list.query()?.textContent).toMatch(/Harga bawaan server, tanpa permintaan/);
  });

  it('opens the API log with tests, built-in fetches, and failures, and goes back', async () => {
    server.getMarketApiLog.mockResolvedValueOnce({ ok: false, code: 'UNAUTHENTICATED' });
    await render();
    await page.getByRole('button', { name: 'Buka log API' }).click();
    await expect.element(page.getByRole('alert')).toHaveTextContent('Log tidak dapat dimuat');

    server.getMarketApiLog.mockResolvedValueOnce({
      ok: true,
      value: [
        {
          id: '1',
          provider: 'eodhd',
          endpoint: 'TEST GET /api/real-time/BBCA.JK · BBCA.JK',
          httpStatus: 200,
          ok: true,
          durationMs: 640,
          retry: 0,
          errorCode: null,
          at: now,
          own: true,
        },
        {
          id: '2',
          provider: 'coinmarketcap',
          endpoint: 'GET /v2/cryptocurrency/quotes/latest · BTC → idr',
          httpStatus: 429,
          ok: false,
          durationMs: 95,
          retry: 0,
          errorCode: 'cmc_1008',
          at: now,
          own: false,
        },
        {
          id: '3',
          provider: 'frankfurter',
          endpoint: 'GET /v2/rates',
          httpStatus: null,
          ok: false,
          durationMs: 10_000,
          retry: 0,
          errorCode: 'timeout',
          at: lastWeek,
          own: false,
        },
      ],
    });
    await page.getByRole('button', { name: 'Buka log API' }).click();
    const log = page.getByRole('region', { name: 'Log permintaan' });
    await expect.poll(() => log.query()?.textContent).toMatch(/Permintaan hari ini: 2 · gagal 1/);
    await expect
      .poll(() => log.getByRole('row').nth(1).query()?.textContent)
      .toMatch(/EODHDTes GET \/api\/real-time\/BBCA\.JK · BBCA\.JK200640 ms/);
    await expect
      .poll(() => log.getByRole('row').nth(2).query()?.textContent)
      .toMatch(/CoinMarketCap · bawaan.*429 · cmc_1008/);
    await expect
      .poll(() => log.getByRole('row').nth(3).query()?.textContent)
      .toMatch(/tanpa respons · timeout10000 ms/);
    await page.getByRole('button', { name: 'Kembali ke sumber' }).click();
    await expect.element(page.getByRole('region', { name: 'Kripto' })).toBeVisible();

    server.getMarketApiLog.mockRejectedValueOnce(new Error('offline'));
    await page.getByRole('button', { name: 'Buka log API' }).click();
    await expect.element(page.getByRole('alert')).toHaveTextContent('Log tidak dapat dimuat');
    server.getMarketApiLog.mockResolvedValueOnce({ ok: true, value: [] });
    await page.getByRole('button', { name: 'Buka log API' }).click();
    await expect.element(page.getByText('Belum ada permintaan.')).toBeVisible();
  });
});
