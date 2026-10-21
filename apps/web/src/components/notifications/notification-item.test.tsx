// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { ICLOUD_OVERDUE, NETFLIX_REMINDER, notification, PERIOD_CLOSED } from '../../../test/notification-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { actionLabel, dayHeading, groupByDay, NotificationItem, NotificationMessage } from './notification-item.tsx';

const d = (value: string) => value as LocalDate;

describe('NotificationItem', () => {
  it('shows the title and body from their keys, the time, and the action that opens a page', async () => {
    const onAction = vi.fn();
    const { screen } = await renderApp(
      <NotificationItem notification={NETFLIX_REMINDER} locale="id" timeZone="Asia/Jakarta" onAction={onAction} />,
    );
    const item = screen.getByRole('article', { name: 'Netflix ditagih 18 Okt' });
    await expect.element(item).toMatchTextContent('Rp186.000 dari BCA Tahapan · 1 hari lagi.');
    await expect.element(item).toMatchTextContent('09.00');
    await expect.element(item).toMatchTextContent('Belum dibaca');
    await expect.element(item.getByRole('button', { name: 'Tandai dibaca' })).not.toBeInTheDocument();
    await userEvent.click(item.getByRole('button', { name: 'Lihat langganan' }));
    expect(onAction).toHaveBeenCalledWith(NETFLIX_REMINDER, '/subscriptions');
  });

  it('offers "Tandai dibaca" for unread ones on the page; read ones without an action show no buttons', async () => {
    const onMarkRead = vi.fn();
    const { screen } = await renderApp(
      <>
        <NotificationItem
          notification={ICLOUD_OVERDUE}
          locale="id"
          timeZone="Asia/Jakarta"
          onAction={vi.fn()}
          onMarkRead={onMarkRead}
        />
        <NotificationItem
          notification={PERIOD_CLOSED}
          locale="id"
          timeZone="Asia/Jakarta"
          onAction={vi.fn()}
          onMarkRead={onMarkRead}
        />
        <NotificationItem
          notification={{ ...ICLOUD_OVERDUE, id: 'n-quiet', action: null }}
          locale="id"
          timeZone="Asia/Jakarta"
          onAction={vi.fn()}
          onMarkRead={onMarkRead}
        />
      </>,
    );
    const icloud = screen.getByRole('article').nth(0);
    await expect.element(icloud.getByRole('button', { name: 'Buka Perlu ditinjau' })).toBeVisible();
    await userEvent.click(icloud.getByRole('button', { name: 'Tandai dibaca' }));
    expect(onMarkRead).toHaveBeenCalledWith(ICLOUD_OVERDUE);
    const closed = screen.getByRole('article').nth(1);
    await expect.element(closed).toMatchTextContent('Periode 1 Sep – 30 Sep ditutup');
    await expect.element(closed).toMatchTextContent('sisa Rp1.150.000');
    await expect.element(closed.getByRole('button')).not.toBeInTheDocument();
    await expect.element(screen.getByRole('article').nth(2).getByRole('button')).toHaveTextContent('Tandai dibaca');
  });

  it('names built-in categories in the reader language and shows unknown keys as they are', async () => {
    const { screen } = await renderApp(
      <>
        <p data-testid="known">
          <NotificationMessage
            messageKey="notification_budget_threshold_title"
            params={{ category: 'system:food', usedPct: 91 }}
            locale="id"
          />
        </p>
        <p data-testid="unknown">
          <NotificationMessage messageKey="notification_from_the_future" params={{}} locale="id" />
        </p>
      </>,
    );
    await expect.element(screen.getByTestId('known')).toHaveTextContent('Makan & Dapur 91%');
    await expect.element(screen.getByTestId('unknown')).toHaveTextContent('notification_from_the_future');
  });
});

describe('notification helpers', () => {
  it('labels actions by the page they open', () => {
    expect(['/review', '/budget', '/accounts', '/subscriptions', '/calendar', '/goals'].map(actionLabel)).toEqual([
      'Buka Perlu ditinjau',
      'Lihat anggaran',
      'Lihat rekening',
      'Lihat langganan',
      'Lihat kalender',
      'Buka',
    ]);
  });

  it('groups by day in the time zone, newest first, with Hari ini / Kemarin / the weekday', () => {
    const late = notification('n-late', { createdAt: new Date('2026-10-17T16:59:00Z') });
    const groups = groupByDay([late, NETFLIX_REMINDER, ICLOUD_OVERDUE, PERIOD_CLOSED], 'Asia/Jakarta');
    // iCloud+'s came at 00.05 WIB on 17 Okt (16 Okt in UTC).
    expect(groups.map((group) => [group.day, group.items.map((item) => item.id)])).toEqual([
      ['2026-10-17', ['n-late', 'n-netflix', 'n-icloud']],
      ['2026-10-12', ['n-period']],
    ]);
    expect(dayHeading(d('2026-10-17'), d('2026-10-17'), 'id')).toBe('Hari ini · 17 Okt');
    expect(dayHeading(d('2026-10-16'), d('2026-10-17'), 'id')).toBe('Kemarin · 16 Okt');
    expect(dayHeading(d('2026-10-12'), d('2026-10-17'), 'id')).toBe('Senin, 12 Okt');
  });
});
