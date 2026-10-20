// SPDX-License-Identifier: AGPL-3.0-only
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKeyFile } from '@wf/crypto/keyring';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureLog, fakeBroker, type FakeBroker, type LogCapture } from '../test/fakes.ts';
import { heartbeatKey } from './heartbeat.ts';
import type { ConnectOptions } from './platform.ts';
import type { Broker } from './runtime.ts';
import { run, SHUTDOWN_TIMEOUT_MS, type RunDeps } from './run.ts';

const KEK_FILE = path.join(mkdtempSync(path.join(tmpdir(), 'wf-worker-')), 'kek');
await createKeyFile(KEK_FILE);

const ENV = {
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://wf_app:unused@127.0.0.1:9/write_financial',
  // Never reached: the pool connects lazily and these tests run no real job.
  DATABASE_URL_WORKER: 'postgres://wf_worker:unused@127.0.0.1:9/write_financial',
  DATABASE_URL_AUTH: 'postgres://wf_auth:unused@127.0.0.1:9/write_financial',
  REDIS_URL: 'redis://127.0.0.1:9/0',
  S3_ENDPOINT: 'http://127.0.0.1:8333',
  S3_ACCESS_KEY_ID: 'access',
  S3_SECRET_ACCESS_KEY: 'secret',
  KEK_FILE,
  AUTH_SECRET: 'a'.repeat(32),
  LOG_LEVEL: 'info',
};

const QUEUES = [
  'maintenance',
  'fx',
  'dispatch',
  'occurrences',
  'reminders',
  'budget-alerts',
  'balance-checks',
  'period-close',
  'notify',
  'detect-recurring',
];

const KEY = heartbeatKey('host-1');

let broker: FakeBroker;
let signals: EventEmitter;
let log: LogCapture;
let errors: string[];
let connections: { url: string; options: ConnectOptions }[];

beforeEach(() => {
  broker = fakeBroker();
  signals = new EventEmitter();
  log = captureLog();
  errors = [];
  connections = [];
});

afterEach(() => {
  vi.useRealTimers();
});

function deps(overrides: Partial<RunDeps> = {}, target: Broker = broker): RunDeps {
  return {
    connect: (url, options) => {
      connections.push({ url, options });
      return target;
    },
    signals,
    output: { error: (message) => errors.push(message) },
    hostname: 'host-1',
    now: () => 10_000,
    heartbeat: { intervalMs: 1_000, maxAgeMs: 4_000 },
    log,
    ...overrides,
  };
}

const started = () =>
  vi.waitFor(() => {
    expect(log.messages()).toContain('worker started');
  });

describe('arguments and configuration', () => {
  it.each([[['--nope']], [['--healthcheck', 'extra']]])('prints usage for %j', async (args) => {
    expect(await run(args, ENV, deps())).toBe(2);
    expect(errors).toEqual(['Usage: wf-worker [--healthcheck]']);
  });

  it('reports invalid configuration by key, without values', async () => {
    expect(await run([], { ...ENV, REDIS_URL: 'http://secret-host' }, deps())).toBe(1);
    expect(errors).toEqual([expect.stringContaining('REDIS_URL')]);
    expect(errors[0]).not.toContain('secret-host');
  });
});

describe('--healthcheck', () => {
  it('exits 0 for a fresh heartbeat of this host, failing fast on Redis', async () => {
    await broker.store.set(KEY, '9000', 8_000);
    expect(await run(['--healthcheck'], ENV, deps())).toBe(0);
    expect(connections).toEqual([
      { url: ENV.REDIS_URL, options: { failFast: true, onError: expect.any(Function) as unknown } },
    ]);
    expect(connections[0]?.options.onError(new Error('ignored'))).toBeUndefined();
    expect(broker.closed).toEqual(['broker']);
  });

  it('exits 1 for a stale or missing heartbeat', async () => {
    await broker.store.set(KEY, '5999', 8_000);
    expect(await run(['--healthcheck'], ENV, deps())).toBe(1);
    await broker.store.del(KEY);
    expect(await run(['--healthcheck'], ENV, deps())).toBe(1);
  });

  it('exits 1 when Redis cannot be read', async () => {
    const broken: Broker = {
      ...broker,
      store: { ...broker.store, get: () => Promise.reject(new Error('ECONNREFUSED')) },
    };
    expect(await run(['--healthcheck'], ENV, deps({}, broken))).toBe(1);
    expect(broker.closed).toEqual(['broker']);
  });
});

describe('worker', () => {
  it.each(['SIGTERM', 'SIGINT'] as const)('runs until %s, then stops cleanly and exits 0', async (signal) => {
    const exit = run([], ENV, deps());
    await started();
    expect(connections[0]?.options.failFast).toBe(false);
    signals.emit(signal);
    expect(await exit).toBe(0);
    expect(log.messages()).toEqual([
      ...Array<string>(4).fill('job scheduler registered'),
      'worker started',
      'shutting down',
      'worker stopped',
    ]);
    expect(log.lines[5]).toMatchObject({ signal });
    expect(broker.closed).toEqual([
      ...QUEUES.map((queue) => `worker:${queue}`),
      ...QUEUES.map((queue) => `queue:${queue}`),
      'broker',
    ]);
  });

  it('exits 1 before connecting when the key file cannot be read', async () => {
    expect(await run([], { ...ENV, KEK_FILE: '/nonexistent/kek' }, deps())).toBe(1);
    expect(log.lines.at(-1)).toMatchObject({ level: 60, msg: 'cannot load the key file' });
    expect(connections).toEqual([]);
  });

  it('logs Redis connection errors', async () => {
    const exit = run([], ENV, deps());
    await started();
    connections[0]?.options.onError(new Error('ECONNRESET'));
    expect(log.lines.at(-1)).toMatchObject({ level: 50, msg: 'redis connection error' });
    signals.emit('SIGTERM');
    expect(await exit).toBe(0);
  });

  it('exits 1 and closes the connections when the start fails', async () => {
    const failing: Broker = {
      ...broker,
      createQueue: (name, onError) => ({
        ...broker.createQueue(name, onError),
        upsertJobScheduler: () => Promise.reject(new Error('NOPERM')),
      }),
    };
    expect(await run([], ENV, deps({}, failing))).toBe(1);
    expect(log.lines.at(-1)).toMatchObject({ level: 60, msg: 'worker failed to start', err: { message: 'NOPERM' } });
    expect(broker.closed).toEqual(['broker']);
  });

  it('stops waiting for Redis on a signal during the start and exits 1', async () => {
    const pending = Promise.withResolvers<never>();
    const unreachable: Broker = {
      ...broker,
      createQueue: (name, onError) => ({
        ...broker.createQueue(name, onError),
        upsertJobScheduler: () => pending.promise,
      }),
    };
    const exit = run([], ENV, deps({}, unreachable));
    await vi.waitFor(() => {
      expect(broker.queues.size).toBe(QUEUES.length);
    });
    signals.emit('SIGINT');
    expect(await exit).toBe(1);
    expect(log.lines.at(-1)).toMatchObject({ msg: 'stopped while starting', signal: 'SIGINT' });
    expect(broker.closed).toEqual(['broker']);
    pending.reject(new Error('Connection is closed.'));
  });

  describe('shutdown that does not finish', () => {
    const stuck = Promise.withResolvers<undefined>();
    const hanging = (): Broker => ({
      ...broker,
      createWorker: (name, processor, options) => {
        broker.createWorker(name, processor, options);
        return { close: () => stuck.promise };
      },
    });

    it('gives up after the timeout and exits 1', async () => {
      vi.useFakeTimers();
      const exit = run([], ENV, deps({}, hanging()));
      await started();
      signals.emit('SIGTERM');
      await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS);
      expect(await exit).toBe(1);
      expect(log.lines.at(-1)).toMatchObject({ level: 50, msg: 'shutdown did not finish cleanly', reason: 'timeout' });
    });

    it('exits 1 at once on a second signal', async () => {
      const exit = run([], ENV, deps({ shutdownTimeoutMs: 60_000 }, hanging()));
      await started();
      signals.emit('SIGTERM');
      signals.emit('SIGINT');
      expect(await exit).toBe(1);
      expect(log.lines.at(-1)).toMatchObject({ reason: 'forced' });
    });
  });

  it('exits 1 but still closes the connections when closing a worker fails', async () => {
    const failing: Broker = {
      ...broker,
      createWorker: (name, processor, options) => {
        broker.createWorker(name, processor, options);
        return { close: () => Promise.reject(new Error('lock lost')) };
      },
    };
    const exit = run([], ENV, deps({}, failing));
    await started();
    signals.emit('SIGTERM');
    expect(await exit).toBe(1);
    expect(log.messages().slice(-2)).toEqual(['shutdown failed', 'shutdown did not finish cleanly']);
    expect(log.lines.at(-1)).toMatchObject({ reason: 'failed' });
    expect(broker.closed).toEqual([...QUEUES.map((queue) => `queue:${queue}`), 'broker']);
  });

  it('defaults to the host name, the wall clock, and the standard heartbeat', async () => {
    const exit = run([], ENV, { connect: () => broker, signals, output: { error: () => undefined }, log });
    await started();
    const [key, entry] = [...broker.store.entries][0] ?? [];
    expect(key).toMatch(/^wf:worker:heartbeat:.+/);
    expect(Number(entry?.value)).toBeGreaterThan(Date.parse('2026-01-01'));
    expect(entry?.ttlMs).toBe(40_000);
    signals.emit('SIGTERM');
    expect(await exit).toBe(0);
  });
});
