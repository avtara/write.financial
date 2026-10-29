// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { seedOverview } from '../../../test/subscription-fixtures.ts';
import { SubscriptionKpis } from './subscription-kpis.tsx';

describe('SubscriptionKpis', () => {
  it('golden: Rp904.900 / ≈ Rp11.520.000 / Rp660.900 with their shares and the six-month chart', async () => {
    const { screen } = await renderApp(
      <SubscriptionKpis overview={seedOverview()} spentMinor={16_500_000n} incomeMinor={26_000_000n} locale="id" />,
    );
    const kpis = screen.getByRole('region', { name: 'Ringkasan biaya langganan' });
    await expect.element(kpis).toMatchTextContent(/Per bulanRp904\.9005,48% dari pengeluaran/);
    await expect.element(kpis).toMatchTextContent(/Per tahunRp11\.520\.000≈ 44,31% pemasukan sebulan/);
    await expect.element(kpis).toMatchTextContent(/Sisa tagihan OktRp660\.9004 tagihan · 18–28 Okt/);
    await expect.element(kpis).toMatchTextContent(/Biaya langganan · 6 bulan\+24,13% sejak Mei/);
    const bars = kpis.getByRole('listitem');
    expect(bars.elements()).toHaveLength(6);
    await expect.element(bars.nth(1)).toHaveTextContent('+ SpotifyJun815.900');
    await expect.element(bars.nth(4)).toHaveTextContent('+ YouTube Premium, ChatGPT naikSep904.900');
    // The note is cut to the bar's width; its full text stays in the tooltip.
    await expect.element(bars.nth(4).getByTitle('+ YouTube Premium, ChatGPT naik')).toBeInTheDocument();
    await expect.element(bars.nth(5).getByTitle(/./)).not.toBeInTheDocument();
    expect(bars.nth(5).element().querySelector('rect')?.getAttribute('class')).toBe('fill-fg');
    expect(bars.nth(0).element().querySelector('rect')?.getAttribute('height')).toBe(String((729_000 / 904_900) * 40));
  });

  it('leaves out unknown shares, an empty chart, and a month without bills left', async () => {
    const { screen } = await renderApp(
      <SubscriptionKpis
        overview={seedOverview({
          remainingThisMonth: { totalMinor: 0n, count: 0, firstDue: null, lastDue: null },
          history: [{ month: '2026-10' as never, monthlyMinor: 0n, added: ['gone'], increased: ['gone'] }],
        })}
        spentMinor={null}
        incomeMinor={null}
        locale="en"
      />,
      { preferences: { locale: 'en' } },
    );
    const kpis = screen.getByRole('region', { name: 'Subscription cost summary' });
    await expect.element(kpis).not.toMatchTextContent(/of spending/);
    await expect.element(kpis).not.toMatchTextContent(/income/);
    await expect.element(kpis).toMatchTextContent(/Bills left in OctRp0No bills left/);
    await expect.element(kpis).not.toMatchTextContent(/since/);
    expect(kpis.element().querySelector('rect')?.getAttribute('height')).toBe('0');
    await expect.element(kpis.getByRole('listitem')).toHaveTextContent('+ , upOct0');
  });
});
