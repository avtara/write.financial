// SPDX-License-Identifier: AGPL-3.0-only
import { setLocale } from '@wf/i18n/runtime';
import type { ComponentType } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { Route } from './notifications.tsx';

const fake = vi.hoisted(() => ({ listNotifications: vi.fn(), getNotificationCounts: vi.fn(), page: vi.fn() }));
vi.mock('../../server/fn/notifications.ts', () => ({
  listNotifications: fake.listNotifications,
  getNotificationCounts: fake.getNotificationCounts,
}));
vi.mock('../../components/notifications/notifications-page.tsx', () => ({
  NotificationsPage: (props: unknown) => {
    fake.page(props);
    return <p>notifications page</p>;
  },
}));

const ok = <T,>(value: T) => ({ ok: true, value }) as const;
const failed = { ok: false, code: 'NOT_FOUND' } as const;
const LOADED = { page: ok({ items: [], nextCursor: null }), counts: ok({ total: 0 }), today: '2026-10-17' };
const VIEWER = { viewer: { timezone: 'Asia/Jakarta' } };

type Loader = (options: { deps: object; context: typeof VIEWER }) => Promise<unknown>;

// Other files in the same browser may leave English as the current locale.
beforeAll(async () => {
  await setLocale('id', { reload: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('/notifications', () => {
  it('loads the page and the counts of the range with the filters from the URL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-17T03:00:00Z'));
    fake.listNotifications.mockResolvedValue(LOADED.page);
    fake.getNotificationCounts.mockResolvedValue(LOADED.counts);
    const loader = Route.options.loader as unknown as Loader;
    expect(await loader({ deps: {}, context: VIEWER })).toEqual(LOADED);
    expect(fake.listNotifications).toHaveBeenLastCalledWith({ data: { from: '2026-09-18', to: '2026-10-17' } });
    expect(fake.getNotificationCounts).toHaveBeenLastCalledWith({ data: { from: '2026-09-18', to: '2026-10-17' } });
    await loader({
      deps: { filter: 'unread', type: 'low_balance', q: 'gopay', from: '2026-10-01', to: '2026-10-05' },
      context: VIEWER,
    });
    expect(fake.listNotifications).toHaveBeenLastCalledWith({
      data: { from: '2026-10-01', to: '2026-10-05', filter: 'unread', type: 'low_balance', search: 'gopay' },
    });
    const search = Route.options.validateSearch as unknown as { parse: (input: unknown) => unknown };
    expect(search.parse({ filter: 'unread', type: 'system', q: 'x', from: '2026-10-01', to: 'nope' })).toEqual({
      filter: 'unread',
      type: 'system',
      q: 'x',
      from: '2026-10-01',
    });
    expect(search.parse({ filter: 'all', type: 'spam' })).toEqual({});
    const deps = Route.options.loaderDeps as unknown as (options: { search: object }) => object;
    expect(deps({ search: { q: 'x' } })).toEqual({ q: 'x' });
    const head = Route.options.head as unknown as () => { meta: { title: string }[] };
    expect(head().meta[0]?.title).toBe('Semua notifikasi · write.financial');
  });

  it('renders the page, or says what could not be loaded', async () => {
    const Page = Route.options.component as ComponentType;
    vi.spyOn(Route, 'useSearch').mockReturnValue({ q: 'x' });
    vi.spyOn(Route, 'useRouteContext').mockReturnValue(VIEWER);
    vi.spyOn(Route, 'useLoaderData').mockReturnValue(LOADED);
    const { screen } = await renderApp(<Page />);
    await expect.element(screen.getByText('notifications page')).toBeVisible();
    expect(fake.page).toHaveBeenCalledWith(
      expect.objectContaining({
        search: { q: 'x' },
        page: { items: [], nextCursor: null },
        today: '2026-10-17',
        timeZone: 'Asia/Jakarta',
      }),
    );
    await screen.unmount();
    for (const broken of [
      { ...LOADED, page: failed },
      { ...LOADED, counts: failed },
    ]) {
      vi.spyOn(Route, 'useLoaderData').mockReturnValue(broken);
      const rendered = await renderApp(<Page />);
      await expect.element(rendered.screen.getByText('Notifikasi tidak bisa dimuat')).toBeVisible();
      await rendered.screen.unmount();
    }
  });
});
