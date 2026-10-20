// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { NETFLIX, subscription, subscriptionsOverview } from '../../../test/dashboard-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { SubscriptionsCard } from './subscriptions-card.tsx';

describe('SubscriptionsCard', () => {
  it('sums the active subscriptions and lists the next bills', async () => {
    const { screen } = await renderApp(<SubscriptionsCard overview={subscriptionsOverview()} locale="id" />);
    const region = screen.getByRole('region', { name: 'Langganan' });
    await expect.element(region.getByText('4 aktif · 1 tagihan dalam 7 hari')).toBeVisible();
    await expect.element(region).toMatchTextContent(/Per bulanRp516\.900/);
    await expect.element(region).toMatchTextContent(/Per tahun≈Rp6\.200\.000/);
    const rows = region.getByRole('list', { name: 'Langganan aktif' }).getByRole('listitem').elements();
    expect(rows.map((row) => row.textContent)).toEqual([
      'IiCloud+200 GB · 9 OktRp45.000Perlu dikonfirmasi',
      'NNetflixPremium 4K · 18 OktRp186.0003 hari lagi',
      'SSpotifyFamily · 25 OktRp86.90010 hari lagi',
      'FFit Hub3 NovRp199.000Lunas',
    ]);
    await expect.element(region).toMatchTextContent('Hemat Rp1.042.800/tahun Spotify jarang kamu pakai.');
  });

  it('says "Hari ini" on the due date and leaves out the tip of an inactive subscription', async () => {
    const today = subscription({ id: 'sub-today', name: 'Today', nextBillingDate: '2026-10-15' as LocalDate });
    const usd = subscription({ id: 'sub-usd', name: 'GitHub', currency: 'USD', priceMinor: 400n });
    const overview = subscriptionsOverview({
      subscriptions: [today, usd],
      monthSchedule: [],
      couldSave: [{ subscriptionId: 'sub-gone', yearlyMinor: 1n }],
    });
    const { screen } = await renderApp(<SubscriptionsCard overview={overview} locale="id" />);
    await expect.element(screen.getByText('Hari ini')).toBeVisible();
    expect(screen.getByText(/Hemat/).query()).toBeNull();
  });

  it('has no tip without rarely used subscriptions', async () => {
    const { screen } = await renderApp(
      <SubscriptionsCard overview={subscriptionsOverview({ couldSave: [] })} locale="id" />,
    );
    await expect.element(screen.getByText('4 aktif · 1 tagihan dalam 7 hari')).toBeVisible();
    expect(screen.getByText(/Hemat/).query()).toBeNull();
  });

  it('says so without active subscriptions', async () => {
    const overview = subscriptionsOverview({ subscriptions: [{ ...NETFLIX, effectiveStatus: 'cancelled' }] });
    const { screen } = await renderApp(<SubscriptionsCard overview={overview} locale="id" />);
    await expect.element(screen.getByText('Belum ada langganan aktif.')).toBeVisible();
    await expect.element(screen.getByText('0 aktif · 0 tagihan dalam 7 hari')).toBeVisible();
  });
});
