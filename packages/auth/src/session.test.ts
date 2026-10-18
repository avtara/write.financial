// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  assertFreshSession,
  assertTwoFactorEnrolled,
  FRESH_SESSION_MINUTES,
  ReauthenticationRequiredError,
  TwoFactorRequiredError,
  UnauthenticatedError,
} from './session.ts';

const signedInAt = new Date('2026-10-18T03:00:00Z');
const session = (twoFactorEnabled: boolean | null | undefined) => ({
  session: { createdAt: signedInAt },
  user: { twoFactorEnabled },
});
const minutesLater = (minutes: number) => new Date(signedInAt.getTime() + minutes * 60_000);

describe('assertTwoFactorEnrolled (FR-A9)', () => {
  it('passes only users with two-step verification on', () => {
    expect(() => {
      assertTwoFactorEnrolled(session(true));
    }).not.toThrow();
    for (const value of [false, null, undefined]) {
      expect(() => {
        assertTwoFactorEnrolled(session(value));
      }).toThrow(TwoFactorRequiredError);
    }
  });
});

describe('assertFreshSession (FR-A9)', () => {
  it('accepts a session up to 15 minutes old by default', () => {
    expect(FRESH_SESSION_MINUTES).toBe(15);
    expect(() => {
      assertFreshSession(session(true), minutesLater(15));
    }).not.toThrow();
    expect(() => {
      assertFreshSession(session(true), minutesLater(15.01));
    }).toThrow(ReauthenticationRequiredError);
  });

  it('takes a different limit', () => {
    expect(() => {
      assertFreshSession(session(true), minutesLater(6), 5);
    }).toThrow(ReauthenticationRequiredError);
  });
});

describe('errors', () => {
  it('carry stable codes', () => {
    expect(new UnauthenticatedError()).toMatchObject({ code: 'UNAUTHENTICATED', name: 'UnauthenticatedError' });
    expect(new TwoFactorRequiredError()).toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
    expect(new ReauthenticationRequiredError()).toMatchObject({ code: 'REAUTHENTICATION_REQUIRED' });
  });
});
