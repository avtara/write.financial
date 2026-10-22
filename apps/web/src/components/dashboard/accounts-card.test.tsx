// SPDX-License-Identifier: AGPL-3.0-only
import type { AccountsOverview } from '@wf/db/accounts';
import { beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { dashboard, weekDashboard } from '../../../test/dashboard-fixtures.ts';
import { account, ACCOUNTS, BCA, CARD, GOTRADE, JAGO, OVO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { AccountsCard } from './accounts-card.tsx';

const OVERVIEW: AccountsOverview = {
  baseCurrency: 'IDR',
  accounts: [...ACCOUNTS],
  availableMinor: 55_023_000n,
  missingRates: [],
};

// The investments card shows from 1280 px.
beforeEach(async () => {
  await page.viewport(1440, 900);
});

describe('AccountsCard', () => {
  it('shows the available balance, the cards, and each one’s flow in the span', async () => {
    const { screen } = await renderApp(<AccountsCard overview={OVERVIEW} dashboard={dashboard()} />);
    const region = screen.getByRole('region', { name: 'Rekening & dompet' });
    await expect.element(region.getByRole('button', { name: /Saldo tersedia/ })).toMatchTextContent('Rp55.023.000');
    // BCA +1.200.000, Jago +500.000, OVO −400.000.
    await expect.element(region.getByRole('button', { name: /lainnya/ })).toMatchTextContent('+1.300.000bulan ini');
    await expect.element(region.getByRole('button', { name: /BCA Visa/ })).toMatchTextContent('+0bulan ini');
    await expect
      .element(region.getByRole('link', { name: 'Semua transaksi' }))
      .toHaveAttribute('href', '/transactions?period=2026-10');
  });

  it('opens the transactions of a card, of "N lainnya", of the available accounts, and of the investments', async () => {
    const { screen, router } = await renderApp(<AccountsCard overview={OVERVIEW} dashboard={weekDashboard()} />);
    await userEvent.click(screen.getByRole('button', { name: /BCA Visa/ }));
    expect(router.state.location.search).toEqual({ range: '2026-10-12..2026-10-15', account: CARD.id });
    await userEvent.click(screen.getByRole('button', { name: /lainnya/ }));
    expect(router.state.location.search).toMatchObject({ account: [BCA.id, JAGO.id, OVO.id].join(',') });
    await userEvent.click(screen.getByRole('button', { name: /Saldo tersedia/ }));
    expect(router.state.location.search).toMatchObject({ account: expect.stringContaining(BCA.id) as string });
    await userEvent.click(screen.getByRole('button', { name: /Investasi/ }));
    expect(router.state.location.search).toMatchObject({ account: GOTRADE.id });
  });

  it('adds up only base-currency flows, hides directions in privacy mode, and marks foreign investments "≈"', async () => {
    const usd = account({ id: 'acc-usd', displayName: 'Wise USD', currency: 'USD', showAsCard: false, type: 'bank' });
    const overview = { ...OVERVIEW, accounts: [usd, ...OVERVIEW.accounts.filter((a) => a.type !== 'investment')] };
    const flows = dashboard({ accounts: [{ accountId: 'acc-usd', inflowMinor: 99_900n, outflowMinor: 0n }] });
    const { screen } = await renderApp(<AccountsCard overview={overview} dashboard={flows} />);
    expect(screen.getByRole('button', { name: /Investasi/ }).query()).toBeNull();
    await expect.element(screen.getByRole('button', { name: /lainnya/ })).toMatchTextContent('+0bulan ini');
    const foreign = account({ id: 'acc-us', displayName: 'Gotrade US', type: 'investment', currency: 'USD' });
    const { screen: second } = await renderApp(
      <AccountsCard overview={{ ...OVERVIEW, accounts: [...OVERVIEW.accounts, foreign] }} dashboard={dashboard()} />,
      { preferences: { balancesHidden: true } },
    );
    await expect.element(second.getByRole('button', { name: /Investasi/ })).toMatchTextContent('≈');
    expect(
      second
        .getByRole('button', { name: /lainnya/ })
        .last()
        .element()
        .querySelector('.text-green-fg'),
    ).toBeNull();
  });

  it('shows outflows with an up arrow and IDR investments without "≈"', async () => {
    const local = account({ id: 'acc-bibit', displayName: 'Bibit', type: 'investment', currency: 'IDR' });
    const overview = {
      ...OVERVIEW,
      accounts: [...OVERVIEW.accounts.filter((a) => a.type !== 'investment'), local],
    };
    const flows = dashboard({ accounts: [{ accountId: OVO.id, inflowMinor: 0n, outflowMinor: 400_000n }] });
    const { screen } = await renderApp(<AccountsCard overview={overview} dashboard={flows} />);
    const others = screen.getByRole('button', { name: /lainnya/ });
    await expect.element(others).toMatchTextContent('−400.000bulan ini');
    expect(others.element().querySelector('.text-red-fg')).not.toBeNull();
    await expect.element(screen.getByRole('button', { name: /Investasi/ })).not.toMatchTextContent('≈');
  });

  it('adds "≈ Rp…" under a card in another currency', async () => {
    const usd = account({
      id: 'acc-usd',
      displayName: 'Wise USD',
      currency: 'USD',
      showAsCard: true,
      type: 'bank',
      balanceMinor: 12_000n,
      balanceBaseMinor: 1_962_000n,
    });
    const overview = { ...OVERVIEW, accounts: [usd, ...OVERVIEW.accounts] };
    const { screen } = await renderApp(<AccountsCard overview={overview} dashboard={dashboard()} />);
    await expect.element(screen.getByRole('button', { name: /Wise USD/ })).toMatchTextContent('US$120,00≈ Rp1.962.000');
  });
});
