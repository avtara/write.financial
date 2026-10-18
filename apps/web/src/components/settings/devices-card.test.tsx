// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import type { DeviceView } from '../../server/account.ts';
import { DevicesCard } from './devices-card.tsx';

const server = vi.hoisted(() => ({ revokeDevice: vi.fn(), revokeOtherDevices: vi.fn() }));
vi.mock('../../server/fn/account.ts', () => server);

const device = (id: string, label: string | null, current = false): DeviceView => ({
  id,
  label,
  current,
  createdAt: new Date('2026-10-15T03:05:00Z'),
  expiresAt: new Date('2026-11-15T03:05:00Z'),
});

const DEVICES = [device('a', 'Chrome · macOS', true), device('b', 'Safari · iOS'), device('c', null)];

async function renderCard(devices: readonly DeviceView[]) {
  const result = await renderApp(<DevicesCard devices={devices} timeZone="Asia/Jakarta" />);
  const invalidate = vi.spyOn(result.router, 'invalidate');
  return { ...result, invalidate, group: result.screen.getByRole('region', { name: 'Perangkat aktif' }) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DevicesCard', () => {
  it('lists the devices with this one marked, and signs one out after confirming', async () => {
    server.revokeDevice
      .mockResolvedValueOnce({ ok: false, code: 'DEVICE_NOT_FOUND' })
      .mockResolvedValueOnce({ ok: true, value: null });
    const { group, invalidate } = await renderCard(DEVICES);
    await expect.element(group.getByText('Chrome · macOS')).toBeVisible();
    await expect.element(group.getByText('Perangkat ini')).toBeVisible();
    await expect.element(group.getByText('Masuk 15 Okt 2026, 10.05 WIB').first()).toBeVisible();
    await expect.element(group.getByText('Perangkat tidak dikenal')).toBeVisible();

    await userEvent.click(group.getByRole('button', { name: 'Keluarkan Safari · iOS' }));
    const confirm = page.getByRole('alertdialog', { name: 'Keluarkan Safari · iOS?' });
    await expect
      .element(confirm)
      .toHaveAccessibleDescription('Perangkat itu perlu masuk lagi untuk membuka write.financial.');
    await userEvent.click(confirm.getByRole('button', { name: 'Keluarkan' }));
    await expect.element(group.getByRole('alert')).toHaveTextContent('Ada yang salah. Coba lagi sebentar.');
    expect(invalidate).not.toHaveBeenCalled();

    await userEvent.click(group.getByRole('button', { name: 'Keluarkan Perangkat tidak dikenal' }));
    await userEvent.click(page.getByRole('button', { name: 'Keluarkan', exact: true }));
    await expect.element(group.getByRole('status')).toHaveTextContent('Perangkat tidak dikenal sudah dikeluarkan.');
    expect(server.revokeDevice).toHaveBeenLastCalledWith({ data: { id: 'c' } });
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('signs every other device out after confirming, or not when cancelled', async () => {
    server.revokeOtherDevices
      .mockResolvedValueOnce({ ok: false, code: 'UNAUTHENTICATED' })
      .mockResolvedValueOnce({ ok: true, value: { count: 2 } });
    const { group } = await renderCard(DEVICES);
    const all = group.getByRole('button', { name: 'Keluar dari semua perangkat lain' });
    await userEvent.click(all);
    const confirm = page.getByRole('alertdialog', { name: 'Keluar dari semua perangkat lain?' });
    await expect
      .element(confirm)
      .toHaveAccessibleDescription(
        'Perangkat ini tetap masuk. Perangkat lain perlu masuk lagi. 2 perangkat: Safari · iOS, Perangkat tidak dikenal',
      );
    await userEvent.click(confirm.getByRole('button', { name: 'Batal' }));
    expect(server.revokeOtherDevices).not.toHaveBeenCalled();
    await userEvent.click(all);
    await userEvent.click(page.getByRole('button', { name: 'Keluarkan semua' }));
    await expect.element(group.getByRole('alert')).toHaveTextContent('Sesimu sudah berakhir. Masuk lagi.');
    await userEvent.click(all);
    await userEvent.click(page.getByRole('button', { name: 'Keluarkan semua' }));
    await expect.element(group.getByRole('status')).toHaveTextContent('2 perangkat lain sudah dikeluarkan.');
  });

  it('has no "all other devices" action when this is the only one', async () => {
    const { group } = await renderCard([device('a', 'Chrome · macOS', true)]);
    await expect.element(group.getByText('Perangkat ini')).toBeVisible();
    expect(group.getByRole('button').query()).toBeNull();
  });
});
