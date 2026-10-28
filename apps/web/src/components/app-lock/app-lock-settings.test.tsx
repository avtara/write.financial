// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { VIEWER } from '../../../test/fake-auth.ts';
import { renderApp } from '../../../test/render.tsx';
import { AppLockProvider } from './app-lock.tsx';
import { AppLockSettings } from './app-lock-settings.tsx';
import { createPin, deletePin, matchesPin, readPin } from './pin-store.ts';

afterEach(async () => {
  vi.restoreAllMocks();
  await deletePin(VIEWER.id);
  document.cookie = 'wf_app_lock=; Path=/; Max-Age=0';
});

function renderSettings() {
  return renderApp(
    <AppLockProvider viewer={VIEWER} hinted={false}>
      <AppLockSettings />
    </AppLockProvider>,
  );
}

const lockSwitch = () => page.getByRole('switch', { name: 'Kunci aplikasi' });

describe('AppLockSettings', () => {
  it('turns the lock on with a PIN entered twice, starting over when they differ', async () => {
    await renderSettings();
    await expect.element(page.getByText('Minta PIN saat membuka write.financial')).toBeVisible();
    await expect.element(lockSwitch()).not.toBeChecked();
    expect(page.getByLabelText('Kunci otomatis').query()).toBeNull();

    await userEvent.click(lockSwitch());
    const dialog = page.getByRole('dialog', { name: 'Buat PIN' });
    await expect
      .element(dialog.getByText('6 digit, hanya tersimpan di perangkat ini dan tidak dikirim ke server.'))
      .toBeVisible();
    await expect.element(dialog.getByRole('group', { name: 'Masukkan PIN baru' })).toBeVisible();
    await userEvent.keyboard('111111');
    await expect.element(dialog.getByRole('group', { name: 'Ulangi PIN baru' })).toBeVisible();
    await userEvent.keyboard('222222');
    await expect.element(dialog.getByRole('alert')).toHaveTextContent('PIN tidak sama. Buat lagi.');
    await expect.element(dialog.getByRole('group', { name: 'Masukkan PIN baru' })).toBeVisible();
    await userEvent.keyboard('246810');
    await userEvent.keyboard('246810');
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(lockSwitch()).toBeChecked();
    const record = await readPin(VIEWER.id);
    expect(record).toMatchObject({ timeoutMinutes: 5, failedAttempts: 0 });
    if (record === null) throw new Error('no PIN saved');
    expect(await matchesPin(record, '246810')).toBe(true);
    expect(document.cookie).toContain('wf_app_lock=on');
  });

  it('picks the idle minutes, changes the PIN after the current one, and turns the lock off with it', async () => {
    await createPin(VIEWER.id, '123456', 5, Date.now());
    await renderSettings();
    const timeout = page.getByLabelText('Kunci otomatis');
    await expect.element(timeout).toHaveDisplayValue('Setelah 5 menit');
    expect([...timeout.element().querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'Setelah 1 menit',
      'Setelah 5 menit',
      'Setelah 15 menit',
      'Setelah 30 menit',
    ]);
    await userEvent.selectOptions(timeout, 'Setelah 15 menit');
    await expect.element(timeout).toHaveDisplayValue('Setelah 15 menit');
    expect(await readPin(VIEWER.id)).toMatchObject({ timeoutMinutes: 15 });

    await expect.element(page.getByText('6 digit · hanya di perangkat ini')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Ganti PIN' }));
    const change = page.getByRole('dialog', { name: 'Ganti PIN' });
    await expect.element(change.getByRole('group', { name: 'Masukkan PIN saat ini' })).toBeVisible();
    await userEvent.keyboard('654321');
    await expect.element(change.getByRole('alert')).toHaveTextContent('PIN salah · sisa 4 percobaan');
    await userEvent.keyboard('123456');
    await expect.element(change.getByRole('group', { name: 'Masukkan PIN baru' })).toBeVisible();
    await userEvent.keyboard('777777');
    await userEvent.keyboard('777777');
    await expect.element(change).not.toBeInTheDocument();
    const changed = await readPin(VIEWER.id);
    expect(changed).toMatchObject({ timeoutMinutes: 15, failedAttempts: 0 });
    if (changed === null) throw new Error('no PIN saved');
    expect(await matchesPin(changed, '777777')).toBe(true);

    await userEvent.click(lockSwitch());
    const off = page.getByRole('dialog', { name: 'Matikan kunci aplikasi' });
    await expect.element(off.getByRole('group', { name: 'Masukkan PIN saat ini' })).toBeVisible();
    await userEvent.keyboard('777777');
    await expect.element(off).not.toBeInTheDocument();
    await expect.element(lockSwitch()).not.toBeChecked();
    expect(await readPin(VIEWER.id)).toBeNull();
    expect(document.cookie).not.toContain('wf_app_lock=on');
  });

  it('closes with Escape, and says so when the PIN cannot be saved on this device', async () => {
    await renderSettings();
    await userEvent.click(lockSwitch());
    const dialog = page.getByRole('dialog', { name: 'Buat PIN' });
    await expect.element(dialog).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(lockSwitch()).not.toBeChecked();

    await userEvent.click(lockSwitch());
    await userEvent.keyboard('135135');
    await expect.element(dialog.getByRole('group', { name: 'Ulangi PIN baru' })).toBeVisible();
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('IndexedDB is disabled', 'InvalidStateError');
    });
    await userEvent.keyboard('135135');
    await expect
      .element(dialog.getByRole('alert'))
      .toHaveTextContent('PIN tidak bisa disimpan di perangkat ini. Coba lagi.');
    await userEvent.keyboard('{Escape}');
    await expect.element(lockSwitch()).not.toBeChecked();
  });
});
