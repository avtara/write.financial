// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Expiring counters in Valkey/Redis, shared by every web process: per-IP rate limiting (Better Auth's
 * `rateLimit.customStorage`), account lockout, and the password-reset resend cooldown. Each update is one Lua
 * script, so increment, expiry, and read happen atomically even under concurrent requests.
 */
import { hmacSha256Hex } from '@wf/crypto/hash';
import type { BetterAuthRateLimitStorage } from 'better-auth';

/** The part of an ioredis client (`new Redis(config.redis.url)`) the counters use. */
export interface RedisScripting {
  eval: (script: string, numKeys: number, ...args: (string | number)[]) => Promise<unknown>;
  del: (...keys: string[]) => Promise<number>;
}

export interface Counter {
  readonly count: number;
  /** Milliseconds until the counter expires. */
  readonly ttlMs: number;
}

export interface CounterStore {
  /**
   * Adds one to `key`. A new counter expires after `windowMs`; when the count reaches `extend.at`, the expiry is
   * reset to `extend.ttlMs` (e.g. a lockout that lasts 15 minutes from the last allowed failure).
   */
  hit: (key: string, windowMs: number, extend?: { readonly at: number; readonly ttlMs: number }) => Promise<Counter>;
  /** The counter, or `null` when it does not exist (never hit or expired). */
  peek: (key: string) => Promise<Counter | null>;
  clear: (key: string) => Promise<void>;
}

const HIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
if count == tonumber(ARGV[2]) then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
return {count, redis.call('PTTL', KEYS[1])}`;

const PEEK = `
local count = redis.call('GET', KEYS[1])
if not count then return {0, -2} end
return {tonumber(count), redis.call('PTTL', KEYS[1])}`;

/** Lua returns `{count, ttl}`; anything else means the store is not Redis-compatible. */
function toCounter(reply: unknown): Counter {
  if (!Array.isArray(reply) || typeof reply[0] !== 'number' || typeof reply[1] !== 'number') {
    throw new TypeError('Unexpected reply from the counter script');
  }
  return { count: reply[0], ttlMs: reply[1] };
}

/** Counters under `prefix` (e.g. `wf:auth:`), so they cannot collide with queues in the same database. */
export function createRedisCounters(redis: RedisScripting, prefix: string): CounterStore {
  return {
    hit: async (key, windowMs, extend) =>
      toCounter(await redis.eval(HIT, 1, prefix + key, windowMs, extend?.at ?? 0, extend?.ttlMs ?? 0)),
    peek: async (key) => {
      const counter = toCounter(await redis.eval(PEEK, 1, prefix + key));
      return counter.count === 0 ? null : counter;
    },
    clear: async (key) => {
      await redis.del(prefix + key);
    },
  };
}

/**
 * Better Auth rate-limit storage on the counters: a fixed window per (client IP, path) key. Keys are hashed with
 * `key` (`deriveKey(AUTH_SECRET, 'rate_limit')`), so client IPs never appear in Redis.
 */
export function rateLimitStorage(counters: CounterStore, key: Uint8Array): BetterAuthRateLimitStorage {
  return {
    consume: async (rateLimitKey, { window, max }) => {
      const { count, ttlMs } = await counters.hit(`rl:${hmacSha256Hex(key, rateLimitKey)}`, window * 1000);
      return count <= max
        ? { allowed: true, retryAfter: null }
        : { allowed: false, retryAfter: Math.max(1, Math.ceil(ttlMs / 1000)) };
    },
  };
}
