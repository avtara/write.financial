// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { BBCA, manualQuote, portfolioView, SPY, tradeView } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { AssetDetail } from './asset-detail.tsx';
const fake = vi.hoisted(() => ({ trades: vi.fn() }));
vi.mock('../../server/fn/investments.ts', () => ({ getAssetTrades: fake.trades }));

describe('AssetDetail', () => {
  it('shows recorded buy history and both goal shares, not invented dividends', async () => {
    fake.trades.mockResolvedValue({ ok: true, value: [tradeView()] });
    const { screen } = await renderApp(
      <AssetDetail
        asset={SPY}
        portfolio={portfolioView()}
        timeZone="Asia/Jakarta"
        locale="id"
        onOpenChange={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    await expect.element(dialog).toMatchTextContent('DP Rumah');
    await expect.element(dialog).toMatchTextContent('Dana Pensiun');
    await expect.element(dialog).toMatchTextContent('60%');
    await expect.element(dialog).toMatchTextContent('40%');
    await expect.element(dialog).toMatchTextContent('Belum ada dividen tercatat.');
    await expect.element(dialog).toMatchTextContent('0,356');
  });

  it('runs the footer actions, marks a pending or unheld position, and edits goal shares', async () => {
    fake.trades.mockResolvedValue({ ok: true, value: [] });
    const onAction = vi.fn();
    const { screen } = await renderApp(
      <AssetDetail
        asset={{ ...SPY, pendingMinor: 400_000n, pendingBaseMinor: 400_000n }}
        portfolio={portfolioView({ targets: {} })}
        timeZone="Asia/Jakarta"
        locale="id"
        onOpenChange={vi.fn()}
        onAction={onAction}
      />,
    );
    const dialog = screen.getByRole('dialog');
    await expect.element(dialog).toMatchTextContent('Diproses:');
    await screen.getByRole('button', { name: 'Beli lagi' }).click();
    expect(onAction).toHaveBeenCalledWith('buy', expect.objectContaining({ symbol: 'SPY' }));
    await screen.getByRole('button', { name: 'Jual', exact: true }).click();
    expect(onAction).toHaveBeenCalledWith('sell', expect.objectContaining({ symbol: 'SPY' }));
    await screen.getByRole('button', { name: 'Sesuaikan kepemilikan…' }).click();
    expect(onAction).toHaveBeenCalledWith('adjust', expect.objectContaining({ symbol: 'SPY' }));
    await screen.getByRole('button', { name: 'Ubah', exact: true }).click();
    expect(onAction).toHaveBeenCalledWith('goals', expect.objectContaining({ symbol: 'SPY' }));
    await screen.unmount();
    const unheld = await renderApp(
      <AssetDetail
        asset={{ ...BBCA, holding: { ...BBCA.holding, units: '0' }, goals: [] }}
        portfolio={portfolioView()}
        timeZone="Asia/Jakarta"
        locale="id"
        onOpenChange={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    await expect.element(unheld.screen.getByRole('button', { name: 'Jual', exact: true })).toBeDisabled();
    await expect
      .element(unheld.screen.getByRole('dialog'))
      .toMatchTextContent('Aset ini belum dipakai tujuan tabungan.');
  });

  it('reports a trade history the server refuses or the network drops', async () => {
    fake.trades.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' }).mockRejectedValueOnce(new TypeError('offline'));
    const { screen } = await renderApp(
      <AssetDetail
        asset={SPY}
        portfolio={portfolioView()}
        timeZone="Asia/Jakarta"
        locale="id"
        onOpenChange={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    await expect.element(screen.getByRole('alert')).toBeVisible();
    await screen.unmount();
    const dropped = await renderApp(
      <AssetDetail
        asset={SPY}
        portfolio={portfolioView()}
        timeZone="Asia/Jakarta"
        locale="id"
        onOpenChange={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    await expect.element(dropped.screen.getByRole('alert')).toMatchTextContent('Riwayat transaksi gagal dimuat.');
  });

  it('labels pending, DCA, dividend, sold, and adjusted trades and shows a price drop per goal', async () => {
    fake.trades.mockResolvedValue({
      ok: true,
      value: [
        tradeView({ id: 't1', status: 'pending' }),
        tradeView({ id: 't2', localDate: '2026-09-01' as never }),
        tradeView({ id: 't3', kind: 'dividend', taxMinor: 1_000n, dividendMinor: 5_000n }),
        tradeView({ id: 't4', kind: 'sell', units: '0.047', realizedBaseMinor: 100_000n }),
        tradeView({ id: 't5', kind: 'adjust', price: null }),
      ],
    });
    const asset = {
      ...SPY,
      value: { ...(SPY.value as NonNullable<typeof SPY.value>), todayBaseMinor: -75_000n },
    };
    const { screen } = await renderApp(
      <AssetDetail
        asset={asset}
        portfolio={portfolioView()}
        timeZone="Asia/Jakarta"
        locale="id"
        onOpenChange={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    await expect.element(dialog).toMatchTextContent('diproses');
    await expect.element(dialog).toMatchTextContent('DCA');
    await expect.element(dialog).toMatchTextContent('Pajak');
    await expect.element(dialog).toMatchTextContent('Jual & koreksi');
    await expect.element(dialog).toMatchTextContent('SPY hari ini');
    await expect.element(dialog).toMatchTextContent('DP Rumah');
  });

  it('stays quiet when closed, and explains a position without a rate or price', async () => {
    fake.trades.mockResolvedValue({ ok: true, value: [] });
    const closed = await renderApp(
      <AssetDetail
        asset={null}
        portfolio={portfolioView()}
        timeZone="Asia/Jakarta"
        locale="id"
        onOpenChange={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    await expect.element(closed.screen.getByRole('dialog')).not.toBeInTheDocument();
    const bare = {
      ...SPY,
      value: null,
      quote: null,
      averagePrice: null,
      goals: [{ ...(SPY.goals[0] as NonNullable<(typeof SPY.goals)[0]>), mode: 'whole' as const }],
    };
    const empty = portfolioView({ targets: {} });
    const { screen } = await renderApp(
      <AssetDetail
        asset={bare}
        portfolio={{ ...empty, summary: { ...empty.summary, valueBaseMinor: 0n } }}
        timeZone="Asia/Jakarta"
        locale="id"
        onOpenChange={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    await expect.element(dialog).toMatchTextContent('Kurs USD belum tersedia');
    await expect.element(dialog).toMatchTextContent('dinilai harga modal');
    await expect.element(dialog).toMatchTextContent('Seluruh aset');
    await expect.element(dialog).toMatchTextContent('Bebas dialokasikan');
    await screen.unmount();
    const zero = await renderApp(
      <AssetDetail
        asset={SPY}
        portfolio={{ ...empty, summary: { ...empty.summary, valueBaseMinor: 0n } }}
        timeZone="Asia/Jakarta"
        locale="id"
        onOpenChange={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    await expect.element(zero.screen.getByRole('dialog')).toMatchTextContent('1,1965');
  });

  it('shows a quote provider with no day change and hides the gain percent', async () => {
    fake.trades.mockResolvedValue({ ok: true, value: [] });
    const asset = {
      ...SPY,
      quote: manualQuote('690.1', { provider: 'tiingo', source: 'server', label: 'delayed' }),
      value: { ...(SPY.value as NonNullable<typeof SPY.value>), todayBaseMinor: null, gainBps: null },
    };
    const { screen } = await renderApp(
      <AssetDetail
        asset={asset}
        portfolio={portfolioView()}
        timeZone="Asia/Jakarta"
        locale="id"
        onOpenChange={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    await expect.element(dialog).toMatchTextContent('Tiingo');
    await expect.element(dialog).toMatchTextContent('—');
  });

  it('ignores a trade history that arrives after the panel closed', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    let reject: (reason: unknown) => void = () => undefined;
    fake.trades
      .mockReturnValueOnce(new Promise((done) => (resolve = done)))
      .mockReturnValueOnce(new Promise((_, fail) => (reject = fail)));
    const first = await renderApp(
      <AssetDetail
        asset={SPY}
        portfolio={portfolioView()}
        timeZone="Asia/Jakarta"
        locale="id"
        onOpenChange={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    await first.screen.unmount();
    resolve({ ok: true, value: [] });
    const second = await renderApp(
      <AssetDetail
        asset={SPY}
        portfolio={portfolioView()}
        timeZone="Asia/Jakarta"
        locale="id"
        onOpenChange={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    await second.screen.unmount();
    reject(new TypeError('offline'));
    await Promise.resolve();
    expect(fake.trades).toHaveBeenCalledTimes(2);
  });
});
