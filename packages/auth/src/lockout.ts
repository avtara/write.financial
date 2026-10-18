// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Account lockout (FR-A2): one failure counter per account (keyed by the HMAC of the lower-cased email, so it
 * also works for addresses without an account and leaks nothing about which exist). Wrong passwords and wrong
 * second factors (TOTP or backup code) count together: the 5th failure within 15 minutes locks sign-in for
 * 15 minutes from that failure. A completed sign-in or a password reset clears the counter; a correct password
 * alone does not, so knowing the password cannot be used to reset the second-factor budget.
 *
 * The counter lives in Valkey/Redis (`counters.ts`): one atomic script per failure, shared by every process.
 */
import { hmacSha256Hex } from '@wf/crypto/hash';
import type { CounterStore } from './counters.ts';

export interface LockoutPolicy {
  /** Failures that lock the account (FR-A2: 5). */
  readonly maxFailures: number;
  /** How long failures are remembered and how long the lock lasts (FR-A2: 15 minutes). */
  readonly durationMs: number;
}

export const LOCKOUT_POLICY: LockoutPolicy = { maxFailures: 5, durationMs: 15 * 60_000 };

export type LockoutState =
  | { readonly locked: false; readonly remainingAttempts: number }
  | { readonly locked: true; readonly remainingAttempts: 0; readonly lockedUntil: Date };

export interface Lockout {
  status: (email: string) => Promise<LockoutState>;
  /** Counts one failure and returns the state after it. */
  recordFailure: (email: string) => Promise<LockoutState>;
  reset: (email: string) => Promise<void>;
}

export interface LockoutDeps {
  readonly counters: CounterStore;
  /** `deriveKey(AUTH_SECRET, 'lockout')`. */
  readonly key: Uint8Array;
  readonly policy: LockoutPolicy;
  readonly now: () => Date;
}

export function createLockout({ counters, key, policy, now }: LockoutDeps): Lockout {
  const counterKey = (email: string) => `lockout:${hmacSha256Hex(key, email.trim().toLowerCase())}`;
  const state = (count: number, ttlMs: number): LockoutState =>
    count >= policy.maxFailures
      ? { locked: true, remainingAttempts: 0, lockedUntil: new Date(now().getTime() + ttlMs) }
      : { locked: false, remainingAttempts: policy.maxFailures - count };

  return {
    status: async (email) => {
      const counter = await counters.peek(counterKey(email));
      return counter === null ? state(0, 0) : state(counter.count, counter.ttlMs);
    },
    recordFailure: async (email) => {
      const { count, ttlMs } = await counters.hit(counterKey(email), policy.durationMs, {
        at: policy.maxFailures,
        ttlMs: policy.durationMs,
      });
      return state(count, ttlMs);
    },
    reset: (email) => counters.clear(counterKey(email)),
  };
}
