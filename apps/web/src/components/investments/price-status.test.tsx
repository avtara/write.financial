// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { BBCA, BTC, manualQuote, SCHD, SPY, TODAY } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { PriceFallback, PriceStatusPill, quoteTime } from './price-status.tsx';
import { quoteStatus } from './investments-model.ts';

const DAY = 86_400_000;
const previousDay = (date: string) => Date.parse(`${date}T00:00:00Z`) - DAY;

describe('price fallbacks', () => {
  it('retains timestamped stale quotes and distinguishes valuation at cost', async () => {
    const status = quoteStatus([
      { ...SPY, quote: null },
      { ...BTC, quote: manualQuote('1', { stale: true, source: 'last', label: 'last' }) },
    ]);
    const retry = vi.fn();
    const { screen } = await renderApp(
      <>
        <PriceStatusPill status={status} today={TODAY} timeZone="Asia/Jakarta" locale="id" />
        <PriceFallback
          status={status}
          today={TODAY}
          timeZone="Asia/Jakarta"
          locale="id"
          retrying={false}
          onRetry={retry}
        />
      </>,
    );
    await expect
      .element(screen.getByRole('status'))
      .toMatchTextContent('SPY belum punya harga, dinilai dengan harga modal.');
    await expect.element(screen.getByRole('status')).toMatchTextContent('BTC memakai harga terakhir');
    await screen.getByRole('button', { name: 'Coba lagi' }).click();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('writes another day with its date, and groups stale holdings by one source', async () => {
    const at = previousDay(TODAY);
    expect(quoteTime({ asOf: at }, TODAY, 'Asia/Jakarta', 'id')).toContain('Okt');
    const stale = (asset: typeof SPY) => ({
      ...asset,
      quote: manualQuote('1', { stale: true, source: 'server', label: 'delayed', provider: 'tiingo', asOf: at }),
    });
    const manual = { ...SPY, quote: manualQuote('2', { stale: true, source: 'last', label: 'last', asOf: at + 1 }) };
    const status = quoteStatus([stale(SPY), stale(BTC), stale(BBCA), stale(SCHD), manual]);
    const { screen } = await renderApp(
      <>
        <PriceStatusPill status={status} today={TODAY} timeZone="Asia/Jakarta" locale="id" />
        <PriceFallback status={status} today={TODAY} timeZone="Asia/Jakarta" locale="id" retrying onRetry={vi.fn()} />
      </>,
    );
    const notice = screen.getByRole('status');
    await expect.element(notice).toMatchTextContent('Harga pasar belum diperbarui');
    await expect.element(notice).toMatchTextContent('SPY, BTC, BBCA +1 memakai harga terakhir');
    await expect.element(notice).toMatchTextContent('Tiingo');
    await expect.element(notice).toMatchTextContent('· terakhir');
    await expect.element(screen.getByRole('button', { name: 'Coba lagi' })).toBeDisabled();
  });

  it('shows a green pill with the newest price and its provider when everything is current', async () => {
    const status = quoteStatus([
      { ...SPY, quote: manualQuote('690.1', { provider: 'tiingo', source: 'server', label: 'delayed' }) },
    ]);
    const { screen } = await renderApp(
      <>
        <PriceStatusPill status={status} today={TODAY} timeZone="Asia/Jakarta" locale="id" />
        <PriceFallback
          status={status}
          today={TODAY}
          timeZone="Asia/Jakarta"
          locale="id"
          retrying={false}
          onRetry={vi.fn()}
        />
      </>,
    );
    await expect.element(screen.getByText(/harga .* · tertunda · Tiingo/)).toBeVisible();
    await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
  });

  it('says so when nothing is priced yet', async () => {
    const status = quoteStatus([{ ...SPY, quote: null }]);
    const { screen } = await renderApp(
      <>
        <PriceStatusPill status={status} today={TODAY} timeZone="Asia/Jakarta" locale="id" />
        <PriceFallback
          status={status}
          today={TODAY}
          timeZone="Asia/Jakarta"
          locale="id"
          retrying={false}
          onRetry={vi.fn()}
        />
      </>,
    );
    await expect.element(screen.getByText('harga belum tersedia')).toBeVisible();
    await expect.element(screen.getByRole('status')).toBeVisible();
  });
});
