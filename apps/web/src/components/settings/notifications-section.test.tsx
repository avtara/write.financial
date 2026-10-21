// SPDX-License-Identifier: AGPL-3.0-only
import { DEFAULT_NOTIFICATION_SETTINGS } from '@wf/db/notification-settings';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import { NotificationsSection } from './notifications-section.tsx';

const server = vi.hoisted(() => ({ updateNotificationSettings: vi.fn() }));
vi.mock('../../server/fn/notifications.ts', () => server);
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@wf/ui/toast', () => toasts);

const ok = <T,>(value: T) => ({ ok: true, value }) as const;

afterEach(() => {
  vi.clearAllMocks();
});

describe('NotificationsSection', () => {
  it('switches each kind in the app and by email, the reminder time, and the email opt-in, then saves', async () => {
    const { screen } = await renderApp(
      <NotificationsSection settings={DEFAULT_NOTIFICATION_SETTINGS} email="avtara@example.test" />,
    );
    await expect.element(screen.getByText('Langganan & tagihan rutin sebelum jatuh tempo · jam 09.00')).toBeVisible();
    await expect.element(screen.getByRole('status')).toHaveTextContent('Tersinkron ke semua perangkat');
    const save = screen.getByRole('button', { name: 'Simpan perubahan' });
    await expect.element(save).toBeDisabled();

    await userEvent.click(screen.getByRole('switch', { name: 'Di aplikasi untuk Saldo rendah' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Email untuk Peringatan anggaran' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Jam pengingat' }), '07:00');
    await expect.element(screen.getByText('Langganan & tagihan rutin sebelum jatuh tempo · jam 07.00')).toBeVisible();
    await expect.element(screen.getByRole('status')).toHaveTextContent('Ada perubahan belum disimpan');

    const expected = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      reminderTime: '07:00',
      groups: {
        ...DEFAULT_NOTIFICATION_SETTINGS.groups,
        balance: { inApp: false, email: false },
        budget: { inApp: true, email: true },
      },
    };
    server.updateNotificationSettings
      .mockResolvedValueOnce({ ok: false, code: 'X' })
      .mockResolvedValueOnce(ok({ settings: expected, movedReminders: 3 }));
    await userEvent.click(save);
    expect(server.updateNotificationSettings).toHaveBeenCalledWith({ data: expected });
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({ tone: 'error', title: expect.any(String) as string });
    });
    await userEvent.click(save);
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith({
        tone: 'success',
        title: 'Pengaturan notifikasi disimpan',
        description: '3 pengingat dipindah ke jam 07.00.',
      });
    });
    await expect.element(save).toBeDisabled();
  });

  it('turning email off disables every email switch; Batal goes back; nothing moved says nothing more', async () => {
    const saved = { ...DEFAULT_NOTIFICATION_SETTINGS, reminderTime: '09:30' };
    server.updateNotificationSettings.mockResolvedValue(
      ok({ settings: { ...saved, email: false }, movedReminders: 0 }),
    );
    const { screen } = await renderApp(<NotificationsSection settings={saved} email="avtara@example.test" />, {
      preferences: { balancesHidden: true },
    });
    // A saved time between the hours is offered too.
    await expect.element(screen.getByRole('combobox', { name: 'Jam pengingat' })).toHaveValue('09:30');
    await expect.element(screen.getByText('Sembunyikan saldo aktif: email dikirim tanpa nominal.')).toBeVisible();
    const optIn = screen.getByRole('switch', { name: 'Kirim juga lewat email ke avtara@example.test' });
    await userEvent.click(optIn);
    await expect.element(screen.getByRole('switch', { name: 'Email untuk Pengingat tagihan' })).toBeDisabled();
    await expect.element(screen.getByRole('switch', { name: 'Email untuk Pengingat tagihan' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
    await expect.element(optIn).toBeChecked();
    await userEvent.click(optIn);
    await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Pengaturan notifikasi disimpan' });
    });
  });

  it('writes the time with a colon in English, and says rejected saves failed', async () => {
    server.updateNotificationSettings.mockRejectedValue(new TypeError('offline'));
    const { screen } = await renderApp(
      <NotificationsSection settings={DEFAULT_NOTIFICATION_SETTINGS} email="a@example.test" />,
      { preferences: { locale: 'en' } },
    );
    await expect
      .element(screen.getByText('Subscriptions & recurring bills before they are due · at 09:00'))
      .toBeVisible();
    await userEvent.click(screen.getByRole('switch', { name: 'In app for System' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({
        tone: 'error',
        title: 'Notification settings could not be saved. Try again.',
      });
    });
  });
});
