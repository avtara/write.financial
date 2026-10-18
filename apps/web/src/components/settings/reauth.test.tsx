// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { fail, fakeAuthActions, ok, VIEWER } from '../../../test/fake-auth.ts';
import { renderApp } from '../../../test/render.tsx';
import type { AuthResult } from '../../lib/auth-client.ts';
import { AuthActionsProvider } from '../auth-actions.tsx';
import { retryAfterReauth, useReauthentication } from './reauth.tsx';

const server = vi.hoisted(() => ({ revokeDevice: vi.fn(() => Promise.resolve({ ok: true, value: null })) }));
vi.mock('../../server/fn/account.ts', () => server);

describe('retryAfterReauth', () => {
  const stale = (): Promise<AuthResult<string>> => fail({ code: 'REAUTHENTICATION_REQUIRED', status: 403 });

  it('returns results that need no new sign-in as they are', async () => {
    const reauthenticate = vi.fn(() => Promise.resolve(true));
    expect(await retryAfterReauth(() => ok('done'), reauthenticate)).toEqual({ ok: true, value: 'done' });
    expect(await retryAfterReauth(() => fail({ code: 'INVALID_PASSWORD' }), reauthenticate)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PASSWORD' },
    });
    expect(reauthenticate).not.toHaveBeenCalled();
  });

  it('runs the action again after signing in again, or gives up when that was cancelled', async () => {
    const action = vi
      .fn<() => Promise<AuthResult<string>>>()
      .mockImplementationOnce(stale)
      .mockReturnValueOnce(ok('done'));
    expect(await retryAfterReauth(action, () => Promise.resolve(true))).toEqual({ ok: true, value: 'done' });
    expect(await retryAfterReauth(stale, () => Promise.resolve(false))).toMatchObject({
      error: { code: 'REAUTHENTICATION_REQUIRED' },
    });
  });
});

function Harness() {
  const { reauthenticate, dialog } = useReauthentication(VIEWER);
  const [outcome, setOutcome] = useState('none');
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void reauthenticate().then((done) => {
            setOutcome(String(done));
          });
        }}
      >
        ask
      </button>
      <output>{outcome}</output>
      {dialog}
    </>
  );
}

describe('useReauthentication', () => {
  it('resolves true once signed in again and false when the dialog is closed', async () => {
    const { screen } = await renderApp(
      <AuthActionsProvider actions={fakeAuthActions({ signInEmail: () => ok({ twoFactor: false }) })}>
        <Harness />
      </AuthActionsProvider>,
    );
    const dialog = page.getByRole('dialog', { name: 'Masuk lagi untuk melanjutkan' });

    await userEvent.click(screen.getByRole('button', { name: 'ask' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Batal' }));
    await expect.element(screen.getByRole('status')).toHaveTextContent('false');

    await userEvent.click(screen.getByRole('button', { name: 'ask' }));
    await userEvent.fill(dialog.getByLabelText('Kata sandi'), 'right');
    await userEvent.click(dialog.getByRole('button', { name: 'Lanjut' }));
    await expect.element(screen.getByRole('status')).toHaveTextContent('true');
    await expect.element(dialog).not.toBeInTheDocument();
    expect(server.revokeDevice).toHaveBeenCalledWith({ data: { id: VIEWER.sessionId } });
  });
});
