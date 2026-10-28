// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { VIEWER } from '../../../test/fake-auth.ts';
import { renderApp } from '../../../test/render.tsx';
import { LockScreen, type LockScreenProps } from './lock-screen.tsx';
import type { PinCheck } from './pin-store.ts';

function renderLock(props: Partial<LockScreenProps> = {}) {
  return renderApp(
    <LockScreen
      viewer={VIEWER}
      timeoutMinutes={5}
      exhausted={false}
      error={null}
      onUnlock={() => Promise.resolve({ ok: true })}
      onForgot={() => undefined}
      {...props}
    />,
  );
}

describe('LockScreen', () => {
  it('shows who is locked out and why, and says how many attempts a wrong PIN leaves', async () => {
    const answers: PinCheck[] = [{ ok: false, remaining: 4 }, { ok: false, remaining: 3 }, { ok: true }];
    const onUnlock = vi.fn(() => Promise.resolve(answers.shift() ?? ({ ok: true } as const)));
    const { screen } = await renderLock({ onUnlock });
    const main = screen.getByRole('main', { name: 'Aplikasi terkunci · Avtara K.' });
    await expect.element(main).toHaveFocus();
    await expect.element(main.getByText('AK', { exact: true })).toBeVisible();
    await expect.element(main.getByText('Terkunci otomatis setelah 5 menit tidak aktif')).toBeVisible();
    await expect.element(main.getByRole('button', { name: 'Lupa PIN? Masuk dengan kata sandi' })).toBeVisible();

    await userEvent.keyboard('111111');
    await expect.element(main.getByRole('alert')).toHaveTextContent('PIN salah · sisa 4 percobaan');
    await userEvent.keyboard('222222');
    await expect.element(main.getByRole('alert')).toHaveTextContent('PIN salah · sisa 3 percobaan');
    await userEvent.keyboard('123456');
    await expect.element(main.getByRole('alert')).toHaveTextContent('');
    expect(onUnlock.mock.calls).toEqual([['111111'], ['222222'], ['123456']]);
  });

  it('keeps the keypad disabled while a PIN is being checked', async () => {
    const check = Promise.withResolvers<PinCheck>();
    const { screen } = await renderLock({ onUnlock: () => check.promise });
    await userEvent.keyboard('123456');
    await expect.element(screen.getByRole('button', { name: '1', exact: true })).toBeDisabled();
    check.resolve({ ok: false, remaining: 1 });
    await expect.element(screen.getByRole('button', { name: '1', exact: true })).toBeEnabled();
    await expect.element(screen.getByRole('alert')).toHaveTextContent('PIN salah · sisa 1 percobaan');
  });

  it('keeps focus on the screen and cannot be dismissed', async () => {
    const { screen } = await renderLock();
    const main = screen.getByRole('main');
    const first = screen.getByRole('button', { name: '1', exact: true });
    const forgot = screen.getByRole('button', { name: 'Lupa PIN? Masuk dengan kata sandi' });
    await expect.element(main).toHaveFocus();
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await expect.element(forgot).toHaveFocus();
    await userEvent.keyboard('{Tab}');
    await expect.element(first).toHaveFocus();
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await expect.element(forgot).toHaveFocus();
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await expect.element(screen.getByRole('button', { name: 'Hapus digit' })).toHaveFocus();
    await userEvent.keyboard('{Tab}');
    await expect.element(forgot).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await expect.element(main).toBeVisible();
  });

  it('after the last attempt offers only the password, with the sign-out error if there is one', async () => {
    const onForgot = vi.fn();
    const { screen } = await renderLock({ exhausted: true, error: 'Tidak ada koneksi', onForgot });
    await expect
      .element(
        screen.getByText('Terlalu banyak PIN salah. Masuk lagi dengan kata sandi; PIN dihapus dari perangkat ini.'),
      )
      .toBeVisible();
    expect(screen.getByRole('group', { name: 'Masukkan PIN' }).query()).toBeNull();
    await expect.element(screen.getByText('Tidak ada koneksi')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Lupa PIN? Masuk dengan kata sandi' }));
    expect(onForgot).toHaveBeenCalledOnce();
  });
});
