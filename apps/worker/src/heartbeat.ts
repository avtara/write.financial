// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Liveness for Docker's HEALTHCHECK (plan §10 monitoring: worker heartbeat). The running worker writes the current
 * time to a Redis key on an interval; `main.ts --healthcheck`, run in the same container, reports healthy while that
 * value is fresh. The key is per host name (the container id under Docker), so one stuck worker is not hidden by
 * another one sharing the Redis.
 */

/** The Redis commands the heartbeat uses. */
export interface HeartbeatStore {
  get(key: string): Promise<string | null>;
  /** `SET key value PX ttlMs`. */
  set(key: string, value: string, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
}

export interface HeartbeatSettings {
  /** How often the worker writes the heartbeat. */
  readonly intervalMs: number;
  /** A heartbeat older than this is unhealthy; must be a few intervals so one slow write is not fatal. */
  readonly maxAgeMs: number;
}

export const HEARTBEAT: HeartbeatSettings = { intervalMs: 5_000, maxAgeMs: 20_000 };

export function heartbeatKey(hostname: string): string {
  return `wf:worker:heartbeat:${hostname}`;
}

export interface HeartbeatOptions extends HeartbeatSettings {
  readonly store: HeartbeatStore;
  readonly key: string;
  readonly now: () => number;
  /** A failed write is reported here and retried on the next interval. */
  readonly onError: (error: unknown) => void;
}

export interface Heartbeat {
  /** Stops writing and deletes the key, so the healthcheck fails at once. */
  stop(): Promise<void>;
}

/** Writes the first heartbeat (so the worker is healthy as soon as this resolves), then one per interval. */
export async function startHeartbeat(options: HeartbeatOptions): Promise<Heartbeat> {
  const { store, key, now, intervalMs, maxAgeMs, onError } = options;
  // The key outlives a stale value by one max age, so a stale heartbeat is visible as such and then disappears.
  const beat = () => store.set(key, String(now()), 2 * maxAgeMs);
  await beat();
  let pending = Promise.resolve();
  const timer = setInterval(() => {
    pending = beat().catch(onError);
  }, intervalMs);
  return {
    stop: async () => {
      clearInterval(timer);
      await pending;
      await store.del(key);
    },
  };
}

/** True when the heartbeat at `key` is at most `maxAgeMs` old; a missing or malformed value is unhealthy. */
export async function isHealthy(
  store: HeartbeatStore,
  key: string,
  now: () => number,
  maxAgeMs: number,
): Promise<boolean> {
  const value = await store.get(key);
  return value !== null && now() - Number(value) <= maxAgeMs;
}
