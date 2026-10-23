// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { investmentsOverview } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { Route } from './investments.tsx';

const fake = vi.hoisted(() => ({ getInvestments: vi.fn(), listAccounts: vi.fn() }));
vi.mock('../../server/fn/investments.ts', () => ({
  adjustInvestmentHoldings: vi.fn(),
  createInvestmentAsset: vi.fn(),
  getAssetTrades: vi.fn(),
  getInvestments: fake.getInvestments,
  moveInvestmentAsset: vi.fn(),
  recordInvestmentTrade: vi.fn(),
  removeInvestmentAsset: vi.fn(),
  setAllocationTargets: vi.fn(),
  setAssetGoals: vi.fn(),
  updateInvestmentAsset: vi.fn(),
}));
vi.mock('../../server/fn/ledger.ts', () => ({ listAccounts: fake.listAccounts }));
vi.mock('../../server/fn/market.ts', () => ({
  getMarketApiLog: vi.fn(),
  removeMarketKey: vi.fn(),
  saveMarketKey: vi.fn(),
  setMarketKeyActive: vi.fn(),
  syncMarketSource: vi.fn(),
  testMarketKey: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

const ACCOUNTS = { ok: true, value: { baseCurrency: 'IDR', accounts: [] } };

describe('/investments', () => {
  it.each(['portfolio', 'accounts'])('explains a failed %s load and lets the user retry', async (failure) => {
    vi.spyOn(Route, 'useLoaderData').mockReturnValue({
      overview: failure === 'portfolio' ? { ok: false, code: 'NOT_FOUND' } : { ok: true, value: null },
      accounts: failure === 'accounts' ? { ok: false, code: 'NOT_FOUND' } : { ok: true, value: null },
    });
    vi.spyOn(Route, 'useRouteContext').mockReturnValue({ viewer: { timezone: 'Asia/Jakarta' } });
    const Component = Route.options.component as ComponentType;
    const { screen, router } = await renderApp(<Component />);
    await expect.element(screen.getByText('Portofolio gagal dimuat')).toBeVisible();
    const reload = vi.spyOn(router, 'invalidate').mockResolvedValue();
    await screen.getByRole('button', { name: 'Coba lagi' }).click();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('loads the portfolio and every account in parallel', async () => {
    const overview = { ok: true, value: investmentsOverview() };
    fake.getInvestments.mockResolvedValue(overview);
    fake.listAccounts.mockResolvedValue(ACCOUNTS);
    const loader = Route.options.loader as unknown as () => Promise<unknown>;
    expect(await loader()).toEqual({ overview, accounts: ACCOUNTS });
    expect(fake.getInvestments).toHaveBeenCalledWith({ data: {} });
    expect(fake.listAccounts).toHaveBeenCalledWith({ data: { status: 'all' } });
    expect((Route.options.loaderDeps as unknown as () => unknown)()).toEqual({});
  });

  it('titles the page and renders the pending state', async () => {
    const head = Route.options.head as unknown as () => { meta: { title: string }[] };
    expect(head().meta[0]?.title).toBe('Investasi · write.financial');
    const Pending = Route.options.pendingComponent as ComponentType;
    const { screen } = await renderApp(<Pending />);
    await expect.element(screen.getByText('Memuat portofolio…')).toBeVisible();
  });

  it('renders the page once both loads agree', async () => {
    vi.spyOn(Route, 'useLoaderData').mockReturnValue({
      overview: { ok: true, value: investmentsOverview() },
      accounts: ACCOUNTS,
    });
    vi.spyOn(Route, 'useRouteContext').mockReturnValue({ viewer: { timezone: 'Asia/Jakarta' } });
    const Component = Route.options.component as ComponentType;
    const { screen } = await renderApp(<Component />);
    await expect.element(screen.getByRole('heading', { level: 1, name: 'Investasi' })).toBeVisible();
  });
});
