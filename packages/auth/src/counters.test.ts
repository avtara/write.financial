// SPDX-License-Identifier: AGPL-3.0-only
import RedisMock from 'ioredis-mock';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createRedisCounters, rateLimitStorage, type RedisScripting } from './counters.ts';

// ioredis-mock runs the Lua scripts (fengari), so these tests exercise the real scripts.
const redis = new RedisMock();
const counters = createRedisCounters(redis, 'test:');

beforeEach(async () => {
  await redis.flushall();
});

afterAll(() => {
  redis.disconnect();
});

describe('hit', () => {
  it('counts up and starts the expiry at the first hit only', async () => {
    const first = await counters.hit('a', 60_000);
    expect(first.count).toBe(1);
    expect(first.ttlMs).toBeGreaterThan(59_000);
    expect(first.ttlMs).toBeLessThanOrEqual(60_000);
    const second = await counters.hit('a', 1_000_000);
    expect(second.count).toBe(2);
    expect(second.ttlMs).toBeLessThanOrEqual(60_000);
    expect(await redis.get('test:a')).toBe('2');
  });

  it('resets the expiry when the count reaches the extension threshold', async () => {
    await counters.hit('b', 1000, { at: 2, ttlMs: 900_000 });
    const extended = await counters.hit('b', 1000, { at: 2, ttlMs: 900_000 });
    expect(extended).toMatchObject({ count: 2 });
    expect(extended.ttlMs).toBeGreaterThan(899_000);
    const after = await counters.hit('b', 1000, { at: 2, ttlMs: 5 });
    expect(after.count).toBe(3);
    expect(after.ttlMs).toBeGreaterThan(899_000);
  });

  it('rejects a reply that is not a counter', async () => {
    const broken: RedisScripting = { eval: () => Promise.resolve('OK'), del: () => Promise.resolve(0) };
    await expect(createRedisCounters(broken, 'x:').hit('k', 1000)).rejects.toThrow(
      'Unexpected reply from the counter script',
    );
  });
});

describe('peek and clear', () => {
  it('read a counter without changing it, and delete it', async () => {
    expect(await counters.peek('c')).toBeNull();
    await counters.hit('c', 60_000);
    const seen = await counters.peek('c');
    expect(seen?.count).toBe(1);
    expect(seen?.ttlMs).toBeGreaterThan(59_000);
    expect((await counters.peek('c'))?.count).toBe(1);
    await counters.clear('c');
    expect(await counters.peek('c')).toBeNull();
  });
});

describe('rateLimitStorage', () => {
  const key = new Uint8Array(32).fill(3);

  it('allows max requests per window, then tells when to retry', async () => {
    const storage = rateLimitStorage(counters, key);
    const rule = { window: 60, max: 2 };
    expect(await storage.consume('203.0.113.7|/sign-in/email', rule)).toEqual({ allowed: true, retryAfter: null });
    expect(await storage.consume('203.0.113.7|/sign-in/email', rule)).toEqual({ allowed: true, retryAfter: null });
    expect(await storage.consume('203.0.113.7|/sign-in/email', rule)).toEqual({ allowed: false, retryAfter: 60 });
    expect(await storage.consume('198.51.100.1|/sign-in/email', rule)).toEqual({ allowed: true, retryAfter: null });
  });

  it('keeps client IPs out of Redis', async () => {
    await rateLimitStorage(counters, key).consume('203.0.113.7|/x', { window: 10, max: 0 });
    const keys = await redis.keys('*');
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^test:rl:[0-9a-f]{64}$/);
  });
});
