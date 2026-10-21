// SPDX-License-Identifier: AGPL-3.0-only
import { setLocale } from '@wf/i18n/runtime';
import type { ComponentType } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { Route } from './goals.tsx';

const fake = vi.hoisted(() => ({ getGoals: vi.fn(), listAccounts: vi.fn(), page: vi.fn() }));
vi.mock('../../server/fn/goals.ts', () => ({ getGoals: fake.getGoals }));
vi.mock('../../server/fn/ledger.ts', () => ({ listAccounts: fake.listAccounts }));
vi.mock('../../components/goals/goals-page.tsx', () => ({
  GoalsPage: (props: { onConsumeSearch: () => void; onMonthChange: (month: string) => void }) => {
    fake.page(props);
    return (
      <>
        <button type="button" onClick={props.onConsumeSearch}>
          consume
        </button>
        <button
          type="button"
          onClick={() => {
            props.onMonthChange('2026-09');
          }}
        >
          september
        </button>
      </>
    );
  },
}));

const ID = '0192a6c4-0000-7000-8000-0000000000b1';
const ok = <T,>(value: T) => ({ ok: true, value });
const ACCOUNTS = ok({ baseCurrency: 'IDR', accounts: ['bca'], availableMinor: 0n, missingRates: [] });

function stubRoute(data: object, search: object = {}) {
  const navigate = vi.fn();
  vi.spyOn(Route, 'useLoaderData').mockReturnValue({ overview: ok('overview'), accounts: ACCOUNTS, ...data });
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

describe('/goals', () => {
  it('loads the goals of the month asked for and every account', async () => {
    fake.getGoals.mockResolvedValue(ok('overview'));
    fake.listAccounts.mockResolvedValue(ACCOUNTS);
    const loader = Route.options.loader as unknown as (options: { deps: { month?: string } }) => Promise<unknown>;
    expect(await loader({ deps: {} })).toEqual({ overview: ok('overview'), accounts: ACCOUNTS });
    expect(fake.getGoals).toHaveBeenCalledWith({ data: {} });
    expect(fake.listAccounts).toHaveBeenCalledWith({ data: { status: 'all' } });
    await loader({ deps: { month: '2026-09' } });
    expect(fake.getGoals).toHaveBeenLastCalledWith({ data: { month: '2026-09' } });
    const deps = Route.options.loaderDeps as unknown as (options: { search: object }) => unknown;
    expect(deps({ search: { month: '2026-09', goal: ID } })).toEqual({ month: '2026-09' });
  });

  it('titles the page and keeps only valid search params', () => {
    const head = Route.options.head as unknown as () => { meta: { title: string }[] };
    expect(head().meta[0]?.title).toBe('Tabungan · write.financial');
    const validate = Route.options.validateSearch as unknown as { parse: (value: unknown) => unknown };
    expect(validate.parse({ month: '2026-09', goal: ID, new: true, remainder: ID })).toEqual({
      month: '2026-09',
      goal: ID,
      new: true,
      remainder: ID,
    });
    expect(validate.parse({ month: '2026-13', goal: 'x', new: 'yes', remainder: 1 })).toEqual({});
  });

  it('renders the page with the search params, drops them once used, and moves between months', async () => {
    const navigate = stubRoute({}, { goal: ID, new: true, remainder: ID, month: '2026-10' });
    const Component = Route.options.component as ComponentType;
    const { screen } = await renderApp(<Component />);
    expect(fake.page).toHaveBeenCalledWith(
      expect.objectContaining({
        overview: 'overview',
        accounts: ['bca'],
        timeZone: 'Asia/Jakarta',
        initialGoalId: ID,
        initialNew: true,
        initialRemainderId: ID,
      }),
    );
    await screen.getByRole('button', { name: 'consume' }).click();
    const consumed = navigate.mock.lastCall?.[0] as { search: (previous: object) => object; replace: boolean };
    expect(consumed.replace).toBe(true);
    expect(consumed.search({ month: '2026-10', goal: ID, new: true, remainder: ID })).toEqual({
      month: '2026-10',
      goal: undefined,
      new: undefined,
      remainder: undefined,
    });
    await screen.getByRole('button', { name: 'september' }).click();
    const moved = navigate.mock.lastCall?.[0] as { search: (previous: object) => object };
    expect(moved.search({ month: '2026-10' })).toEqual({ month: '2026-09' });
    await screen.unmount();
    stubRoute({});
    await renderApp(<Component />);
    expect(fake.page.mock.lastCall?.[0]).toMatchObject({ initialNew: false, initialGoalId: undefined });
  });

  it('explains a failed load with a retry, and shows a loading state', async () => {
    const Component = Route.options.component as ComponentType;
    for (const failed of [
      { overview: { ok: false, code: 'UNAUTHENTICATED' } },
      { accounts: { ok: false, code: 'NOT_FOUND' } },
    ]) {
      stubRoute(failed);
      const { screen, router } = await renderApp(<Component />);
      await expect.element(screen.getByText('Tujuan tabungan gagal dimuat')).toBeVisible();
      const invalidate = vi.spyOn(router, 'invalidate').mockResolvedValue();
      await screen.getByRole('button', { name: 'Coba lagi' }).click();
      expect(invalidate).toHaveBeenCalled();
      await screen.unmount();
    }
    const Pending = Route.options.pendingComponent as ComponentType;
    const { screen } = await renderApp(<Pending />);
    await expect.element(screen.getByText('Memuat tabungan…')).toBeVisible();
  });
});
