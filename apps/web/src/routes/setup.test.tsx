// SPDX-License-Identifier: AGPL-3.0-only
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  isNotFound,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { setLocale } from '@wf/i18n/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { DEFAULT_PREFERENCES } from '../../test/render.tsx';
import { AuthActionsProvider } from '../components/auth-actions.tsx';
import { PreferencesProvider } from '../components/preferences.tsx';
import type { TotpEnrollmentProps } from '../components/totp-enrollment.tsx';
import type { AuthActions } from '../lib/auth-client.ts';
// `vi.mock` calls are hoisted above these imports.
import { createSetupAdmin, getSetup, saveSetup, sendSetupTestEmail } from '../server/fn/setup.ts';
import type { InstanceDraft, SetupState } from '../server/setup.ts';
import { Route } from './setup.tsx';

vi.mock('../server/fn/setup.ts', () => ({
  getSetup: vi.fn(),
  createSetupAdmin: vi.fn(),
  sendSetupTestEmail: vi.fn(),
  saveSetup: vi.fn(),
}));

// Enrollment has its own tests; here it only finishes.
vi.mock('../components/totp-enrollment.tsx', () => ({
  TotpEnrollment: ({ onDone }: TotpEnrollmentProps) => (
    <button type="button" onClick={onDone}>
      {'totp'}
    </button>
  ),
}));

const DRAFT: InstanceDraft = {
  instanceName: 'write.financial',
  publicUrl: 'https://uang.example.com',
  defaultLocale: 'id',
  defaultTimezone: 'Asia/Jakarta',
  registrationMode: 'closed',
  smtp: null,
};

const open = (step: Extract<SetupState, { status: 'open' }>['step']): SetupState => ({
  status: 'open',
  step,
  draft: DRAFT,
});

beforeEach(() => {
  vi.mocked(getSetup).mockResolvedValue(open('admin'));
  vi.mocked(createSetupAdmin).mockResolvedValue({ ok: true, value: null });
  vi.mocked(sendSetupTestEmail).mockResolvedValue({ ok: true, value: null });
  vi.mocked(saveSetup).mockResolvedValue({ ok: true, value: null });
});

async function renderSetup(path: string) {
  await setLocale('id', { reload: false });
  const root = createRootRoute({
    component: () => (
      <PreferencesProvider initial={DEFAULT_PREFERENCES}>
        <AuthActionsProvider
          actions={
            { signInEmail: () => Promise.resolve({ ok: true, value: { twoFactor: false } }) } as unknown as AuthActions
          }
        >
          <Outlet />
        </AuthActionsProvider>
      </PreferencesProvider>
    ),
  });
  const setup = Route.update({ id: '/setup', path: '/setup', getParentRoute: () => root } as never);
  const router = createRouter({
    routeTree: root.addChildren([setup]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  const screen = await render(<RouterProvider router={router} />);
  return { screen, router };
}

describe('/setup route', () => {
  it('keeps only a string token from the URL', () => {
    const validate = Route.options.validateSearch as (search: Record<string, unknown>) => unknown;
    expect(validate({ token: 'abc', other: 1 })).toEqual({ token: 'abc' });
    expect(validate({ token: 42 })).toEqual({});
  });

  it('answers 404 when the wizard is closed', async () => {
    vi.mocked(getSetup).mockResolvedValue({ status: 'closed' });
    const loader = Route.options.loader as (options: { deps: { token?: string } }) => Promise<unknown>;
    const error: unknown = await loader({ deps: { token: 'wrong' } }).catch((thrown: unknown) => thrown);
    expect(isNotFound(error)).toBe(true);
    expect(getSetup).toHaveBeenCalledWith({ data: { token: 'wrong' } });
  });

  it('takes the token out of the address bar once the server stored it', async () => {
    const { screen, router } = await renderSetup('/setup?token=abc');
    await expect.element(screen.getByRole('heading', { name: 'Buat akun admin' })).toBeVisible();
    await vi.waitFor(() => {
      expect(router.state.location.href).toBe('/setup');
    });
    expect(getSetup).toHaveBeenNthCalledWith(1, { data: { token: 'abc' } });
    expect(getSetup).toHaveBeenLastCalledWith({ data: {} });
  });

  it('creates the admin and reloads the state for the next step', async () => {
    const { screen } = await renderSetup('/setup');
    vi.mocked(getSetup).mockResolvedValue(open('two-factor'));
    await userEvent.fill(screen.getByLabelText('Nama'), 'Ayu');
    await userEvent.fill(screen.getByLabelText('Email'), 'ayu@example.com');
    await userEvent.fill(
      screen.getByLabelText('Kata sandi', { exact: true }),
      ['correct', 'horse', 'battery'].join('-'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Buat admin' }));
    await expect.element(screen.getByRole('heading', { name: 'Verifikasi dua langkah' })).toBeVisible();
    expect(createSetupAdmin).toHaveBeenCalledWith({
      data: { name: 'Ayu', email: 'ayu@example.com', password: 'correct-horse-battery', locale: 'id' },
    });
  });

  it('tests email and saves the instance through the setup server functions', async () => {
    vi.mocked(getSetup).mockResolvedValue(open('instance'));
    const { screen } = await renderSetup('/setup');
    await userEvent.click(screen.getByRole('checkbox', { name: /Kirim email lewat SMTP/ }));
    await userEvent.fill(screen.getByLabelText('Host SMTP'), 'smtp.example.com');
    await userEvent.fill(screen.getByLabelText('Alamat pengirim'), 'noreply@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Kirim email uji' }));
    expect(sendSetupTestEmail).toHaveBeenCalledWith({
      data: {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        username: null,
        password: null,
        from: 'noreply@example.com',
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Simpan dan selesai' }));
    await expect.element(screen.getByRole('heading', { name: 'Penyiapan selesai' })).toBeVisible();
    expect(vi.mocked(saveSetup).mock.calls[0]?.[0]).toMatchObject({ data: { instanceName: 'write.financial' } });
  });
});
