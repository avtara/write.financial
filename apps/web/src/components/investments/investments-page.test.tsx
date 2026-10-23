// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page as browserPage, userEvent } from 'vitest/browser';
import { BBCA, investmentsOverview, portfolioView, SPY } from '../../../test/investment-fixtures.ts';
import { ACCOUNTS } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import type { MarketSyncResult } from '../../server/fn/market.ts';
import { InvestmentsPage } from './investments-page.tsx';

const calls = vi.hoisted(() => ({
  adjust: vi.fn(),
  create: vi.fn(),
  move: vi.fn(),
  record: vi.fn(),
  remove: vi.fn(),
  targets: vi.fn(),
  goals: vi.fn(),
  update: vi.fn(),
  trades: vi.fn(),
  sync: vi.fn(),
  log: vi.fn(),
}));
vi.mock('../../server/fn/investments.ts', () => ({
  adjustInvestmentHoldings: calls.adjust,
  createInvestmentAsset: calls.create,
  getAssetTrades: calls.trades,
  moveInvestmentAsset: calls.move,
  recordInvestmentTrade: calls.record,
  removeInvestmentAsset: calls.remove,
  setAllocationTargets: calls.targets,
  setAssetGoals: calls.goals,
  updateInvestmentAsset: calls.update,
}));
vi.mock('../../server/fn/market.ts', () => ({
  getMarketApiLog: calls.log,
  removeMarketKey: vi.fn(),
  saveMarketKey: vi.fn(),
  setMarketKeyActive: vi.fn(),
  syncMarketSource: calls.sync,
  testMarketKey: vi.fn(),
}));

const page = (overrides: Parameters<typeof investmentsOverview>[0] = {}) => ({
  overview: investmentsOverview(overrides),
  accounts: ACCOUNTS,
  timeZone: 'Asia/Jakarta',
});

beforeEach(() => {
  vi.clearAllMocks();
  calls.adjust.mockResolvedValue({ ok: true, value: { id: 'adj' } });
  calls.create.mockResolvedValue({ ok: true, value: SPY });
  calls.move.mockResolvedValue({ ok: true, value: SPY });
  calls.record.mockResolvedValue({ ok: true, value: { id: 'trade' } });
  calls.remove.mockResolvedValue({ ok: true, value: null });
  calls.targets.mockResolvedValue({ ok: true, value: null });
  calls.goals.mockResolvedValue({ ok: true, value: null });
  calls.update.mockResolvedValue({ ok: true, value: SPY });
  calls.trades.mockResolvedValue({ ok: true, value: [] });
  calls.log.mockResolvedValue({ ok: true, value: [] });
  calls.sync.mockImplementation((options: { data: { market: MarketSyncResult['market'] } }) =>
    Promise.resolve({
      ok: true,
      value: {
        market: options.data.market,
        status: 'synced',
        synced: 1,
        missing: 0,
        provider: null,
        pausedUntil: null,
      },
    }),
  );
});

describe('InvestmentsPage', () => {
  it('converts displayed portfolio values and refreshes each market source', async () => {
    const { screen, router } = await renderApp(<InvestmentsPage {...page()} />);
    const kpis = screen.getByRole('region', { name: 'Ringkasan investasi' });
    await expect.element(kpis).toMatchTextContent('Nilai portofolioRp61.420.000');
    await screen.getByRole('button', { name: 'USD', exact: true }).click();
    await expect.element(kpis).toMatchTextContent('Nilai portofolioUS$3.756,57');
    await screen.getByRole('button', { name: 'IDR', exact: true }).click();
    await expect.element(kpis).toMatchTextContent('Nilai portofolioRp61.420.000');
    const invalidate = vi.spyOn(router, 'invalidate').mockResolvedValue();
    await screen.getByRole('button', { name: 'Sinkronkan', exact: true }).click();
    await expect
      .element(screen.getByRole('region', { name: 'Sinkronisasi sumber harga' }))
      .toMatchTextContent('Saham/ETF AS');
    expect(calls.sync).toHaveBeenCalledTimes(4);
    expect(invalidate).toHaveBeenCalled();
  });

  it('reports a failed source without losing the last prices', async () => {
    calls.sync.mockImplementation((options: { data: { market: MarketSyncResult['market'] } }) =>
      Promise.resolve({
        ok: true,
        value: {
          market: options.data.market,
          status: 'failed',
          synced: 0,
          missing: 3,
          provider: null,
          pausedUntil: null,
        },
      }),
    );
    const { screen } = await renderApp(<InvestmentsPage {...page()} />);
    await screen.getByRole('button', { name: 'Sinkronkan', exact: true }).click();
    const sources = screen.getByRole('region', { name: 'Sinkronisasi sumber harga' });
    await expect.element(sources).toMatchTextContent('Gagal — memakai harga terakhir');
  });

  it('opens the record sheet from the header and records a buy', async () => {
    const { screen } = await renderApp(<InvestmentsPage {...page()} />);
    await screen.getByRole('button', { name: 'Catat Transaksi Investasi' }).click();
    const sheet = screen.getByRole('dialog', { name: 'Catat transaksi investasi' });
    await sheet.getByRole('textbox', { name: 'Jumlah (USD)' }).fill('50');
    await sheet.getByRole('button', { name: 'Simpan beli' }).click();
    expect(calls.record).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'buy',
          amountMinor: 5000n,
          occurredAt: expect.any(Date) as unknown,
        }) as unknown,
      }),
    );
  });

  it('reports a refused save and a dropped request on the sheet', async () => {
    calls.record
      .mockResolvedValueOnce({ ok: false, code: 'INVALID_TRADE' })
      .mockRejectedValueOnce(new TypeError('offline'));
    const { screen } = await renderApp(<InvestmentsPage {...page()} />);
    await screen.getByRole('button', { name: 'Catat Transaksi Investasi' }).click();
    const sheet = screen.getByRole('dialog', { name: 'Catat transaksi investasi' });
    await sheet.getByRole('textbox', { name: 'Jumlah (USD)' }).fill('50');
    await sheet.getByRole('button', { name: 'Simpan beli' }).click();
    await expect.element(sheet.getByRole('alert')).toBeVisible();
    await sheet.getByRole('button', { name: 'Simpan beli' }).click();
    await expect.element(sheet.getByRole('alert')).toMatchTextContent('Gagal menyimpan. Coba lagi.');
  });

  it('runs every asset menu action through the page', async () => {
    await browserPage.viewport(1440, 1000);
    const { screen } = await renderApp(<InvestmentsPage {...page()} />);
    const menu = async (item: string) => {
      await screen.getByRole('button', { name: 'Menu SPY', exact: true }).click();
      await screen.getByRole('menuitem', { name: item }).click();
    };
    const menuText = async (text: RegExp) => {
      await screen.getByRole('button', { name: 'Menu SPY', exact: true }).click();
      await screen.getByRole('menuitem').filter({ hasText: text }).click();
    };
    // Detail, then its buy action hands over to the trade sheet.
    await screen.getByRole('button', { name: 'SPY', exact: true }).click();
    const detail = screen.getByRole('dialog', { name: 'SPY · SPDR S&P 500 ETF' });
    await detail.getByRole('button', { name: 'Beli lagi' }).click();
    await expect.element(screen.getByRole('dialog', { name: 'Catat transaksi investasi' })).toBeVisible();
    await screen.getByRole('button', { name: 'Tutup' }).click();
    // Edit detail.
    await menu('Ubah detail aset…');
    const asset = screen.getByRole('dialog', { name: 'Ubah detail aset' });
    await asset.getByRole('button', { name: 'Simpan', exact: true }).click();
    expect(calls.update).toHaveBeenCalled();
    await expect.element(asset).not.toBeInTheDocument();
    // Move to a category.
    await menu('Pindah ke kategori…');
    const move = screen.getByRole('dialog', { name: 'Pindahkan SPY ke…' });
    await move.getByRole('button', { name: 'Pindahkan' }).click();
    expect(calls.move).toHaveBeenCalled();
    // Goals.
    await menu('Atur alokasi ke tujuan…');
    const goals = screen.getByRole('dialog', { name: 'Alokasi SPY ke tujuan' });
    await goals.getByRole('button', { name: 'Simpan alokasi' }).click();
    expect(calls.goals).toHaveBeenCalled();
    // Adjust, then "Lanjut ke Catat jual" of a sale.
    await menu('Sesuaikan kepemilikan…');
    const adjust = screen.getByRole('dialog', { name: 'Sesuaikan kepemilikan SPY' });
    await adjust.getByRole('textbox', { name: 'Di aplikasi Gotrade' }).fill('1,15');
    await adjust.getByRole('button', { name: 'Lanjut ke Catat jual' }).click();
    const sell = screen.getByRole('dialog', { name: 'Catat transaksi investasi' });
    await expect.element(sell.getByRole('tab', { name: 'Jual' })).toHaveAttribute('aria-selected', 'true');
    await screen.getByRole('button', { name: 'Tutup' }).click();
    await expect.element(sell).not.toBeInTheDocument();
    // Targets.
    await menuText(/^Ubah target alokasi/);
    const targets = screen.getByRole('dialog', { name: 'Target alokasi' });
    await targets.getByRole('button', { name: 'Simpan target' }).click();
    expect(calls.targets).toHaveBeenCalled();
    await expect.element(targets).not.toBeInTheDocument();
    // Remove.
    await menu('Hapus aset');
    const confirm = screen.getByRole('alertdialog', { name: 'Hapus SPY?' });
    await confirm.getByRole('button', { name: 'Hapus aset' }).click();
    expect(calls.remove).toHaveBeenCalledWith({ data: { id: SPY.id } });
  });

  it('records an adjustment and tops up cash from the holdings table', async () => {
    await browserPage.viewport(1440, 1000);
    const { screen } = await renderApp(<InvestmentsPage {...page()} />);
    await screen.getByRole('button', { name: 'Menu SPY', exact: true }).click();
    await screen.getByRole('menuitem', { name: 'Sesuaikan kepemilikan…' }).click();
    const adjust = screen.getByRole('dialog', { name: 'Sesuaikan kepemilikan SPY' });
    await adjust.getByRole('textbox', { name: 'Di aplikasi Gotrade' }).fill('1,215');
    await adjust.getByRole('button', { name: 'Simpan penyesuaian' }).click();
    expect(calls.adjust).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ units: '1.215', reason: 'unrecorded_buy' }) as unknown,
      }),
    );
    await expect.element(adjust).not.toBeInTheDocument();
    await screen
      .getByRole('button', { name: /^Top-up kas / })
      .first()
      .click();
    const topup = screen.getByRole('dialog', { name: 'Catat transaksi investasi' });
    await expect.element(topup.getByRole('tab', { name: 'Top-up kas' })).toHaveAttribute('aria-selected', 'true');
  });

  it('explains that a platform is required rather than offering an unusable asset form', async () => {
    const { screen } = await renderApp(
      <InvestmentsPage {...page({ portfolio: portfolioView({ assets: [], platforms: [] }) })} />,
    );
    await expect.element(screen.getByRole('button', { name: 'Tambah aset', exact: true })).toBeDisabled();
    await expect.element(screen.getByText('Belum ada portofolio')).toBeVisible();
  });

  it('creates an asset from the empty page and records a dividend', async () => {
    const platforms = portfolioView().platforms;
    const { screen } = await renderApp(
      <InvestmentsPage {...page({ portfolio: portfolioView({ assets: [], platforms }) })} />,
    );
    await screen.getByRole('button', { name: 'Tambah aset', exact: true }).click();
    const form = screen.getByRole('dialog', { name: 'Tambah aset' });
    await form.getByRole('textbox', { name: 'Ticker', exact: true }).fill('aapl');
    await form.getByRole('textbox', { name: 'Nama', exact: true }).fill('Apple');
    await form.getByRole('textbox', { name: /^Harga manual/ }).fill('210,5');
    await form.getByRole('button', { name: 'Simpan', exact: true }).click();
    expect(calls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ symbol: 'AAPL', accountId: platforms[0]?.accountId }) as unknown,
      }),
    );
    await screen.unmount();
    const normal = await renderApp(<InvestmentsPage {...page()} />);
    await normal.screen.getByRole('button', { name: 'Catat Transaksi Investasi' }).click();
    const sheet = normal.screen.getByRole('dialog', { name: 'Catat transaksi investasi' });
    await sheet.getByRole('tab', { name: 'Dividen' }).click();
    await sheet.getByRole('textbox', { name: 'Dividen kotor (USD)' }).fill('10');
    await sheet.getByRole('button', { name: 'Simpan dividen' }).click();
    expect(calls.record).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'dividend', fxRate: '16350' }) as unknown }),
    );
    await normal.screen.unmount();
    const domestic = await renderApp(<InvestmentsPage {...page()} />);
    await domestic.screen.getByRole('button', { name: 'Catat Transaksi Investasi' }).click();
    const cash = domestic.screen.getByRole('dialog', { name: 'Catat transaksi investasi' });
    await cash.getByRole('tab', { name: 'Top-up kas' }).click();
    await cash.getByRole('textbox', { name: /^Dikirim/ }).fill('100000');
    await cash.getByRole('textbox', { name: /^Diterima/ }).fill('6,12');
    await cash.getByRole('button', { name: 'Simpan top-up' }).click();
    expect(calls.record).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'cash_topup' }) as unknown }),
    );
  });

  it('opens settings from the price sync panel', async () => {
    const { screen, router } = await renderApp(<InvestmentsPage {...page()} />);
    await screen.getByRole('button', { name: 'Atur API harga' }).click();
    await expect.poll(() => router.state.location.search as unknown).toMatchObject({ settings: 'market' });
  });

  it('opens the target dialog from the allocation card and reports a failed save', async () => {
    calls.targets.mockResolvedValueOnce({ ok: false, code: 'INVALID_TARGETS' });
    const { screen } = await renderApp(<InvestmentsPage {...page()} />);
    await screen.getByRole('button', { name: 'Atur target', exact: true }).click();
    const targets = screen.getByRole('dialog', { name: 'Target alokasi' });
    await targets.getByRole('button', { name: 'Simpan target' }).click();
    await expect.element(targets).toBeVisible();
    expect(calls.targets).toHaveBeenCalled();
    await expect.element(targets.getByRole('alert')).toBeVisible();
  });

  it('works without a dollar rate and keeps syncing on a second click', async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<{ ok: true; value: MarketSyncResult }>((resolve) => {
      release = () => {
        resolve({
          ok: true,
          value: { market: 'us_equity', status: 'synced', synced: 1, missing: 0, provider: null, pausedUntil: null },
        });
      };
    });
    calls.sync.mockImplementation(() => pending);
    const { screen } = await renderApp(<InvestmentsPage {...page({ rates: {} })} />);
    expect(screen.getByRole('button', { name: 'USD', exact: true }).query()).toBeNull();
    await screen.getByRole('button', { name: 'Sinkronkan', exact: true }).click();
    expect(calls.sync).toHaveBeenCalledTimes(1);
    release?.();
    await expect.element(screen.getByRole('button', { name: 'Sinkronkan', exact: true })).toBeVisible();
    expect(calls.sync).toHaveBeenCalledTimes(4);
  });

  it('reports a refused sync source and retries missing prices', async () => {
    let first = true;
    calls.sync.mockImplementation((options: { data: { market: MarketSyncResult['market'] } }) => {
      if (first) {
        first = false;
        return Promise.resolve({ ok: false, code: 'NOT_FOUND' });
      }
      return Promise.resolve({
        ok: true,
        value: {
          market: options.data.market,
          status: 'synced',
          synced: 1,
          missing: 0,
          provider: null,
          pausedUntil: null,
        },
      });
    });
    const unpriced = { ...SPY, quote: null };
    const { screen } = await renderApp(
      <InvestmentsPage {...page({ portfolio: portfolioView({ assets: [unpriced] }) })} />,
    );
    const fallback = screen.getByRole('status', { name: 'Status harga pasar' });
    await expect.element(fallback).toBeVisible();
    await fallback.getByRole('button', { name: 'Coba lagi' }).click();
    await expect
      .element(screen.getByRole('region', { name: 'Sinkronisasi sumber harga' }))
      .toMatchTextContent('Gagal — memakai harga terakhir');
  });

  it('records a domestic buy, a domestic dividend with units, and a domestic correction', async () => {
    await browserPage.viewport(1440, 1000);
    const { screen } = await renderApp(<InvestmentsPage {...page()} />);
    await screen.getByRole('button', { name: 'Catat Transaksi Investasi' }).click();
    const sheet = screen.getByRole('dialog', { name: 'Catat transaksi investasi' });
    await sheet.getByRole('combobox', { name: 'Aset' }).click();
    await screen.getByRole('option', { name: /^BBCA · / }).click();
    await sheet.getByRole('textbox', { name: 'Jumlah (IDR)', exact: true }).fill('100000');
    await sheet.getByRole('button', { name: 'Simpan beli' }).click();
    expect(calls.record).toHaveBeenLastCalledWith({
      data: expect.not.objectContaining({ fxRate: expect.anything() as unknown }) as unknown,
    });
    await screen.unmount();
    const dividend = await renderApp(<InvestmentsPage {...page()} />);
    await dividend.screen.getByRole('button', { name: 'Catat Transaksi Investasi' }).click();
    const div = dividend.screen.getByRole('dialog', { name: 'Catat transaksi investasi' });
    await div.getByRole('tab', { name: 'Dividen' }).click();
    await div.getByRole('combobox', { name: 'Aset' }).click();
    await dividend.screen.getByRole('option', { name: /^BBCA · / }).click();
    await div.getByRole('textbox', { name: 'Dividen kotor (IDR)' }).fill('5000');
    await div.getByRole('radio', { name: 'Diinvestasikan ulang (DRIP)' }).click();
    await div.getByRole('textbox', { name: /Unit yang dibeli/ }).fill('0,5');
    await div.getByRole('button', { name: 'Simpan dividen' }).click();
    expect(calls.record).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ kind: 'dividend', units: '0.5', mode: 'reinvest' }) as unknown,
    });
    const lastData = (calls.record.mock.lastCall?.[0] as { data: Record<string, unknown> } | undefined)?.data;
    expect(lastData).not.toHaveProperty('fxRate');
    await dividend.screen.unmount();
    const adjust = await renderApp(<InvestmentsPage {...page()} />);
    await adjust.screen.getByRole('button', { name: 'Menu BBCA', exact: true }).click();
    await adjust.screen.getByRole('menuitem', { name: 'Sesuaikan kepemilikan…' }).click();
    const dialog = adjust.screen.getByRole('dialog', { name: 'Sesuaikan kepemilikan BBCA' });
    await dialog.getByRole('textbox', { name: 'Di aplikasi Stockbit' }).fill(String(Number(BBCA.holding.units) - 1));
    await dialog.getByRole('radio', { name: /Koreksi salah input/ }).click();
    await dialog.getByRole('button', { name: 'Simpan penyesuaian' }).click();
    expect(calls.adjust).toHaveBeenCalledWith({
      data: expect.not.objectContaining({
        amountMinor: expect.anything() as unknown,
        fxRate: expect.anything() as unknown,
      }) as unknown,
    });
  });

  it('creates an asset with an automatic price and opens targets from the rebalancer', async () => {
    const platforms = portfolioView().platforms;
    const { screen } = await renderApp(
      <InvestmentsPage {...page({ portfolio: portfolioView({ assets: [], platforms, targets: {} }) })} />,
    );
    await screen.getByRole('button', { name: 'Tambah aset', exact: true }).click();
    const form = screen.getByRole('dialog', { name: 'Tambah aset' });
    await form.getByRole('textbox', { name: 'Ticker', exact: true }).fill('aapl');
    await form.getByRole('textbox', { name: 'Nama', exact: true }).fill('Apple');
    await form.getByRole('combobox', { name: 'Sumber harga' }).click();
    await screen.getByRole('option', { name: 'Bawaan server' }).click();
    await form.getByRole('button', { name: 'Simpan', exact: true }).click();
    expect(calls.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ manualPrice: null, manualPriceAt: null }) as unknown,
    });
    await screen.unmount();
    const targets = await renderApp(<InvestmentsPage {...page({ portfolio: portfolioView({ targets: {} }) })} />);
    const card = targets.screen.getByRole('region', { name: 'Kalkulator rebalancing' });
    await card.getByRole('button', { name: 'Atur target' }).click();
    await expect.element(targets.screen.getByRole('dialog', { name: 'Target alokasi' })).toBeVisible();
  });

  it('reports a failed asset removal', async () => {
    calls.remove.mockRejectedValueOnce(new TypeError('offline'));
    await browserPage.viewport(1440, 1000);
    const { screen } = await renderApp(<InvestmentsPage {...page()} />);
    await screen.getByRole('button', { name: 'Menu SPY', exact: true }).click();
    await screen.getByRole('menuitem', { name: 'Hapus aset' }).click();
    const confirm = screen.getByRole('alertdialog', { name: 'Hapus SPY?' });
    await confirm.getByRole('button', { name: 'Hapus aset' }).click();
    expect(calls.remove).toHaveBeenCalled();
  });

  it('closes dialogs with Escape and records a sale and a whole-asset goal split', async () => {
    await browserPage.viewport(1440, 1000);
    const { screen } = await renderApp(<InvestmentsPage {...page()} />);
    const escape = async (open: () => Promise<void>, dialog: ReturnType<typeof screen.getByRole>) => {
      await open();
      await expect.element(dialog).toBeVisible();
      await userEvent.keyboard('{Escape}');
      await expect.element(dialog).not.toBeInTheDocument();
    };
    await escape(
      async () => {
        await screen.getByRole('button', { name: 'SPY', exact: true }).click();
      },
      screen.getByRole('dialog', { name: 'SPY · SPDR S&P 500 ETF' }),
    );
    const menu = async (item: string) => {
      await screen.getByRole('button', { name: 'Menu SPY', exact: true }).click();
      await screen.getByRole('menuitem', { name: item }).click();
    };
    const menuText = async (text: RegExp) => {
      await screen.getByRole('button', { name: 'Menu SPY', exact: true }).click();
      await screen.getByRole('menuitem').filter({ hasText: text }).click();
    };
    await escape(() => menu('Ubah detail aset…'), screen.getByRole('dialog', { name: 'Ubah detail aset' }));
    await escape(() => menu('Pindah ke kategori…'), screen.getByRole('dialog', { name: 'Pindahkan SPY ke…' }));
    await escape(
      async () => {
        await screen.getByRole('button', { name: 'Tambah aset', exact: true }).click();
      },
      screen.getByRole('dialog', { name: 'Tambah aset' }),
    );
    await escape(() => menu('Atur alokasi ke tujuan…'), screen.getByRole('dialog', { name: 'Alokasi SPY ke tujuan' }));
    await escape(
      () => menu('Sesuaikan kepemilikan…'),
      screen.getByRole('dialog', { name: 'Sesuaikan kepemilikan SPY' }),
    );
    // A sale goes through the page's recordTrade sell branch.
    await screen.getByRole('button', { name: 'Catat Transaksi Investasi' }).click();
    const sheet = screen.getByRole('dialog', { name: 'Catat transaksi investasi' });
    await sheet.getByRole('tab', { name: 'Jual' }).click();
    await sheet.getByRole('button', { name: 'Semua', exact: true }).click();
    await sheet.getByRole('button', { name: 'Simpan jual' }).click();
    expect(calls.record).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ kind: 'sell', proceedsAccountId: null }) as unknown,
    });
    // A whole-asset goal split maps without a percentage.
    await menuText(/^Ubah target alokasi/);
    await screen.getByRole('dialog', { name: 'Target alokasi' }).getByRole('button', { name: 'Batal' }).click();
    await menu('Atur alokasi ke tujuan…');
    const goals = screen.getByRole('dialog', { name: 'Alokasi SPY ke tujuan' });
    await goals.getByRole('combobox', { name: 'Alokasi ke DP Rumah' }).selectOptions('whole');
    await goals.getByRole('combobox', { name: 'Alokasi ke Dana Pensiun' }).selectOptions('none');
    await goals.getByRole('button', { name: 'Simpan alokasi' }).click();
    expect(calls.goals).toHaveBeenCalledWith({
      data: { assetId: SPY.id, sources: [{ goalId: 'goal-rumah', mode: 'whole' }] },
    });
  });

  it('keeps the last prices when a source request drops', async () => {
    calls.sync
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockImplementation((options: { data: { market: MarketSyncResult['market'] } }) =>
        Promise.resolve({
          ok: true,
          value: {
            market: options.data.market,
            status: 'synced',
            synced: 1,
            missing: 0,
            provider: null,
            pausedUntil: null,
          },
        }),
      );
    const { screen } = await renderApp(<InvestmentsPage {...page()} />);
    await screen.getByRole('button', { name: 'Sinkronkan', exact: true }).click();
    await expect.element(screen.getByRole('region', { name: 'Sinkronisasi sumber harga' })).toBeVisible();
  });
});
