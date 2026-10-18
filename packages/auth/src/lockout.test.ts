// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { CounterStore } from './counters.ts';
import { createLockout, LOCKOUT_POLICY } from './lockout.ts';

/** In-memory counters on a hand-moved clock, with the same semantics as the Redis scripts. */
function memoryCounters(clock: { ms: number }): CounterStore & { keys: () => string[] } {
  const store = new Map<string, { count: number; expiresAt: number }>();
  const live = (key: string) => {
    const entry = store.get(key);
    if (entry !== undefined && entry.expiresAt <= clock.ms) store.delete(key);
    return store.get(key);
  };
  return {
    hit: (key, windowMs, extend) => {
      const entry = live(key) ?? { count: 0, expiresAt: clock.ms + windowMs };
      entry.count += 1;
      if (entry.count === extend?.at) entry.expiresAt = clock.ms + extend.ttlMs;
      store.set(key, entry);
      return Promise.resolve({ count: entry.count, ttlMs: entry.expiresAt - clock.ms });
    },
    peek: (key) => {
      const entry = live(key);
      return Promise.resolve(entry === undefined ? null : { count: entry.count, ttlMs: entry.expiresAt - clock.ms });
    },
    clear: (key) => {
      store.delete(key);
      return Promise.resolve();
    },
    keys: () => [...store.keys()],
  };
}

const MINUTE = 60_000;
const START = Date.UTC(2026, 9, 18, 3, 0);

function setup() {
  const clock = { ms: START };
  const counters = memoryCounters(clock);
  const lockout = createLockout({
    counters,
    key: new Uint8Array(32).fill(1),
    policy: LOCKOUT_POLICY,
    now: () => new Date(clock.ms),
  });
  return { clock, counters, lockout };
}

describe('LOCKOUT_POLICY', () => {
  it('locks for 15 minutes after 5 failures (FR-A2)', () => {
    expect(LOCKOUT_POLICY).toEqual({ maxFailures: 5, durationMs: 15 * MINUTE });
  });
});

describe('createLockout', () => {
  it('counts down the remaining attempts and locks at the fifth failure for 15 minutes from it', async () => {
    const { clock, lockout } = setup();
    expect(await lockout.status('budi@example.test')).toEqual({ locked: false, remainingAttempts: 5 });
    for (const remaining of [4, 3, 2, 1]) {
      expect(await lockout.recordFailure('budi@example.test')).toEqual({ locked: false, remainingAttempts: remaining });
      clock.ms += MINUTE;
    }
    expect(await lockout.recordFailure('budi@example.test')).toEqual({
      locked: true,
      remainingAttempts: 0,
      lockedUntil: new Date(clock.ms + 15 * MINUTE),
    });
    clock.ms += 15 * MINUTE - 1;
    expect(await lockout.status('budi@example.test')).toMatchObject({ locked: true, remainingAttempts: 0 });
    clock.ms += 1;
    expect(await lockout.status('budi@example.test')).toEqual({ locked: false, remainingAttempts: 5 });
  });

  it('forgets failures 15 minutes after the first one', async () => {
    const { clock, lockout } = setup();
    await lockout.recordFailure('budi@example.test');
    await lockout.recordFailure('budi@example.test');
    clock.ms += 15 * MINUTE;
    expect(await lockout.status('budi@example.test')).toEqual({ locked: false, remainingAttempts: 5 });
  });

  it('treats email case and surrounding spaces as the same account, and other accounts separately', async () => {
    const { lockout } = setup();
    await lockout.recordFailure(' Budi@Example.TEST');
    expect(await lockout.status('budi@example.test')).toEqual({ locked: false, remainingAttempts: 4 });
    expect(await lockout.status('sari@example.test')).toEqual({ locked: false, remainingAttempts: 5 });
  });

  it('clears the counter on reset', async () => {
    const { lockout } = setup();
    await lockout.recordFailure('budi@example.test');
    await lockout.reset('budi@example.test');
    expect(await lockout.status('budi@example.test')).toEqual({ locked: false, remainingAttempts: 5 });
  });

  it('keys counters by a keyed hash, never the email', async () => {
    const { counters, lockout } = setup();
    await lockout.recordFailure('budi@example.test');
    expect(counters.keys()).toEqual([expect.stringMatching(/^lockout:[0-9a-f]{64}$/)]);
  });
});
