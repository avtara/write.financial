// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKeyFile } from '@wf/crypto/keyring';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { exampleEnv } from '../../test/env.ts';
import { SETTINGS } from '../../test/fixtures.ts';
// `vi.mock` calls are hoisted above these imports.
import { createQueueBoard } from './queue-board.ts';
import { baseRuntime, createServices, services } from './runtime.ts';

const redis = vi.hoisted(() => ({ listeners: [] as ((error: Error) => void)[] }));

// No Valkey in unit tests: a client that records its error listener.
vi.mock('ioredis', () => ({
  Redis: class {
    on(_event: string, listener: (error: Error) => void) {
      redis.listeners.push(listener);
      return this;
    }
  },
}));
vi.mock('./queue-board.ts', () => ({ createQueueBoard: vi.fn(() => ({ handle: vi.fn() })) }));

const dir = mkdtempSync(path.join(tmpdir(), 'wf-web-runtime-'));
const kekFile = path.join(dir, 'kek');

beforeAll(async () => {
  await createKeyFile(kekFile);
  for (const [key, value] of Object.entries(exampleEnv({ KEK_FILE: kekFile, LOG_LEVEL: 'silent' }))) {
    vi.stubEnv(key, value);
  }
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('baseRuntime', () => {
  it('loads the configuration once', () => {
    expect(baseRuntime()).toBe(baseRuntime());
    expect(baseRuntime().config.auth.secret.length).toBeGreaterThanOrEqual(32);
  });
});

describe('createServices', () => {
  it('wires Better Auth under /api/auth with the instance mailer, lazily connecting', async () => {
    const created = await createServices(baseRuntime());
    expect(created.auth.basePath).toBe('/api/auth');
    expect(created.config).toBe(baseRuntime().config);
    expect(created.now()).toBeInstanceOf(Date);
    expect(created.mailer.configured).toBe(true);
    expect(created.sendWith).toBeTypeOf('function');
    expect(created.invite).toBeTypeOf('function');
    expect(created.review.confirm).toBeTypeOf('function');
    expect(created.notifications.list).toBeTypeOf('function');
    expect(created.schedules.listSubscriptions).toBeTypeOf('function');
    expect(created.onboarding.progress).toBeTypeOf('function');
    expect(created.goals.create).toBeTypeOf('function');
    expect(created.debts.recordCardPayment).toBeTypeOf('function');
    expect(created.receivables.list).toBeTypeOf('function');
    expect(created.investments.portfolio).toBeTypeOf('function');
    expect(created.marketData.benchmarks).toBeTypeOf('function');
  });

  it('logs Valkey connection errors', async () => {
    const runtime = baseRuntime();
    const error = vi.spyOn(runtime.logger, 'error').mockImplementation(() => undefined);
    await createServices(runtime);
    redis.listeners.at(-1)?.(new Error('ECONNREFUSED'));
    const err = expect.any(Error) as unknown;
    expect(error).toHaveBeenCalledWith({ err }, 'redis connection error');
  });

  it('remembers once an admin exists', async () => {
    const created = await createServices(baseRuntime());
    const hasAdmin = vi.spyOn(created.auth, 'hasAdmin').mockResolvedValueOnce(false).mockResolvedValue(true);
    expect(await created.hasAdmin()).toBe(false);
    expect(await created.hasAdmin()).toBe(true);
    expect(await created.hasAdmin()).toBe(true);
    expect(hasAdmin).toHaveBeenCalledTimes(2);
  });

  it('builds the queue board on first use only', async () => {
    const created = await createServices(baseRuntime());
    expect(created.queueBoard()).toBe(created.queueBoard());
    expect(createQueueBoard).toHaveBeenCalledTimes(1);
  });

  it('reads instance settings through the cached store', async () => {
    const created = await createServices(baseRuntime());
    const spy = vi.spyOn(created.instance, 'get').mockResolvedValue(SETTINGS);
    expect(await created.instance.get()).toBe(SETTINGS);
    spy.mockRestore();
  });
});

describe('services', () => {
  it('starts once, and retries after a failed start', async () => {
    // The configuration is loaded once, so make its key file unreadable for the first start.
    renameSync(kekFile, `${kekFile}.away`);
    const failed = services();
    await expect(failed).rejects.toThrow();
    renameSync(`${kekFile}.away`, kekFile);
    const started = services();
    expect(started).not.toBe(failed);
    expect(services()).toBe(started);
    await expect(started).resolves.toMatchObject({ config: baseRuntime().config });
  });
});
