// SPDX-License-Identifier: AGPL-3.0-only
import type * as Router from '@tanstack/react-router';
import type { LocalDate } from '@wf/domain/period';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import {
  counts,
  ICLOUD_OVERDUE,
  NETFLIX_REMINDER,
  notification,
  PERIOD_CLOSED,
} from '../../../test/notification-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import type { NotificationsSearch } from '../../lib/notifications-search.ts';
import { NotificationsPage, type NotificationsPageProps } from './notifications-page.tsx';

const server = vi.hoisted(() => ({ listNotifications: vi.fn(), markNotificationsRead: vi.fn() }));
vi.mock('../../server/fn/notifications.ts', () => server);
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@wf/ui/toast', () => toasts);
const navigation = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof Router>()),
  useNavigate: () => navigation.navigate,
}));

const ok = <T,>(value: T) => ({ ok: true, value }) as const;
const today = '2026-10-17' as LocalDate;
const PAGE: NotificationsPageProps['page'] = {
  items: [NETFLIX_REMINDER, ICLOUD_OVERDUE, PERIOD_CLOSED],
  nextCursor: 'n-period',
};

async function renderPage(search: NotificationsSearch = {}, pageData = PAGE, countData = counts()) {
  const result = await renderApp(
    <NotificationsPage search={search} page={pageData} counts={countData} today={today} timeZone="Asia/Jakarta" />,
  );
  return {
    ...result,
    invalidate: vi.spyOn(result.router, 'invalidate').mockResolvedValue(),
    routerNavigate: vi.spyOn(result.router, 'navigate').mockResolvedValue(),
  };
}

interface SearchUpdate {
  readonly search: (current: NotificationsSearch) => NotificationsSearch;
}

/** The search a `navigate({ search })` call produced from `current`. */
function searchOf(call: unknown[] | undefined, current: NotificationsSearch = {}): NotificationsSearch {
  // The page always navigates with a search updater.
  const [update] = (call ?? []) as [SearchUpdate];
  return update.search(current);
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('NotificationsPage', () => {
  it('lists the range grouped by day with the filter counts and the retention note', async () => {
    const { screen } = await renderPage();
    await expect.element(screen.getByRole('heading', { level: 1, name: 'Semua notifikasi' })).toBeVisible();
    await expect.element(screen.getByText('18 Sep – 17 Okt · notifikasi disimpan 90 hari')).toBeVisible();
    const filters = screen.getByRole('group', { name: 'Saring notifikasi' });
    await expect.element(filters.getByRole('button', { name: 'Semua 3' })).toHaveAttribute('aria-pressed', 'true');
    await expect.element(filters.getByRole('button', { name: 'Belum dibaca 2' })).toBeVisible();
    await expect.element(filters.getByRole('button', { name: 'Pengingat tagihan 1' })).toBeVisible();
    await expect.element(filters.getByRole('button', { name: 'Tagihan lewat 1' })).toBeVisible();
    await expect.element(filters.getByRole('button', { name: /^Saldo rendah/ })).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole('region', { name: 'Hari ini · 17 Okt' }))
      .toMatchTextContent('Netflix ditagih 18 Okt');
    await expect.element(screen.getByRole('region', { name: 'Senin, 12 Okt' })).toMatchTextContent('Periode');
    await expect.element(screen.getByText('Notifikasi disimpan 90 hari, lalu dihapus otomatis.')).toBeVisible();
  });

  it('filters by Unread and by type in the URL, toggling back to all', async () => {
    const { screen } = await renderPage({ filter: 'unread', type: 'bill_overdue' });
    const filters = screen.getByRole('group', { name: 'Saring notifikasi' });
    await expect.element(filters.getByRole('button', { name: 'Semua 3' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(filters.getByRole('button', { name: 'Belum dibaca 2' }));
    expect(searchOf(navigation.navigate.mock.lastCall, { filter: 'unread', q: 'x' })).toEqual({
      filter: undefined,
      q: 'x',
    });
    await userEvent.click(filters.getByRole('button', { name: 'Tagihan lewat 1' }));
    expect(searchOf(navigation.navigate.mock.lastCall)).toEqual({ type: undefined });
    await userEvent.click(filters.getByRole('button', { name: 'Pengingat tagihan 1' }));
    expect(searchOf(navigation.navigate.mock.lastCall)).toEqual({ type: 'bill_reminder' });
    await userEvent.click(filters.getByRole('button', { name: 'Semua 3' }));
    expect(searchOf(navigation.navigate.mock.lastCall, { filter: 'unread', type: 'system' })).toEqual({
      filter: undefined,
      type: undefined,
    });
    await screen.unmount();
    const plain = await renderPage();
    await userEvent.click(plain.screen.getByRole('button', { name: 'Belum dibaca 2' }));
    expect(searchOf(navigation.navigate.mock.lastCall)).toEqual({ filter: 'unread' });
  });

  it('searches once typing pauses, and clears the search', async () => {
    const { screen } = await renderPage({ q: 'net' });
    const search = screen.getByRole('searchbox', { name: 'Cari notifikasi' });
    await expect.element(search).toHaveValue('net');
    await userEvent.fill(search, ' netflix ');
    await vi.waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalled();
    });
    expect(searchOf(navigation.navigate.mock.lastCall)).toEqual({ q: 'netflix' });
    await userEvent.clear(search);
    await vi.waitFor(() => {
      expect(searchOf(navigation.navigate.mock.lastCall)).toEqual({ q: undefined });
    });
  });

  it('keeps the chips, the search, and the range on one row on a desktop', async () => {
    await page.viewport(1440, 900);
    const { screen } = await renderPage();
    const chips = screen.getByRole('group', { name: 'Saring notifikasi' }).element().getBoundingClientRect();
    const search = screen.getByRole('searchbox', { name: 'Cari notifikasi' }).element().getBoundingClientRect();
    const range = screen
      .getByRole('button', { name: /^Rentang tanggal notifikasi/ })
      .element()
      .getBoundingClientRect();
    for (const control of [search, range]) {
      expect(control.top).toBeLessThan(chips.bottom);
      expect(control.bottom).toBeGreaterThan(chips.top);
    }
    expect(search.right).toBeLessThan(range.left);
  });

  it('picks a range', async () => {
    const { screen } = await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Rentang tanggal notifikasi: 18 Sep – 17 Okt' }));
    await userEvent.click(page.getByRole('button', { name: /^7 hari terakhir/ }));
    await userEvent.click(page.getByRole('button', { name: 'Terapkan' }));
    expect(searchOf(navigation.navigate.mock.lastCall)).toEqual({ from: '2026-10-11', to: '2026-10-17' });
  });

  it('marks one or all read, opens an action, and tells a failure', async () => {
    server.markNotificationsRead
      .mockResolvedValueOnce(ok({ updated: 1 }))
      .mockResolvedValueOnce(ok({ updated: 2 }))
      .mockResolvedValueOnce({ ok: false, code: 'X' })
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue(ok({ updated: 1 }));
    const { screen, invalidate, routerNavigate } = await renderPage();
    const netflix = screen.getByRole('article', { name: 'Netflix ditagih 18 Okt' });
    await userEvent.click(netflix.getByRole('button', { name: 'Tandai dibaca' }));
    expect(server.markNotificationsRead).toHaveBeenCalledWith({ data: { ids: [NETFLIX_REMINDER.id] } });
    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalledOnce();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Tandai semua dibaca' }));
    expect(server.markNotificationsRead).toHaveBeenLastCalledWith({ data: { all: true } });
    await userEvent.click(netflix.getByRole('button', { name: 'Tandai dibaca' }));
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({
        tone: 'error',
        title: expect.stringContaining('ditandai') as string,
      });
    });
    await userEvent.click(netflix.getByRole('button', { name: 'Tandai dibaca' }));
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledTimes(2);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Buka Perlu ditinjau' }));
    expect(routerNavigate).toHaveBeenCalledWith({ href: '/review' });
  });

  it('loads older notifications with the filters, and says when that fails', async () => {
    const older = notification('n-older', { createdAt: new Date('2026-10-01T02:00:00Z') });
    server.listNotifications
      .mockResolvedValueOnce(ok({ items: [older], nextCursor: 'n-older' }))
      .mockResolvedValueOnce({ ok: false, code: 'X' })
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(ok({ items: [], nextCursor: null }));
    const { screen } = await renderPage({ filter: 'unread', type: 'bill_reminder', q: 'netflix' });
    const more = screen.getByRole('button', { name: 'Muat lebih lama' });
    await userEvent.click(more);
    expect(server.listNotifications).toHaveBeenCalledWith({
      data: {
        filter: 'unread',
        type: 'bill_reminder',
        search: 'netflix',
        from: '2026-09-18',
        to: '2026-10-17',
        before: 'n-period',
      },
    });
    await expect.element(screen.getByRole('region', { name: 'Kamis, 1 Okt' })).toBeVisible();
    await userEvent.click(more);
    await userEvent.click(more);
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledTimes(2);
    });
    await userEvent.click(more);
    await expect.element(more).not.toBeInTheDocument();
    expect(server.listNotifications).toHaveBeenLastCalledWith({
      data: {
        filter: 'unread',
        type: 'bill_reminder',
        search: 'netflix',
        from: '2026-09-18',
        to: '2026-10-17',
        before: 'n-older',
      },
    });
  });

  it('loads older notifications of the plain range', async () => {
    server.listNotifications.mockResolvedValueOnce(ok({ items: [], nextCursor: null }));
    const { screen } = await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Muat lebih lama' }));
    expect(server.listNotifications).toHaveBeenCalledWith({
      data: { from: '2026-09-18', to: '2026-10-17', before: 'n-period' },
    });
  });

  it('says when nothing matches; "Tandai semua dibaca" waits for something unread', async () => {
    const { screen } = await renderPage({}, { items: [], nextCursor: null }, counts({ total: 0, unread: 0 }));
    await expect.element(screen.getByText('Tidak ada notifikasi')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Tandai semua dibaca' })).toBeDisabled();
    await expect.element(screen.getByRole('button', { name: 'Muat lebih lama' })).not.toBeInTheDocument();
  });

  it('replaces what was loaded when the loader brings a new page', async () => {
    function Harness() {
      const [data, setData] = useState(PAGE);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setData({ items: [PERIOD_CLOSED], nextCursor: null });
            }}
          >
            next page
          </button>
          <NotificationsPage search={{}} page={data} counts={counts()} today={today} timeZone="Asia/Jakarta" />
        </>
      );
    }
    const { screen } = await renderApp(<Harness />);
    await expect.element(screen.getByRole('article', { name: 'Netflix ditagih 18 Okt' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'next page' }));
    await expect.element(screen.getByRole('article', { name: 'Netflix ditagih 18 Okt' })).not.toBeInTheDocument();
  });
});
