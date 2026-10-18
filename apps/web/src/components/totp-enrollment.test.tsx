// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { fail, fakeAuthActions, ok } from '../../test/fake-auth.ts';
import { renderApp } from '../../test/render.tsx';
import type { AuthActions, AuthResult } from '../lib/auth-client.ts';
import { AuthActionsProvider } from './auth-actions.tsx';
import { TotpEnrollment, qrRuns, type TotpEnrollmentProps } from './totp-enrollment.tsx';

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DP';
const URI = `otpauth://totp/write.financial:avtara%40example.test?secret=${SECRET}&issuer=write.financial`;
const CODES = Array.from({ length: 10 }, (_, index) => `code-${String(index).padStart(2, '0')}`);

async function renderEnrollment(actions: Partial<AuthActions>, props: Partial<TotpEnrollmentProps> = {}) {
  const onDone = vi.fn();
  const fakes = fakeAuthActions(actions);
  const result = await renderApp(
    <AuthActionsProvider actions={fakes}>
      <TotpEnrollment needsPassword={false} onDone={onDone} {...props} />
    </AuthActionsProvider>,
  );
  return { ...result, onDone, actions: fakes };
}

async function typeCode(code: string) {
  await userEvent.click(page.getByRole('textbox', { name: 'Digit 1 dari 6' }));
  await userEvent.keyboard(code);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('qrRuns', () => {
  it('draws the symbol inside a 4-module quiet zone, one rectangle per run of dark modules', () => {
    const { size, runs } = qrRuns(URI);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.x).toBeGreaterThanOrEqual(4);
      expect(run.y).toBeGreaterThanOrEqual(4);
      expect(run.x + run.width).toBeLessThanOrEqual(size - 4);
    }
    // The top-left finder pattern starts with a 7-module dark row.
    expect(runs[0]).toEqual({ x: 4, y: 4, width: 7 });
  });
});

describe('TotpEnrollment', () => {
  it('asks for the password, shows the QR code and key, verifies the first code, and shows the backup codes', async () => {
    const enableTwoFactor = vi
      .fn<AuthActions['enableTwoFactor']>()
      .mockReturnValueOnce(fail({ code: 'INVALID_PASSWORD', remainingAttempts: 4 }))
      .mockReturnValueOnce(ok({ totpURI: URI, backupCodes: CODES }));
    const verifyTotp = vi
      .fn<AuthActions['verifyTotp']>()
      .mockReturnValueOnce(fail({ code: 'INVALID_CODE' }))
      .mockReturnValueOnce(ok(null));
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const { screen, onDone } = await renderEnrollment({ enableTwoFactor, verifyTotp }, { needsPassword: true });

    await expect.element(screen.getByRole('heading', { name: 'Aktifkan aplikasi autentikator' })).toBeVisible();
    const next = screen.getByRole('button', { name: 'Lanjut' });
    await expect.element(next).toBeDisabled();
    await userEvent.fill(screen.getByLabelText('Kata sandi'), 'wrong password');
    await userEvent.click(next);
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Kata sandi salah · sisa 4 percobaan sebelum dikunci 15 menit');
    expect(enableTwoFactor).toHaveBeenLastCalledWith('wrong password');

    await userEvent.fill(screen.getByLabelText('Kata sandi'), 'right password');
    await userEvent.click(next);
    const qr = screen.getByRole('img', { name: 'Kode QR untuk aplikasi autentikator' });
    await expect.element(qr).toBeVisible();
    expect(qr.element().querySelectorAll('rect').length).toBeGreaterThan(10);
    expect(qr.element().outerHTML).not.toMatch(/style=|data:/);
    await expect.element(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP')).toBeVisible();
    await expect.element(screen.getByText('Langkah 1 dari 2 · pindai lalu masukkan kode')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Salin kunci' }));
    expect(writeText).toHaveBeenCalledWith(SECRET);
    await expect.element(screen.getByRole('button', { name: 'Tersalin' })).toBeVisible();

    const verify = screen.getByRole('button', { name: 'Verifikasi' });
    await expect.element(verify).toBeDisabled();
    await typeCode('111111');
    await userEvent.click(verify);
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Kode salah');
    await userEvent.click(verify);
    expect(verifyTotp).toHaveBeenLastCalledWith({ code: '111111', trustDevice: false });

    await expect.element(screen.getByText('Langkah 2 dari 2 · simpan kode cadangan')).toBeVisible();
    const list = screen.getByRole('list', { name: 'Kode cadangan' });
    await expect.element(list).toHaveTextContent(CODES.join(''));

    const done = screen.getByRole('button', { name: 'Selesai' });
    await expect.element(done).toBeDisabled();
    await userEvent.click(screen.getByLabelText('Saya sudah menyimpan kode cadangan'));
    await userEvent.click(done);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('starts on its own with a password the caller already has, and asks for it when it was wrong', async () => {
    const enableTwoFactor = vi.fn<AuthActions['enableTwoFactor']>(() => fail({ code: 'INVALID_PASSWORD' }));
    const onCancel = vi.fn();
    const { screen } = await renderEnrollment(
      { enableTwoFactor },
      { needsPassword: true, initialPassword: 'from the wizard', onCancel },
    );
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Kata sandi salah');
    expect(enableTwoFactor).toHaveBeenCalledExactlyOnceWith('from the wizard');
    await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('starts without a password for Google-only accounts, and offers a retry when that fails', async () => {
    const first = Promise.withResolvers<AuthResult<{ totpURI: string; backupCodes: string[] }>>();
    const enableTwoFactor = vi
      .fn<AuthActions['enableTwoFactor']>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(ok({ totpURI: 'otpauth://totp/x?issuer=write.financial', backupCodes: CODES }));
    const onCancel = vi.fn();
    const { screen } = await renderEnrollment({ enableTwoFactor }, { onCancel });
    await expect.element(screen.getByRole('status')).toHaveTextContent('Menyiapkan kode QR…');
    first.resolve({ ok: false, error: { status: 0, code: 'NETWORK' } });
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Koneksi terputus. Coba lagi.');
    await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(enableTwoFactor).toHaveBeenLastCalledWith(null);
    await expect.element(screen.getByRole('img', { name: 'Kode QR untuk aplikasi autentikator' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('signs in again when the session is too old, then starts over', async () => {
    const enableTwoFactor = vi
      .fn<AuthActions['enableTwoFactor']>()
      .mockReturnValueOnce(fail({ code: 'REAUTHENTICATION_REQUIRED', status: 403 }))
      .mockReturnValueOnce(ok({ totpURI: URI, backupCodes: CODES }));
    const reauthenticate = vi.fn(() => Promise.resolve(true));
    const { screen } = await renderEnrollment({ enableTwoFactor }, { reauthenticate });
    await expect.element(screen.getByRole('img', { name: 'Kode QR untuk aplikasi autentikator' })).toBeVisible();
    expect(reauthenticate).toHaveBeenCalledOnce();
    expect(enableTwoFactor).toHaveBeenCalledTimes(2);
  });

  it('explains the failure when signing in again was cancelled or is not offered', async () => {
    const enableTwoFactor = vi.fn<AuthActions['enableTwoFactor']>(() =>
      fail({ code: 'REAUTHENTICATION_REQUIRED', status: 403 }),
    );
    const reauthenticate = vi.fn(() => Promise.resolve(false));
    const { screen } = await renderEnrollment({ enableTwoFactor }, { reauthenticate });
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Demi keamanan, masuk lagi untuk melanjutkan.');
    expect(enableTwoFactor).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Batal' }).query()).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(reauthenticate).toHaveBeenCalledTimes(2);
  });

  it('works without the reauthentication hook', async () => {
    const { screen } = await renderEnrollment({
      enableTwoFactor: () => fail({ code: 'REAUTHENTICATION_REQUIRED', status: 403 }),
    });
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Demi keamanan, masuk lagi untuk melanjutkan.');
  });
});
