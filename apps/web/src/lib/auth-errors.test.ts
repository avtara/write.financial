// SPDX-License-Identifier: AGPL-3.0-only
import { setLocale } from '@wf/i18n/runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { authErrorMessage, clockTime, needsReauthentication } from './auth-errors.ts';

const at = new Date(2026, 9, 18, 16, 52);

beforeEach(async () => {
  await setLocale('id', { reload: false });
});

describe('clockTime', () => {
  it('writes the local time the way each language does', () => {
    expect(clockTime(at, 'id')).toBe('16.52');
    expect(clockTime(at, 'en')).toBe('16:52');
  });
});

describe('needsReauthentication', () => {
  it('is true only for the "sign in again" codes', () => {
    expect(needsReauthentication('REAUTHENTICATION_REQUIRED')).toBe(true);
    expect(needsReauthentication('SESSION_NOT_FRESH')).toBe(true);
    expect(needsReauthentication('SESSION_EXPIRED')).toBe(true);
    expect(needsReauthentication('INVALID_CODE')).toBe(false);
  });
});

describe('authErrorMessage', () => {
  it('explains known codes and falls back for unknown ones', () => {
    expect(authErrorMessage({ code: 'INVALID_EMAIL_OR_PASSWORD' }, 'id')).toBe('Email atau kata sandi salah');
    expect(authErrorMessage({ code: 'NETWORK' }, 'id')).toBe('Koneksi terputus. Coba lagi.');
    expect(authErrorMessage({ code: 'SOMETHING_NEW' }, 'id')).toBe('Ada yang salah. Coba lagi sebentar.');
  });

  it('adds the tries left before the lock (design D0gWC)', () => {
    expect(authErrorMessage({ code: 'INVALID_PASSWORD', remainingAttempts: 3 }, 'id')).toBe(
      'Kata sandi salah · sisa 3 percobaan sebelum dikunci 15 menit',
    );
  });

  it('says until when a locked account stays locked', () => {
    expect(authErrorMessage({ code: 'ACCOUNT_LOCKED', lockedUntil: at }, 'id')).toBe(
      'Akun dikunci sampai 16.52 karena terlalu banyak percobaan salah.',
    );
    expect(authErrorMessage({ code: 'ACCOUNT_TEMPORARILY_LOCKED' }, 'id')).toBe(
      'Akun dikunci 15 menit karena terlalu banyak percobaan salah.',
    );
  });
});
