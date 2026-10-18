// SPDX-License-Identifier: AGPL-3.0-only
/** Fakes for component tests of the auth flows: Better Auth actions, a viewer, and the gate. */
import { vi } from 'vitest';
import type { AuthActions, AuthFailure, AuthResult } from '../src/lib/auth-client.ts';
import type { Gate, Viewer } from '../src/server/gate.ts';

/** Every action rejects unless the test passes its own (so an unexpected call fails loudly). */
export function fakeAuthActions(overrides: Partial<AuthActions> = {}): AuthActions {
  const unexpected = (name: string) =>
    vi.fn(() => Promise.reject(new Error(`unexpected auth action: ${name}`))) as never;
  return {
    signInEmail: unexpected('signInEmail'),
    signInGoogle: unexpected('signInGoogle'),
    signInPasskey: unexpected('signInPasskey'),
    signUpEmail: unexpected('signUpEmail'),
    requestPasswordReset: unexpected('requestPasswordReset'),
    resetPassword: unexpected('resetPassword'),
    verifyTotp: unexpected('verifyTotp'),
    verifyBackupCode: unexpected('verifyBackupCode'),
    signOut: unexpected('signOut'),
    enableTwoFactor: unexpected('enableTwoFactor'),
    disableTwoFactor: unexpected('disableTwoFactor'),
    generateBackupCodes: unexpected('generateBackupCodes'),
    addPasskey: unexpected('addPasskey'),
    deletePasskey: unexpected('deletePasskey'),
    changePassword: unexpected('changePassword'),
    ...overrides,
  };
}

export const ok = <T>(value: T): Promise<AuthResult<T>> => Promise.resolve({ ok: true, value });

export const fail = (error: Partial<AuthFailure> & { code: string }): Promise<AuthResult<never>> =>
  Promise.resolve({ ok: false, error: { status: 400, ...error } });

export const VIEWER: Viewer = {
  id: '0192a6c4-0000-7000-8000-000000000001',
  sessionId: '0192a6c4-0000-7000-8000-0000000000aa',
  name: 'Avtara K.',
  email: 'avtara@example.test',
  image: null,
  locale: 'id',
  timezone: 'Asia/Jakarta',
  role: 'user',
  twoFactorEnabled: true,
};

export function fakeGate(overrides: Partial<Gate> = {}): Gate {
  return {
    setup: 'complete',
    viewer: null,
    instanceName: 'write.financial',
    registrationMode: 'open',
    googleEnabled: false,
    ...overrides,
  };
}
