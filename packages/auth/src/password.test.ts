// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, verifyPassword } from './password.ts';

const PASSWORD = ['correct', 'horse', 'battery', 'staple'].join(' ');

describe('hashPassword', () => {
  it('produces an Argon2id PHC string with the OWASP parameters and a fresh salt', async () => {
    const first = await hashPassword(PASSWORD);
    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(await hashPassword(PASSWORD)).not.toBe(first);
  });
});

describe('verifyPassword', () => {
  it('accepts the password and rejects any other', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword({ hash, password: PASSWORD })).toBe(true);
    expect(await verifyPassword({ hash, password: `${PASSWORD}!` })).toBe(false);
  });
});

describe('limits', () => {
  it('follow FR-A1 (at least 10 characters) with a cap against hashing abuse', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(MAX_PASSWORD_LENGTH).toBe(128);
  });
});
