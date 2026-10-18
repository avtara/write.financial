// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeStore } from '../test/fakes.ts';
import { HEARTBEAT, heartbeatKey, isHealthy, startHeartbeat } from './heartbeat.ts';

const KEY = heartbeatKey('host-1');

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse('2026-10-18T03:30:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

const settings = { intervalMs: 1_000, maxAgeMs: 4_000 };

describe('heartbeatKey', () => {
  it('is per host, so each container checks its own worker', () => {
    expect(KEY).toBe('wf:worker:heartbeat:host-1');
    expect(heartbeatKey('host-2')).not.toBe(KEY);
  });
});

describe('startHeartbeat', () => {
  it('writes the time at once and then every interval, with a TTL of two max ages', async () => {
    const store = fakeStore();
    const onError = vi.fn<(error: unknown) => void>();
    const heartbeat = await startHeartbeat({ ...settings, store, key: KEY, now: Date.now, onError });
    expect(store.entries.get(KEY)).toEqual({ value: String(Date.parse('2026-10-18T03:30:00Z')), ttlMs: 8_000 });

    await vi.advanceTimersByTimeAsync(2_500);
    expect(store.entries.get(KEY)?.value).toBe(String(Date.parse('2026-10-18T03:30:02Z')));
    expect(onError).not.toHaveBeenCalled();
    await heartbeat.stop();
  });

  it('reports a failed write and recovers on the next interval', async () => {
    const store = fakeStore();
    const onError = vi.fn<(error: unknown) => void>();
    const heartbeat = await startHeartbeat({ ...settings, store, key: KEY, now: Date.now, onError });
    const failure = new Error('READONLY');
    store.failNextSet(failure);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onError).toHaveBeenCalledWith(failure);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.entries.get(KEY)?.value).toBe(String(Date.now()));
    await heartbeat.stop();
  });

  it('fails to start when the first write fails', async () => {
    const store = fakeStore();
    store.failNextSet(new Error('NOAUTH'));
    await expect(startHeartbeat({ ...settings, store, key: KEY, now: Date.now, onError: vi.fn() })).rejects.toThrow(
      'NOAUTH',
    );
  });

  it('stops writing and deletes the key on stop', async () => {
    const store = fakeStore();
    const heartbeat = await startHeartbeat({ ...settings, store, key: KEY, now: Date.now, onError: vi.fn() });
    await heartbeat.stop();
    expect(store.entries.has(KEY)).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(store.entries.has(KEY)).toBe(false);
  });
});

describe('isHealthy', () => {
  it('is healthy up to the max age and unhealthy after', async () => {
    const store = fakeStore();
    await store.set(KEY, '1000', 8_000);
    expect(await isHealthy(store, KEY, () => 5_000, settings.maxAgeMs)).toBe(true);
    expect(await isHealthy(store, KEY, () => 5_001, settings.maxAgeMs)).toBe(false);
  });

  it('is unhealthy without a heartbeat or with a malformed one', async () => {
    const store = fakeStore();
    expect(await isHealthy(store, KEY, Date.now, settings.maxAgeMs)).toBe(false);
    await store.set(KEY, 'not-a-time', 8_000);
    expect(await isHealthy(store, KEY, Date.now, settings.maxAgeMs)).toBe(false);
  });

  it('defaults to a 5 s beat judged stale after 20 s', () => {
    expect(HEARTBEAT).toEqual({ intervalMs: 5_000, maxAgeMs: 20_000 });
  });
});
