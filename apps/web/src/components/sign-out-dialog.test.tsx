// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { fail, fakeAuthActions, ok } from '../../test/fake-auth.ts';
import { renderApp } from '../../test/render.tsx';
import type { AuthActions } from '../lib/auth-client.ts';
import type { DeviceView } from '../server/account.ts';
import { AuthActionsProvider } from './auth-actions.tsx';
import { SignOutDialog } from './sign-out-dialog.tsx';

const server = vi.hoisted(() => ({ listDevices: vi.fn(), revokeOtherDevices: vi.fn() }));
vi.mock('../server/fn/account.ts', () => server);
const navigation = vi.hoisted(() => ({ hardNavigate: vi.fn() }));
vi.mock('../lib/navigation.ts', () => navigation);

const device = (id: string, label: string | null, current = false): DeviceView => ({
  id,
  label,
  current,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  expiresAt: new Date('2026-11-01T00:00:00Z'),
});

function Closable() {
  const [open, setOpen] = useState(true);
  return <SignOutDialog open={open} onOpenChange={setOpen} />;
}

async function renderDialog(signOut: AuthActions['signOut'], devices: unknown) {
  server.listDevices.mockResolvedValue(devices);
  server.revokeOtherDevices.mockResolvedValue({ ok: true, value: { count: 2 } });
  const onOpenChange = vi.fn();
  const result = await renderApp(
    <AuthActionsProvider actions={fakeAuthActions({ signOut })}>
      <SignOutDialog open onOpenChange={onOpenChange} />
    </AuthActionsProvider>,
  );
  const dialog = page.getByRole('alertdialog', { name: 'Keluar dari write.financial?' });
  await expect.element(dialog).toBeVisible();
  return { ...result, dialog, onOpenChange };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('SignOutDialog', () => {
  it('offers to sign the other devices out first, then signs out and reloads at sign-in', async () => {
    const signOut = vi.fn(() => ok(null));
    const { dialog } = await renderDialog(signOut, {
      ok: true,
      value: [device('a', 'Chrome · macOS', true), device('b', 'Safari · iOS'), device('c', null)],
    });
    await expect
      .element(dialog)
      .toHaveAccessibleDescription(
        'Kamu perlu masuk lagi untuk melihat data keuangan. Semua transaksi tetap tersimpan aman di akunmu.',
      );
    await expect
      .element(dialog.getByText('Aktif di 2 perangkat lain · Safari · iOS, Perangkat tidak dikenal'))
      .toBeVisible();
    await userEvent.click(dialog.getByRole('checkbox', { name: /^Keluar dari semua perangkat/ }));
    await userEvent.click(dialog.getByRole('button', { name: 'Keluar', exact: true }));
    await vi.waitFor(() => {
      expect(navigation.hardNavigate).toHaveBeenCalledWith('/sign-in');
    });
    expect(server.revokeOtherDevices).toHaveBeenCalledOnce();
    expect(server.revokeOtherDevices.mock.invocationCallOrder[0]).toBeLessThan(
      signOut.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('has no device option when nothing else is signed in, and explains a failed sign-out', async () => {
    const { dialog } = await renderDialog(() => fail({ code: 'NETWORK', status: 0 }), {
      ok: true,
      value: [device('a', 'Chrome · macOS', true)],
    });
    await userEvent.click(dialog.getByRole('button', { name: 'Keluar', exact: true }));
    await expect.element(dialog.getByRole('alert')).toHaveTextContent('Koneksi terputus. Coba lagi.');
    expect(dialog.getByRole('checkbox').query()).toBeNull();
    expect(server.revokeOtherDevices).not.toHaveBeenCalled();
    expect(navigation.hardNavigate).not.toHaveBeenCalled();
  });

  it('signs out only this device when the device list cannot be loaded, and cancels', async () => {
    const signOut = vi.fn(() => ok(null));
    const { dialog, onOpenChange } = await renderDialog(signOut, { ok: false, code: 'UNAUTHENTICATED' });
    await userEvent.click(dialog.getByRole('button', { name: 'Batal' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(dialog.getByRole('checkbox').query()).toBeNull();
  });

  it('ignores a device list that arrives after closing', async () => {
    const { promise, resolve } = Promise.withResolvers<unknown>();
    server.listDevices.mockReturnValue(promise);
    await renderApp(
      <AuthActionsProvider actions={fakeAuthActions()}>
        <Closable />
      </AuthActionsProvider>,
    );
    await userEvent.click(page.getByRole('button', { name: 'Batal' }));
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument();
    resolve({ ok: true, value: [device('b', 'Safari · iOS')] });
    await promise;
    expect(server.listDevices).toHaveBeenCalled();
  });
});
