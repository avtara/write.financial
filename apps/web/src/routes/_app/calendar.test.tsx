// SPDX-License-Identifier: AGPL-3.0-only
import { setLocale } from '@wf/i18n/runtime';
import type { ComponentType } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { Route } from './calendar.tsx';

const fake = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  getBudgetStatus: vi.fn(),
  getCalendarRange: vi.fn(),
  getCalendarYear: vi.fn(),
  page: vi.fn(),
}));
vi.mock('../../server/fn/ledger.ts', () => ({ listAccounts: fake.listAccounts, listCategories: fake.listCategories }));
vi.mock('../../server/fn/budget.ts', () => ({ getBudgetStatus: fake.getBudgetStatus }));
vi.mock('../../server/fn/calendar.ts', () => ({
  getCalendarRange: fake.getCalendarRange,
  getCalendarYear: fake.getCalendarYear,
}));
vi.mock('../../components/calendar/calendar-page.tsx', () => ({
  CalendarPage: (props: object) => {
    fake.page(props);
    return <p>calendar page</p>;
  },
}));

const ok = <T,>(value: T) => ({ ok: true, value });
const ACCOUNTS = ok({ baseCurrency: 'IDR', accounts: ['bca'], availableMinor: 0n, missingRates: [] });
type Loader = (input: { deps: object; context: object }) => Promise<Record<string, unknown>>;
const loader = Route.options.loader as unknown as Loader;
const context = { viewer: { timezone: 'Asia/Jakarta' } };

function stubRoute(data: object) {
  vi.spyOn(Route, 'useLoaderData').mockReturnValue({
    view: 'month',
    date: '2026-10-15',
    today: '2026-10-15',
    data: ok('month data'),
    accounts: ACCOUNTS,
    categories: ok(['cat']),
    budget: ok({ version: { id: 'v' }, totals: { safeDailyMinor: 140_000n } }),
    ...data,
  });
  vi.spyOn(Route, 'useRouteContext').mockReturnValue(context);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

beforeAll(async () => {
  await setLocale('id', { reload: false });
});

describe('/calendar', () => {
  it('loads a month’s weeks (with October as the pattern of a month to come), a week with the one before, and a year', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T02:42:00Z'));
    fake.listAccounts.mockResolvedValue(ACCOUNTS);
    fake.listCategories.mockResolvedValue(ok([]));
    fake.getBudgetStatus.mockResolvedValue(ok('budget'));
    fake.getCalendarRange.mockResolvedValue(ok('range'));
    fake.getCalendarYear.mockResolvedValue(ok('year'));

    expect(await loader({ deps: {}, context })).toMatchObject({
      view: 'month',
      date: '2026-10-15',
      today: '2026-10-15',
      data: ok({ view: 'month', range: 'range', pattern: null }),
      budget: ok('budget'),
    });
    expect(fake.getCalendarRange).toHaveBeenCalledWith({ data: { from: '2026-09-28', to: '2026-11-01' } });

    fake.getCalendarRange.mockClear();
    expect(await loader({ deps: { date: '2026-11-03' }, context })).toMatchObject({
      data: ok({ view: 'month', range: 'range', pattern: 'range' }),
    });
    expect(fake.getCalendarRange.mock.calls).toEqual([
      [{ data: { from: '2026-10-26', to: '2026-12-06' } }],
      [{ data: { from: '2026-09-28', to: '2026-11-01' } }],
    ]);
    fake.getCalendarRange.mockResolvedValueOnce(ok('range')).mockResolvedValueOnce({ ok: false, code: 'INTERNAL' });
    expect(await loader({ deps: { date: '2026-11-03' }, context })).toMatchObject({
      data: ok({ view: 'month', range: 'range', pattern: null }),
    });
    fake.getCalendarRange.mockResolvedValueOnce({ ok: false, code: 'INTERNAL' });
    expect(await loader({ deps: {}, context })).toMatchObject({ data: { ok: false, code: 'INTERNAL' } });

    fake.getCalendarRange.mockClear();
    expect(await loader({ deps: { view: 'week' }, context })).toMatchObject({
      data: ok({ view: 'week', range: 'range' }),
    });
    expect(fake.getCalendarRange).toHaveBeenCalledWith({ data: { from: '2026-10-05', to: '2026-10-18' } });
    fake.getCalendarRange.mockResolvedValueOnce({ ok: false, code: 'INTERNAL' });
    expect(await loader({ deps: { view: 'week' }, context })).toMatchObject({ data: { ok: false } });

    expect(await loader({ deps: { view: 'year', date: '2025-06-01' }, context })).toMatchObject({
      data: ok({ view: 'year', year: 'year' }),
    });
    expect(fake.getCalendarYear).toHaveBeenCalledWith({ data: { year: 2025 } });
    fake.getCalendarYear.mockResolvedValueOnce({ ok: false, code: 'INTERNAL' });
    expect(await loader({ deps: { view: 'year' }, context })).toMatchObject({ data: { ok: false } });

    fake.getBudgetStatus.mockRejectedValueOnce(new TypeError('offline'));
    expect(await loader({ deps: {}, context })).toMatchObject({ budget: null });
    vi.useRealTimers();
  });

  it('titles the page and keeps only valid search params', () => {
    const head = Route.options.head as unknown as () => { meta: { title: string }[] };
    expect(head().meta[0]?.title).toBe('Kalender · write.financial');
    const validate = Route.options.validateSearch as unknown as { parse: (value: unknown) => unknown };
    expect(validate.parse({ view: 'week', date: '2026-10-11' })).toEqual({ view: 'week', date: '2026-10-11' });
    expect(validate.parse({ view: 'month', date: '2026-02-30' })).toEqual({});
    const deps = Route.options.loaderDeps as unknown as (input: { search: object }) => object;
    expect(deps({ search: { view: 'week', settings: 'tags' } })).toEqual({ view: 'week' });
  });

  it('renders the page with the safe daily limit, and none without a budget version', async () => {
    const Component = Route.options.component as ComponentType;
    stubRoute({});
    const first = await renderApp(<Component />);
    await expect.element(first.screen.getByText('calendar page')).toBeVisible();
    expect(fake.page).toHaveBeenCalledWith(
      expect.objectContaining({
        data: 'month data',
        date: '2026-10-15',
        accounts: ['bca'],
        baseCurrency: 'IDR',
        safeDailyMinor: 140_000n,
        timeZone: 'Asia/Jakarta',
      }),
    );
    await first.screen.unmount();
    for (const budget of [null, { ok: false, code: 'X' }, ok({ version: null, totals: { safeDailyMinor: 1n } })]) {
      stubRoute({ budget });
      const rendered = await renderApp(<Component />);
      expect(fake.page.mock.lastCall?.[0]).toMatchObject({ safeDailyMinor: null });
      await rendered.screen.unmount();
    }
  });

  it('explains a failed load with a retry and the transactions, and shows a loading state', async () => {
    const Component = Route.options.component as ComponentType;
    for (const failed of [
      { data: { ok: false, code: 'NOT_FOUND' } },
      { accounts: { ok: false, code: 'NOT_FOUND' } },
      { categories: { ok: false, code: 'NOT_FOUND' } },
    ]) {
      stubRoute(failed);
      const { screen, router } = await renderApp(<Component />);
      await expect.element(screen.getByText('Kalender gagal dimuat')).toBeVisible();
      await expect
        .element(screen.getByRole('link', { name: 'Buka Transaksi' }))
        .toHaveAttribute('href', '/transactions');
      const invalidate = vi.spyOn(router, 'invalidate').mockResolvedValue();
      await screen.getByRole('button', { name: 'Coba lagi' }).click();
      expect(invalidate).toHaveBeenCalled();
      await screen.unmount();
    }
    const Pending = Route.options.pendingComponent as ComponentType;
    const { screen } = await renderApp(<Pending />);
    await expect.element(screen.getByText('Memuat kalender…')).toBeVisible();
  });
});
