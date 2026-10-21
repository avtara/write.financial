// SPDX-License-Identifier: AGPL-3.0-only
import { setLocale } from '@wf/i18n/runtime';
import type { ComponentType } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { Route } from './subscriptions.tsx';

const fake = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  getBudgetStatus: vi.fn(),
  listSubscriptions: vi.fn(),
  listDetectedSubscriptions: vi.fn(),
  page: vi.fn(),
}));
vi.mock('../../server/fn/ledger.ts', () => ({ listAccounts: fake.listAccounts, listCategories: fake.listCategories }));
vi.mock('../../server/fn/budget.ts', () => ({ getBudgetStatus: fake.getBudgetStatus }));
vi.mock('../../server/fn/schedules.ts', () => ({
  listSubscriptions: fake.listSubscriptions,
  listDetectedSubscriptions: fake.listDetectedSubscriptions,
}));
vi.mock('../../components/subscriptions/subscriptions-page.tsx', () => ({
  SubscriptionsPage: (props: { onConsumeSearch: () => void }) => {
    fake.page(props);
    return (
      <button type="button" onClick={props.onConsumeSearch}>
        subscriptions page
      </button>
    );
  },
}));

const ID = '0192a6c4-0000-7000-8000-0000000000b1';
const ok = <T,>(value: T) => ({ ok: true, value });
const ACCOUNTS = ok({ baseCurrency: 'IDR', accounts: ['bca'], availableMinor: 0n, missingRates: [] });
const BUDGET = ok({
  totals: { spentMinor: 15_000_000n, unbudgetedSpentMinor: 1_500_000n },
  version: { expectedIncomeMinor: 26_000_000n },
});

function stubRoute(data: object, search: object = {}) {
  const navigate = vi.fn();
  vi.spyOn(Route, 'useLoaderData').mockReturnValue({
    overview: ok('overview'),
    detected: ok('detected'),
    accounts: ACCOUNTS,
    categories: ok(['cat']),
    budget: BUDGET,
    ...data,
  });
  vi.spyOn(Route, 'useRouteContext').mockReturnValue({ viewer: { timezone: 'Asia/Jakarta' } });
  vi.spyOn(Route, 'useSearch').mockReturnValue(search);
  vi.spyOn(Route, 'useNavigate').mockReturnValue(navigate as never);
  return navigate;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

beforeAll(async () => {
  await setLocale('id', { reload: false });
});

describe('/subscriptions', () => {
  it('loads subscriptions, candidates, accounts, categories, and the budget (whose failure is no error)', async () => {
    fake.listSubscriptions.mockResolvedValue(ok('overview'));
    fake.listDetectedSubscriptions.mockResolvedValue(ok('detected'));
    fake.listAccounts.mockResolvedValue(ACCOUNTS);
    fake.listCategories.mockResolvedValue(ok([]));
    fake.getBudgetStatus.mockResolvedValue(BUDGET);
    const loader = Route.options.loader as unknown as () => Promise<unknown>;
    expect(await loader()).toEqual({
      overview: ok('overview'),
      detected: ok('detected'),
      accounts: ACCOUNTS,
      categories: ok([]),
      budget: BUDGET,
    });
    expect(fake.listSubscriptions).toHaveBeenCalledWith({ data: {} });
    expect(fake.listAccounts).toHaveBeenCalledWith({ data: { status: 'all' } });
    fake.getBudgetStatus.mockRejectedValue(new TypeError('offline'));
    expect(await loader()).toMatchObject({ budget: null });
  });

  it('titles the page and keeps only valid search params', () => {
    const head = Route.options.head as unknown as () => { meta: { title: string }[] };
    expect(head().meta[0]?.title).toBe('Langganan · write.financial');
    const validate = Route.options.validateSearch as unknown as { parse: (value: unknown) => unknown };
    expect(validate.parse({ subscription: ID, new: true })).toEqual({ subscription: ID, new: true });
    expect(validate.parse({ subscription: 'x', new: 'yes' })).toEqual({});
  });

  it('renders the page with the KPI shares and search params, and drops them afterwards', async () => {
    const navigate = stubRoute({}, { subscription: ID, new: true });
    const Component = Route.options.component as ComponentType;
    const { screen } = await renderApp(<Component />);
    await screen.getByRole('button', { name: 'subscriptions page' }).click();
    expect(fake.page).toHaveBeenCalledWith(
      expect.objectContaining({
        overview: 'overview',
        detected: 'detected',
        accounts: ['bca'],
        categories: ['cat'],
        spentMinor: 16_500_000n,
        incomeMinor: 26_000_000n,
        timeZone: 'Asia/Jakarta',
        initialSubscriptionId: ID,
        initialNew: true,
      }),
    );
    expect(navigate).toHaveBeenCalledWith({ search: {}, replace: true });
    await screen.unmount();

    stubRoute({
      detected: { ok: false, code: 'INTERNAL' },
      budget: ok({ totals: { spentMinor: 0n, unbudgetedSpentMinor: 0n }, version: { expectedIncomeMinor: 0n } }),
    });
    const second = await renderApp(<Component />);
    expect(fake.page.mock.lastCall?.[0]).toMatchObject({
      detected: null,
      spentMinor: null,
      incomeMinor: null,
      initialNew: false,
    });
    expect(fake.page.mock.lastCall?.[0]).not.toHaveProperty('initialSubscriptionId');
    await second.screen.unmount();

    for (const budget of [
      null,
      { ok: false, code: 'INTERNAL' },
      ok({ totals: { spentMinor: 1n, unbudgetedSpentMinor: 0n }, version: null }),
    ]) {
      stubRoute({ budget });
      const third = await renderApp(<Component />);
      expect(fake.page.mock.lastCall?.[0]).toMatchObject({ incomeMinor: null });
      await third.screen.unmount();
    }
  });

  it('explains a failed load with a retry, and shows a loading state', async () => {
    const Component = Route.options.component as ComponentType;
    for (const failed of [
      { overview: { ok: false, code: 'UNAUTHENTICATED' } },
      { accounts: { ok: false, code: 'UNAUTHENTICATED' } },
      { categories: { ok: false, code: 'NOT_FOUND' } },
    ]) {
      stubRoute(failed);
      const { screen, router } = await renderApp(<Component />);
      await expect.element(screen.getByText('Langganan gagal dimuat')).toBeVisible();
      const invalidate = vi.spyOn(router, 'invalidate').mockResolvedValue();
      await screen.getByRole('button', { name: 'Coba lagi' }).click();
      expect(invalidate).toHaveBeenCalled();
      await screen.unmount();
    }
    const Pending = Route.options.pendingComponent as ComponentType;
    const { screen } = await renderApp(<Pending />);
    await expect.element(screen.getByText('Memuat langganan…')).toBeVisible();
  });
});
