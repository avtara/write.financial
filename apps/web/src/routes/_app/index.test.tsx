// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { periodsOverview } from '../../../test/budget-fixtures.ts';
import { dashboard } from '../../../test/dashboard-fixtures.ts';
import { VIEWER } from '../../../test/fake-auth.ts';
import { renderApp } from '../../../test/render.tsx';
import type { OverviewData } from '../../components/overview-page.tsx';
import { Route } from './index.tsx';

const fns = vi.hoisted(() => ({
  listPeriods: vi.fn(),
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listTags: vi.fn(),
  getProfile: vi.fn(),
  getBudgetStatus: vi.fn(),
  getDashboard: vi.fn(),
  listSubscriptions: vi.fn(),
  listScheduled: vi.fn(),
  listAutoRules: vi.fn(),
}));
vi.mock('../../server/fn/budget.ts', () => ({
  listPeriods: fns.listPeriods,
  getBudgetStatus: fns.getBudgetStatus,
  getDashboard: fns.getDashboard,
}));
vi.mock('../../server/fn/ledger.ts', () => ({
  listAccounts: fns.listAccounts,
  listCategories: fns.listCategories,
  listTags: fns.listTags,
}));
vi.mock('../../server/fn/rules.ts', () => ({ listAutoRules: fns.listAutoRules }));
vi.mock('../../server/fn/account.ts', () => ({ getProfile: fns.getProfile }));
vi.mock('../../server/fn/schedules.ts', () => ({
  listSubscriptions: fns.listSubscriptions,
  listScheduled: fns.listScheduled,
}));
const page = vi.hoisted(() => ({ props: vi.fn() }));
vi.mock('../../components/overview-page.tsx', () => ({
  OverviewPage: (props: { refreshing?: boolean; offline?: boolean }) => {
    page.props(props);
    return (
      <p>
        {props.offline === true ? 'overview offline' : props.refreshing === true ? 'overview refreshing' : 'overview'}
      </p>
    );
  },
}));

type Loader = (args: { deps: object }) => Promise<unknown>;
const loader = Route.options.loader as unknown as Loader;
const ok = <T,>(value: T) => ({ ok: true as const, value });

function answer() {
  fns.listPeriods.mockResolvedValue(ok(periodsOverview()));
  fns.listAccounts.mockResolvedValue(ok({ accounts: [] }));
  fns.listCategories.mockResolvedValue(ok([]));
  fns.listTags.mockResolvedValue(ok([]));
  fns.getProfile.mockResolvedValue(ok({ name: 'Avtara K.', nickname: 'Avtara' }));
  fns.getBudgetStatus.mockResolvedValue(ok({ lines: [] }));
  fns.getDashboard.mockResolvedValue(ok(dashboard()));
  fns.listSubscriptions.mockResolvedValue(ok({ subscriptions: [] }));
  fns.listScheduled.mockResolvedValue(ok([]));
  fns.listAutoRules.mockResolvedValue(ok([]));
}

async function renderRoute(which: 'component' | 'pendingComponent', load?: unknown) {
  if (load !== undefined) vi.spyOn(Route, 'useLoaderData').mockReturnValue(load);
  vi.spyOn(Route, 'useRouteContext').mockReturnValue({ viewer: VIEWER });
  const Component = Route.options[which] as ComponentType;
  const { screen } = await renderApp(<Component />);
  return screen;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe('/ (Overview) loader', () => {
  it('reloads when its search changes, not when Settings opens over it', () => {
    const loaderDeps = Route.options.loaderDeps as unknown as (args: { search: object }) => object;
    expect(loaderDeps({ search: { scope: 'week', settings: 'tags' } })).toEqual({ scope: 'week' });
  });

  it('loads another period with its own budget, and a range without the period rows', async () => {
    answer();
    await loader({ deps: { period: '2026-09' } });
    expect(fns.getDashboard).toHaveBeenLastCalledWith({ data: { scope: 'month', periodId: 'p-sep' } });
    expect(fns.getBudgetStatus).toHaveBeenLastCalledWith({ data: { periodId: 'p-sep' } });
    fns.getBudgetStatus.mockClear();
    await loader({ deps: { period: '2026-10' } });
    expect(fns.getBudgetStatus).toHaveBeenCalledOnce();
    fns.listPeriods.mockResolvedValue({ ok: false, code: 'INTERNAL' });
    fns.getDashboard.mockResolvedValue({ ok: false, code: 'INVALID_PERIOD' });
    fns.getBudgetStatus.mockClear();
    const load = (await loader({ deps: { period: '2026-09' } })) as OverviewData;
    expect(fns.getDashboard).toHaveBeenLastCalledWith({ data: { scope: 'month' } });
    expect(load.scheduled).toBeNull();
    fns.listPeriods.mockResolvedValue(ok(periodsOverview()));
    await loader({ deps: { range: '2026-09-14..2026-10-13' } });
    expect(fns.getDashboard).toHaveBeenLastCalledWith({
      data: { scope: 'range', from: '2026-09-14', to: '2026-10-13' },
    });
  });

  it('is offline when a request never reaches the server, and rethrows anything else', async () => {
    answer();
    fns.listAccounts.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(loader({ deps: {} })).resolves.toEqual({ status: 'offline' });
    fns.listAccounts.mockRejectedValue(new Error('boom'));
    await expect(loader({ deps: {} })).rejects.toThrow('boom');
  });
});

describe('/ (Overview) views', () => {
  it('shows the skeleton on a first slow load', async () => {
    const screen = await renderRoute('pendingComponent');
    await expect.element(screen.getByRole('status', { name: 'Memuat ringkasan…' })).toBeInTheDocument();
    await expect.element(screen.getByText('Memuat ringkasan…', { exact: true })).toBeVisible();
  });

  it('is offline without data, then shows the overview, keeps it while loading, and offers it offline', async () => {
    const offline = await renderRoute('component', { status: 'offline' });
    await expect.element(offline.getByText('Kamu sedang offline')).toBeVisible();
    expect(offline.getByRole('button', { name: /Lihat data terakhir/ }).query()).toBeNull();
    await userEvent.click(offline.getByRole('button', { name: 'Coba lagi' }));

    const ready = { status: 'ready', loadedAt: new Date('2026-10-15T09:40:00Z') };
    const screen = await renderRoute('component', ready);
    await expect.element(screen.getByText('overview', { exact: true })).toBeVisible();

    const pending = await renderRoute('pendingComponent');
    await expect.element(pending.getByText('overview refreshing')).toBeVisible();

    const again = await renderRoute('component', { status: 'offline' });
    await userEvent.click(again.getByRole('button', { name: 'Lihat data terakhir · 15 Okt 16.40' }));
    await expect.element(again.getByText('overview offline')).toBeVisible();
  });
});
