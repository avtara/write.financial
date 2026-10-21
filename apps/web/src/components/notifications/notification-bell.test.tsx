// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ICLOUD_OVERDUE, NETFLIX_REMINDER, NEXT_REMINDER, notification } from '../../../test/notification-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { NotificationBell } from './notification-bell.tsx';

const server = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  getNextReminder: vi.fn(),
  markNotificationsRead: vi.fn(),
}));
vi.mock('../../server/fn/notifications.ts', () => server);

const ok = <T,>(value: T) => ({ ok: true, value }) as const;
const SYSTEM = notification('n-system', {
  type: 'system',
  category: 'system',
  titleKey: 'notification_from_the_future',
  bodyKey: 'notification_from_the_future_body',
  params: {},
  action: null,
});

async function renderBell(unread: number | null = 3, variant: 'sidebar' | 'rail' = 'sidebar') {
  const result = await renderApp(<NotificationBell variant={variant} unread={unread} timeZone="Asia/Jakarta" />);
  return {
    ...result,
    invalidate: vi.spyOn(result.router, 'invalidate').mockResolvedValue(),
    navigate: vi.spyOn(result.router, 'navigate').mockResolvedValue(),
  };
}

const popover = () => page.getByRole('dialog', { name: 'Notifikasi' });

afterEach(() => {
  vi.clearAllMocks();
});

describe('NotificationBell', () => {
  it('names the unread count, at most "9+"', async () => {
    const { screen } = await renderBell(12);
    await expect.element(screen.getByRole('button', { name: 'Notifikasi, 12 baru' })).toHaveTextContent('9+');
    await screen.unmount();
    for (const unread of [0, null]) {
      const bell = await renderBell(unread, 'rail');
      await expect.element(bell.screen.getByRole('button', { name: 'Notifikasi' })).toHaveTextContent('');
      await bell.screen.unmount();
    }
  });

  it('lists the unread notifications by tab and day; an action opens its page and marks it read', async () => {
    server.listNotifications.mockResolvedValue(
      ok({ items: [NETFLIX_REMINDER, ICLOUD_OVERDUE, SYSTEM], nextCursor: null }),
    );
    server.getNextReminder.mockResolvedValue(ok(NEXT_REMINDER));
    server.markNotificationsRead.mockResolvedValue(ok({ updated: 1 }));
    const { screen, navigate, invalidate } = await renderBell();
    await userEvent.click(screen.getByRole('button', { name: 'Notifikasi, 3 baru' }));
    expect(server.listNotifications).toHaveBeenCalledWith({ data: { filter: 'unread', limit: 100 } });
    await expect.element(popover()).toMatchTextContent('3 baru');
    await expect
      .element(popover().getByRole('tab', { name: 'Anggaran & tagihan 2' }))
      .toHaveAttribute('aria-selected', 'true');
    await expect.element(popover().getByRole('tab', { name: 'Sistem 1' })).toBeVisible();
    await expect
      .element(popover().getByRole('region', { name: /17 Okt$/ }))
      .toMatchTextContent('Netflix ditagih 18 Okt');
    await expect.element(popover()).toMatchTextContent('iCloud+ belum dikonfirmasi');
    await userEvent.click(popover().getByRole('button', { name: 'Buka Perlu ditinjau' }));
    expect(server.markNotificationsRead).toHaveBeenCalledWith({ data: { ids: [ICLOUD_OVERDUE.id] } });
    expect(navigate).toHaveBeenCalledWith({ href: '/review' });
    await expect.element(popover()).not.toBeInTheDocument();
    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
  });

  it('"Tandai dibaca" marks the open tab read and then shows the next reminder', async () => {
    server.listNotifications.mockResolvedValue(ok({ items: [NETFLIX_REMINDER, SYSTEM], nextCursor: null }));
    server.getNextReminder.mockResolvedValue(ok(NEXT_REMINDER));
    server.markNotificationsRead
      .mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' })
      .mockResolvedValue(ok({ updated: 1 }));
    const { screen } = await renderBell();
    await userEvent.click(screen.getByRole('button', { name: /^Notifikasi/ }));
    const markRead = popover().getByRole('button', { name: 'Tandai dibaca' });
    await userEvent.click(markRead);
    expect(server.markNotificationsRead).toHaveBeenCalledWith({ data: { all: true, category: 'budget_bills' } });
    // A failure keeps them.
    await expect.element(popover()).toMatchTextContent('Netflix ditagih 18 Okt');
    await userEvent.click(markRead);
    await expect.element(popover()).toMatchTextContent('Semua sudah dibaca');
    await expect
      .element(popover())
      .toMatchTextContent('Pengingat berikutnya: Netflix ditagih 18 Nov (Rp186.000), dikirim H-1 jam 09.00.');
    await expect.element(markRead).toBeDisabled();
    // The system tab still has its one.
    await userEvent.click(popover().getByRole('tab', { name: /^Sistem/ }));
    await expect.element(popover()).toMatchTextContent('notification_from_the_future');
    await expect.element(popover().getByRole('button', { name: 'Tandai dibaca' })).toBeEnabled();
  });

  it('says when nothing is unread and no reminder is due, or a reminder on the day', async () => {
    server.listNotifications.mockResolvedValue(ok({ items: [], nextCursor: null }));
    server.getNextReminder.mockResolvedValueOnce(ok(null)).mockResolvedValueOnce({ ok: false, code: 'X' });
    const { screen } = await renderBell(0);
    const bell = screen.getByRole('button', { name: 'Notifikasi' });
    await userEvent.click(bell);
    await expect.element(popover()).toMatchTextContent('Semua sudah dibaca');
    await expect.element(popover()).not.toMatchTextContent('Pengingat berikutnya');
    await userEvent.keyboard('{Escape}');
    server.getNextReminder
      .mockReset()
      .mockResolvedValue(ok({ ...NEXT_REMINDER, remindAt: new Date('2026-11-18T02:00:00Z') }));
    await userEvent.click(bell);
    await expect.element(popover()).toMatchTextContent('dikirim Hari H jam 09.00');
  });

  it('explains when the list could not be loaded, and the link opens the page', async () => {
    server.listNotifications
      .mockResolvedValueOnce({ ok: false, code: 'X' })
      .mockRejectedValueOnce(new TypeError('offline'));
    server.getNextReminder.mockResolvedValue({ ok: false, code: 'X' });
    const { screen } = await renderBell();
    const bell = screen.getByRole('button', { name: /^Notifikasi/ });
    await userEvent.click(bell);
    await expect.element(popover()).toMatchTextContent('Notifikasi tidak bisa dimuat');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(bell);
    await expect.element(popover()).toMatchTextContent('Notifikasi tidak bisa dimuat');
    await userEvent.click(popover().getByRole('link', { name: 'Lihat semua notifikasi' }));
    await expect.element(popover()).not.toBeInTheDocument();
  });

  it('shows "Memuat" while loading and ignores a mark-read that throws', async () => {
    const pending = Promise.withResolvers<unknown>();
    server.listNotifications.mockReturnValueOnce(pending.promise);
    server.getNextReminder.mockResolvedValue(ok(null));
    server.markNotificationsRead.mockRejectedValue(new TypeError('offline'));
    const { screen } = await renderBell();
    await userEvent.click(screen.getByRole('button', { name: /^Notifikasi/ }));
    await expect.element(popover()).toMatchTextContent('Memuat notifikasi…');
    pending.resolve(ok({ items: [NETFLIX_REMINDER], nextCursor: null }));
    await userEvent.click(popover().getByRole('button', { name: 'Tandai dibaca' }));
    await expect.element(popover()).toMatchTextContent('Netflix ditagih 18 Okt');
  });
});
