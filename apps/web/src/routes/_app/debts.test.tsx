// SPDX-License-Identifier: AGPL-3.0-only
import { setLocale } from '@wf/i18n/runtime';
import type { ComponentType } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { Route } from './debts.tsx';

const fake = vi.hoisted(() => ({ getDebtsOverview: vi.fn(), page: vi.fn() }));
vi.mock('../../server/fn/debts.ts', () => ({ getDebtsOverview: fake.getDebtsOverview }));
vi.mock('../../components/debts/debts-page.tsx', () => ({
  DEBTS_TABS: ['debts', 'receivables'],
  DebtsPage: (props: object) => {
    fake.page(props);
    return <p>debts page</p>;
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

beforeAll(async () => {
  await setLocale('id', { reload: false });
});

describe('/debts', () => {
  it('loads the overview, titles the page, and keeps only a valid `new`', async () => {
    fake.getDebtsOverview.mockResolvedValue({ ok: true, value: 'overview' });
    const loader = Route.options.loader as unknown as () => Promise<unknown>;
    expect(await loader()).toEqual({ ok: true, value: 'overview' });
    const head = Route.options.head as unknown as () => { meta: { title: string }[] };
    expect(head().meta[0]?.title).toBe('Utang & cicilan · write.financial');
    const validate = Route.options.validateSearch as unknown as { parse: (value: unknown) => unknown };
    expect(validate.parse({ new: true, tab: 'receivables' })).toEqual({ new: true, tab: 'receivables' });
    expect(validate.parse({ new: 'yes', tab: 'other' })).toEqual({});
  });

  it('renders the page with `?new` and `?tab`, a failure with a retry, and the pending state', async () => {
    vi.spyOn(Route, 'useLoaderData').mockReturnValue({ ok: true, value: 'overview' });
    vi.spyOn(Route, 'useSearch').mockReturnValue({ new: true });
    const navigate = vi.fn();
    vi.spyOn(Route, 'useNavigate').mockReturnValue(navigate as never);
    const Component = Route.options.component as ComponentType;
    const first = await renderApp(<Component />);
    await expect.element(first.screen.getByText('debts page')).toBeVisible();
    expect(fake.page).toHaveBeenCalledWith(
      expect.objectContaining({ overview: 'overview', initialNew: true, tab: 'debts' }),
    );
    const { onTabChange } = fake.page.mock.lastCall?.[0] as { onTabChange: (tab: string) => void };
    for (const tab of ['receivables', 'debts']) onTabChange(tab);
    const searches = navigate.mock.calls.map(([options]) =>
      (options as { search: (previous: object) => object }).search({ new: true, tab: 'x' }),
    );
    expect(searches).toEqual([
      { new: true, tab: 'receivables' },
      { new: true, tab: undefined },
    ]);
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ replace: true }));
    await first.screen.unmount();
    vi.spyOn(Route, 'useSearch').mockReturnValue({ tab: 'receivables' });
    const second = await renderApp(<Component />);
    expect(fake.page).toHaveBeenLastCalledWith(expect.objectContaining({ initialNew: false, tab: 'receivables' }));
    await second.screen.unmount();

    vi.spyOn(Route, 'useLoaderData').mockReturnValue({ ok: false, code: 'NOT_FOUND' });
    vi.spyOn(Route, 'useSearch').mockReturnValue({});
    const failed = await renderApp(<Component />);
    await expect.element(failed.screen.getByText('Utang & cicilan gagal dimuat')).toBeVisible();
    const invalidate = vi.spyOn(failed.router, 'invalidate').mockResolvedValue();
    await failed.screen.getByRole('button', { name: 'Coba lagi' }).click();
    expect(invalidate).toHaveBeenCalled();
    await failed.screen.unmount();

    const Pending = Route.options.pendingComponent as ComponentType;
    const pending = await renderApp(<Pending />);
    await expect.element(pending.screen.getByText('Memuat utang & cicilan…')).toBeVisible();
  });
});
