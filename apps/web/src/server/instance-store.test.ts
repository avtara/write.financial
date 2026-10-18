// SPDX-License-Identifier: AGPL-3.0-only
import type { InstanceSettings, InstanceSettingsRepository, SetupInput } from '@wf/db/instance-settings';
import { describe, expect, it, vi } from 'vitest';
import { createInstanceStore, INSTANCE_CACHE_MS } from './instance-store.ts';

const SETTINGS: InstanceSettings = {
  instanceName: 'Keuangan Keluarga',
  publicUrl: null,
  defaultLocale: 'id',
  defaultTimezone: 'Asia/Jakarta',
  registrationMode: 'closed',
  setupCompletedAt: null,
  smtp: null,
};

const INPUT: SetupInput = {
  instanceName: 'Rumah',
  publicUrl: 'https://uang.example/',
  defaultLocale: 'en',
  defaultTimezone: 'Asia/Makassar',
  registrationMode: 'invite',
  smtp: null,
};

function setup() {
  let clock = 1_000;
  const repository = {
    get: vi.fn(() => Promise.resolve(SETTINGS)),
    updateSetup: vi.fn((_admin: string, input: SetupInput) =>
      Promise.resolve({ ...SETTINGS, ...input, setupCompletedAt: new Date(0), smtp: null }),
    ),
    smtpPassword: vi.fn(() => Promise.resolve('smtp-pass')),
  } satisfies InstanceSettingsRepository;
  const store = createInstanceStore(repository, () => clock);
  return {
    repository,
    store,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

describe('createInstanceStore', () => {
  it('reads once per cache period, sharing the in-flight read', async () => {
    const { repository, store, tick } = setup();
    const [a, b] = await Promise.all([store.get(), store.get()]);
    expect(a).toBe(SETTINGS);
    expect(b).toBe(SETTINGS);
    tick(INSTANCE_CACHE_MS - 1);
    await store.get();
    expect(repository.get).toHaveBeenCalledTimes(1);
    tick(1);
    await store.get();
    expect(repository.get).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed read', async () => {
    const { repository, store } = setup();
    repository.get.mockRejectedValueOnce(new Error('database down'));
    await expect(store.get()).rejects.toThrow('database down');
    await expect(store.get()).resolves.toBe(SETTINGS);
    expect(repository.get).toHaveBeenCalledTimes(2);
  });

  it('keeps a newer read when an older one fails late', async () => {
    const { repository, store, tick } = setup();
    const pending = Promise.withResolvers<InstanceSettings>();
    repository.get.mockReturnValueOnce(pending.promise);
    const first = store.get();
    tick(INSTANCE_CACHE_MS);
    await store.get();
    pending.reject(new Error('late'));
    await expect(first).rejects.toThrow('late');
    await store.get();
    expect(repository.get).toHaveBeenCalledTimes(2);
  });

  it('serves saved settings at once, without another read', async () => {
    const { repository, store } = setup();
    await store.get();
    const saved = await store.updateSetup('admin-id', INPUT);
    expect(repository.updateSetup).toHaveBeenCalledWith('admin-id', INPUT);
    expect(await store.get()).toBe(saved);
    expect(saved.instanceName).toBe('Rumah');
    expect(repository.get).toHaveBeenCalledTimes(1);
  });

  it('passes the SMTP password through', async () => {
    const { store } = setup();
    expect(await store.smtpPassword()).toBe('smtp-pass');
  });
});
