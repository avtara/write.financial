// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import type { AuthActions } from '../../lib/auth-client.ts';
import type { Result } from '../../server/access.ts';
import type { InstanceDraft, SetupStep } from '../../server/setup.ts';
import { AuthActionsProvider } from '../auth-actions.tsx';
import type { TotpEnrollmentProps } from '../totp-enrollment.tsx';
import { SetupWizard } from './setup-wizard.tsx';

// Enrollment has its own tests; here it only shows what it was given.
vi.mock('../totp-enrollment.tsx', () => ({
  TotpEnrollment: ({ needsPassword, initialPassword, onDone }: TotpEnrollmentProps) => (
    <button type="button" onClick={onDone}>
      {`totp needsPassword=${String(needsPassword)} password=${initialPassword ?? 'none'}`}
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

const PASSWORD = ['correct', 'horse', 'battery'].join('-');
const NEXT: Readonly<Record<SetupStep, SetupStep>> = {
  admin: 'two-factor',
  'sign-in': 'two-factor',
  'two-factor': 'instance',
  instance: 'instance',
};

async function setup(initial: SetupStep, { saved = { ok: true, value: null } }: { saved?: Result<null> } = {}) {
  const onRefresh = vi.fn();
  const save = vi.fn(() => Promise.resolve(saved));
  const sendTestEmail = vi.fn(() => Promise.resolve<Result<null>>({ ok: true, value: null }));
  const createAdmin = vi.fn(() => Promise.resolve<Result<null>>({ ok: true, value: null }));
  const actions = {
    signInEmail: () => Promise.resolve({ ok: true, value: { twoFactor: false } }),
  } as unknown as AuthActions;
  function Harness() {
    const [step, setStep] = useState(initial);
    return (
      <SetupWizard
        step={step}
        draft={DRAFT}
        onRefresh={() => {
          onRefresh();
          setStep(NEXT[step]);
          return Promise.resolve();
        }}
        createAdmin={createAdmin}
        sendTestEmail={sendTestEmail}
        save={save}
      />
    );
  }
  const { screen } = await renderApp(
    <AuthActionsProvider actions={actions}>
      <Harness />
    </AuthActionsProvider>,
  );
  return { screen, onRefresh, save, createAdmin };
}

describe('SetupWizard', () => {
  it('goes from the admin to enrollment with the password still in memory, then to the instance', async () => {
    const { screen, onRefresh, createAdmin } = await setup('admin');
    await expect.element(screen.getByRole('heading', { name: 'Buat akun admin' })).toBeVisible();
    await expect.element(screen.getByText('Langkah 1 dari 4')).toBeVisible();
    await userEvent.fill(screen.getByLabelText('Nama'), 'Ayu');
    await userEvent.fill(screen.getByLabelText('Email'), 'ayu@example.com');
    await userEvent.fill(screen.getByLabelText('Kata sandi', { exact: true }), PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: 'Buat admin' }));
    expect(createAdmin).toHaveBeenCalledOnce();
    await expect.element(screen.getByRole('heading', { name: 'Verifikasi dua langkah' })).toBeVisible();
    await expect.element(screen.getByText('Langkah 2 dari 4')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: `totp needsPassword=true password=${PASSWORD}` }));
    await expect.element(screen.getByRole('heading', { name: 'Atur instans' })).toBeVisible();
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it('asks a signed-out operator to sign in and come back', async () => {
    const { screen } = await setup('sign-in');
    await expect.element(screen.getByRole('heading', { name: 'Masuk sebagai admin' })).toBeVisible();
    await expect.element(screen.getByText('Langkah 1 dari 4')).toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Masuk' }))
      .toHaveAttribute('href', '/sign-in?redirect=/setup');
  });

  it('asks enrollment for the password when it is no longer in memory', async () => {
    const { screen } = await setup('two-factor');
    await expect.element(screen.getByRole('button', { name: 'totp needsPassword=true password=none' })).toBeVisible();
  });

  it('finishes with the KEK reminder once the instance is saved', async () => {
    const { screen, save, onRefresh } = await setup('instance');
    await expect.element(screen.getByText('Langkah 3 dari 4')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Simpan dan selesai' }));
    expect(save).toHaveBeenCalledOnce();
    await expect.element(screen.getByRole('heading', { name: 'Penyiapan selesai' })).toBeVisible();
    await expect.element(screen.getByText('Langkah 4 dari 4')).toBeVisible();
    await expect.element(screen.getByRole('heading', { name: 'Cadangkan kunci enkripsi' })).toBeVisible();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('stays on the instance step when saving fails', async () => {
    const { screen } = await setup('instance', { saved: { ok: false, code: 'FORBIDDEN' } });
    await userEvent.click(screen.getByRole('button', { name: 'Simpan dan selesai' }));
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Kamu tidak punya akses untuk ini.');
    await expect.element(screen.getByRole('heading', { name: 'Atur instans' })).toBeVisible();
  });
});
