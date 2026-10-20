// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { Route } from './budget.tsx';

const fake = vi.hoisted(() => ({
  getBudgetStatus: vi.fn(),
  listPeriods: vi.fn(),
  listPeriodSpending: vi.fn(),
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  page: vi.fn(),
}));
vi.mock('../../server/fn/budget.ts', () => ({
  getBudgetStatus: fake.getBudgetStatus,
  listPeriods: fake.listPeriods,
  listPeriodSpending: fake.listPeriodSpending,
}));
vi.mock('../../server/fn/ledger.ts', () => ({ listAccounts: fake.listAccounts, listCategories: fake.listCategories }));
vi.mock('../../components/budget/budget-page.tsx', () => ({
  BudgetPage: (props: { onPeriodChange: (periodId: string) => void }) => {
    fake.page(props);
    return (
      <>
        <button
          type="button"
          onClick={() => {
            props.onPeriodChange(CURRENT);
          }}
        >
          current
        </button>
        <button
          type="button"
          onClick={() => {
            props.onPeriodChange(OTHER);
          }}
        >
          other
        </button>
      </>
    );
  },
}));

const CURRENT = '0192a6c4-0000-7000-8000-0000000000c1';
const OTHER = '0192a6c4-0000-7000-8000-0000000000c2';
const STATUS = { period: { id: CURRENT } };
const PERIODS = { current: { id: CURRENT } };
const OVERVIEW = { accounts: [{ id: 'bca' }] };
const ok = <T,>(value: T) => ({ ok: true, value }) as const;

type Loader = (options: { deps: { period?: string } }) => Promise<unknown>;

function stubRoute(data: unknown) {
  const navigate = vi.fn();
  vi.spyOn(Route, 'useLoaderData').mockReturnValue(data);
  vi.spyOn(Route, 'useRouteContext').mockReturnValue({ viewer: { timezone: 'Asia/Jakarta' } });
  vi.spyOn(Route, 'useNavigate').mockReturnValue(navigate as never);
  return navigate;
}

const LOADED = {
  status: ok(STATUS),
  periods: ok(PERIODS),
  categories: ok([]),
  accounts: ok(OVERVIEW),
  spending: ok([{ group: 'needs' }]),
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('/budget', () => {
  it('loads the status of the current or the chosen period with its spending', async () => {
    fake.getBudgetStatus.mockResolvedValue(ok(STATUS));
    fake.listPeriods.mockResolvedValue(ok(PERIODS));
    fake.listCategories.mockResolvedValue(ok([]));
    fake.listAccounts.mockResolvedValue(ok(OVERVIEW));
    fake.listPeriodSpending.mockResolvedValue(ok([]));
    const loader = Route.options.loader as unknown as Loader;
    expect(await loader({ deps: {} })).toEqual({
      status: ok(STATUS),
      periods: ok(PERIODS),
      categories: ok([]),
      accounts: ok(OVERVIEW),
      spending: ok([]),
    });
    expect(fake.getBudgetStatus).toHaveBeenCalledWith({ data: {} });
    expect(fake.listCategories).toHaveBeenCalledWith({ data: {} });
    expect(fake.listAccounts).toHaveBeenCalledWith({ data: { status: 'all' } });
    expect(fake.listPeriodSpending).toHaveBeenCalledWith({ data: { periodId: CURRENT } });

    await loader({ deps: { period: OTHER } });
    expect(fake.getBudgetStatus).toHaveBeenLastCalledWith({ data: { periodId: OTHER } });

    fake.listPeriodSpending.mockClear();
    fake.getBudgetStatus.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
    expect(await loader({ deps: {} })).toMatchObject({ spending: null });
    expect(fake.listPeriodSpending).not.toHaveBeenCalled();
  });

  it('titles the page, keeps a valid period, and maps the search to loader deps', () => {
    const head = Route.options.head as unknown as () => { meta: { title: string }[] };
    expect(head().meta[0]?.title).toBe('Anggaran · write.financial');
    const validate = Route.options.validateSearch as unknown as { parse: (value: unknown) => unknown };
    expect(validate.parse({ period: OTHER })).toEqual({ period: OTHER });
    expect(validate.parse({ period: 'x' })).toEqual({});
    const deps = Route.options.loaderDeps as unknown as (options: { search: { period?: string } }) => unknown;
    expect(deps({ search: { period: OTHER } })).toEqual({ period: OTHER });
  });

  it('renders the page and switches periods through the search', async () => {
    const navigate = stubRoute(LOADED);
    const Component = Route.options.component as ComponentType;
    const { screen } = await renderApp(<Component />);
    expect(fake.page).toHaveBeenCalledWith(
      expect.objectContaining({
        status: STATUS,
        periods: PERIODS,
        accounts: OVERVIEW.accounts,
        spending: [{ group: 'needs' }],
        timeZone: 'Asia/Jakarta',
      }),
    );
    await screen.getByRole('button', { name: 'current' }).click();
    expect(navigate).toHaveBeenLastCalledWith({ search: {} });
    await screen.getByRole('button', { name: 'other' }).click();
    expect(navigate).toHaveBeenLastCalledWith({ search: { period: OTHER } });
    await screen.unmount();

    stubRoute({ ...LOADED, spending: null });
    await renderApp(<Component />);
    expect(fake.page.mock.lastCall?.[0]).toMatchObject({ spending: [] });
  });

  it.each(['status', 'periods', 'categories', 'accounts'] as const)('explains a failed %s load', async (key) => {
    stubRoute({ ...LOADED, [key]: { ok: false, code: 'NOT_FOUND' } });
    const Component = Route.options.component as ComponentType;
    const { screen } = await renderApp(<Component />);
    await expect.element(screen.getByRole('heading', { name: 'Anggaran', level: 1 })).toBeVisible();
    await expect.element(screen.getByText('Data ini sudah tidak ada. Muat ulang halaman.')).toBeVisible();
    expect(fake.page).not.toHaveBeenCalled();
  });
});
