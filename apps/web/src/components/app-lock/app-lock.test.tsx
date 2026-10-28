// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { fail, fakeAuthActions, ok, VIEWER } from '../../../test/fake-auth.ts';
import { flushReact, renderApp } from '../../../test/render.tsx';
import { hasAppLockHint } from '../../lib/app-lock-hint.ts';
import type { AuthActions } from '../../lib/auth-client.ts';
import { AuthActionsProvider } from '../auth-actions.tsx';
import { useShortcuts } from '../shortcuts.tsx';
import {
  ACTIVITY_WRITE_MS,
  AppLockProvider,
  IDLE_CHECK_MS,
  MissingAppLockProviderError,
  useAppLock,
} from './app-lock.tsx';
import { countPins, createPin, deletePin, readPin, updatePin } from './pin-store.ts';

const navigation = vi.hoisted(() => ({ hardNavigate: vi.fn() }));
vi.mock('../../lib/navigation.ts', () => navigation);

const PIN = '135790';
const MINUTE = 60_000;
const shortcut = vi.fn();

/** The app behind the lock: an amount, a global shortcut (`N`), and the PIN controls. */
function App() {
  const lock = useAppLock();
  useShortcuts(useMemo(() => [{ keys: ['N'], run: shortcut }], []));
  return (
    <div>
      <p>Saldo Rp12.500.000</p>
      <p>{lock.pin === null ? 'tanpa PIN' : `PIN aktif, ${String(lock.pin.timeoutMinutes)} menit`}</p>
      <button type="button" onClick={() => void lock.enable(PIN)}>
        aktifkan
      </button>
    </div>
  );
}

function renderLock(signOut: AuthActions['signOut'] = () => ok(null)) {
  return renderApp(
    <AuthActionsProvider actions={fakeAuthActions({ signOut })}>
      <AppLockProvider viewer={VIEWER} hinted={hasAppLockHint(document.cookie)}>
        <App />
      </AppLockProvider>
    </AuthActionsProvider>,
  );
}

const hinted = () => document.cookie.includes('wf_app_lock=on');

/** Moves the clock and the idle checks on by `ms`. */
async function idle(ms: number) {
  vi.advanceTimersByTime(ms);
  await flushReact();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: new Date('2026-10-15T09:00:00Z') });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  shortcut.mockClear();
  navigation.hardNavigate.mockClear();
  await deletePin(VIEWER.id);
  document.cookie = 'wf_app_lock=; Path=/; Max-Age=0';
});

describe('AppLockProvider', () => {
  it('is off until a PIN is set, then locks after the idle minutes and opens again with the PIN', async () => {
    const { screen } = await renderLock();
    await expect.element(screen.getByText('tanpa PIN')).toBeVisible();
    await idle(30 * MINUTE);
    await expect.element(screen.getByText('Saldo Rp12.500.000')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'aktifkan' }));
    await expect.element(screen.getByText('PIN aktif, 5 menit')).toBeVisible();
    expect(hinted()).toBe(true);
    await idle(5 * MINUTE - IDLE_CHECK_MS);
    await expect.element(screen.getByText('Saldo Rp12.500.000')).toBeVisible();
    await idle(IDLE_CHECK_MS);

    // Instead of the app, not over it: no amount anywhere, and its shortcuts are gone with it.
    const lock = screen.getByRole('main', { name: 'Aplikasi terkunci · Avtara K.' });
    await expect.element(lock).toBeVisible();
    expect(document.body.textContent).not.toContain('Rp12.500.000');
    await userEvent.keyboard('n');
    await userEvent.keyboard('{Escape}');
    expect(shortcut).not.toHaveBeenCalled();
    await expect.element(lock).toBeVisible();

    await userEvent.keyboard('000000');
    await expect.element(lock.getByRole('alert')).toHaveTextContent('PIN salah · sisa 4 percobaan');
    expect(await readPin(VIEWER.id)).toMatchObject({ failedAttempts: 1 });
    await userEvent.keyboard(PIN);
    await expect.element(screen.getByText('Saldo Rp12.500.000')).toBeVisible();
    await userEvent.keyboard('n');
    expect(shortcut).toHaveBeenCalledOnce();
    // A correct PIN starts the count again.
    expect(await readPin(VIEWER.id)).toMatchObject({ failedAttempts: 0, lastActiveAt: Date.now() });
  });

  it('counts pointer, key, touch, wheel, and focus activity, writing it at most every few seconds', async () => {
    await createPin(VIEWER.id, PIN, 1, Date.now());
    const { screen } = await renderLock();
    await expect.element(screen.getByText('PIN aktif, 1 menit')).toBeVisible();
    const started = Date.now();
    for (const type of ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel', 'focusin']) {
      await idle(50_000);
      window.dispatchEvent(type === 'keydown' ? new KeyboardEvent(type, { key: 'Shift' }) : new Event(type));
    }
    await idle(50_000);
    await expect.element(screen.getByText('Saldo Rp12.500.000')).toBeVisible();
    await expect.poll(async () => (await readPin(VIEWER.id))?.lastActiveAt).toBe(started + 6 * 50_000);
    window.dispatchEvent(new Event('pointermove'));
    await expect.poll(async () => (await readPin(VIEWER.id))?.lastActiveAt).toBe(started + 7 * 50_000);
    // Activity within ACTIVITY_WRITE_MS of the last write still counts, but is not written.
    await idle(ACTIVITY_WRITE_MS - 1_000);
    window.dispatchEvent(new Event('pointermove'));
    await idle(MINUTE - 1_000);
    await expect.element(screen.getByText('Saldo Rp12.500.000')).toBeVisible();
    expect((await readPin(VIEWER.id))?.lastActiveAt).toBe(started + 7 * 50_000);
  });

  it('checks the idle time when the tab becomes visible again', async () => {
    await createPin(VIEWER.id, PIN, 1, Date.now());
    const { screen } = await renderLock();
    await expect.element(screen.getByText('PIN aktif, 1 menit')).toBeVisible();
    // A sleeping tab runs no timers; only the clock moved.
    vi.setSystemTime(Date.now() + 2 * MINUTE);
    document.dispatchEvent(new Event('visibilitychange'));
    await expect.element(screen.getByRole('main', { name: /Aplikasi terkunci/ })).toBeVisible();
  });

  it('starts locked when the app is opened after the idle minutes', async () => {
    await createPin(VIEWER.id, PIN, 15, Date.now() - 15 * MINUTE);
    const { screen } = await renderLock();
    await expect.element(screen.getByText('Terkunci otomatis setelah 15 menit tidak aktif')).toBeVisible();
    expect(document.body.textContent).not.toContain('Rp12.500.000');
    await userEvent.keyboard(PIN);
    await expect.element(screen.getByText('PIN aktif, 15 menit')).toBeVisible();
  });

  it('shows nothing of the app while it looks up a PIN this browser is known to have', async () => {
    document.cookie = 'wf_app_lock=on; Path=/';
    // IndexedDB that never answers.
    vi.spyOn(indexedDB, 'open').mockReturnValueOnce({} as IDBOpenDBRequest);
    await renderLock();
    await expect.element(page.getByText('Saldo Rp12.500.000')).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('opens straight away within the idle minutes, and without IndexedDB', async () => {
    await createPin(VIEWER.id, PIN, 15, Date.now() - 14 * MINUTE);
    const { screen } = await renderLock();
    await expect.element(screen.getByText('PIN aktif, 15 menit')).toBeVisible();
    await screen.unmount();

    document.cookie = 'wf_app_lock=on; Path=/';
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('IndexedDB is disabled', 'InvalidStateError');
    });
    const { screen: again } = await renderLock();
    await expect.element(again.getByText('tanpa PIN')).toBeVisible();
    expect(hinted()).toBe(true);
  });

  it('signs out and forgets the PIN after the fifth wrong PIN, staying locked while the sign-out fails', async () => {
    await createPin(VIEWER.id, PIN, 5, Date.now() - 5 * MINUTE);
    await updatePin(VIEWER.id, () => ({ failedAttempts: 3 }));
    const signOut = vi.fn<AuthActions['signOut']>(() => fail({ code: 'NETWORK_ERROR', status: 0 }));
    const { screen } = await renderLock(signOut);
    const lock = screen.getByRole('main');
    await expect.element(lock).toBeVisible();
    await userEvent.keyboard('111111');
    await expect.element(lock.getByRole('alert')).toHaveTextContent('PIN salah · sisa 1 percobaan');
    await userEvent.keyboard('222222');
    await expect
      .element(
        lock.getByText('Terlalu banyak PIN salah. Masuk lagi dengan kata sandi; PIN dihapus dari perangkat ini.'),
      )
      .toBeVisible();
    expect(lock.getByRole('group', { name: 'Masukkan PIN' }).query()).toBeNull();
    await expect.element(lock.getByText('Ada yang salah. Coba lagi sebentar.')).toBeVisible();
    expect(await readPin(VIEWER.id)).toMatchObject({ failedAttempts: 5 });
    expect(navigation.hardNavigate).not.toHaveBeenCalled();
    await screen.unmount();

    // Reopened: still used up, and the password is the only way in.
    signOut.mockImplementation(() => ok(null));
    const { screen: again } = await renderLock(signOut);
    await userEvent.click(again.getByRole('button', { name: 'Lupa PIN? Masuk dengan kata sandi' }));
    await expect.poll(() => navigation.hardNavigate.mock.calls).toEqual([['/sign-in']]);
    expect(await readPin(VIEWER.id)).toBeNull();
    expect(hinted()).toBe(false);
  });

  it('"Lupa PIN?" signs out to the sign-in page and removes this device\'s PIN', async () => {
    await createPin(VIEWER.id, PIN, 1, Date.now() - MINUTE);
    const signOut = vi.fn(() => ok(null));
    const { screen } = await renderLock(signOut);
    await userEvent.click(screen.getByRole('button', { name: 'Lupa PIN? Masuk dengan kata sandi' }));
    await expect.poll(() => navigation.hardNavigate.mock.calls).toEqual([['/sign-in']]);
    expect(signOut).toHaveBeenCalledOnce();
    expect(await countPins()).toBe(0);
  });

  it('takes a PIN removed meanwhile (another tab used it up) as the last attempt', async () => {
    await createPin(VIEWER.id, PIN, 1, Date.now() - MINUTE);
    const signOut = vi.fn(() => ok(null));
    const { screen } = await renderLock(signOut);
    await expect.element(screen.getByRole('main')).toBeVisible();
    await deletePin(VIEWER.id);
    await userEvent.keyboard(PIN);
    await expect.poll(() => navigation.hardNavigate.mock.calls).toEqual([['/sign-in']]);
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('needs its provider', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(render(<App />)).rejects.toThrow(MissingAppLockProviderError);
  });
});
