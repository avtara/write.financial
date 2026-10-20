// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lastKnown, remember } from './last-known.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lastKnown', () => {
  it('only passes the request through on the server, remembering nothing', async () => {
    remember('gate', 2);
    await expect(lastKnown('gate', () => Promise.resolve(1))).resolves.toBe(1);
    await expect(lastKnown('gate', () => Promise.reject(new TypeError('offline')))).rejects.toThrow('offline');
  });

  it('answers with a remembered server-rendered result', async () => {
    vi.stubGlobal('window', {});
    remember('viewer', 'Avtara');
    await expect(lastKnown('viewer', () => Promise.reject(new TypeError('offline')))).resolves.toBe('Avtara');
  });

  it('answers with the last result in the browser when the request never reaches the server', async () => {
    vi.stubGlobal('window', {});
    await expect(lastKnown('counts', () => Promise.reject(new TypeError('offline')))).rejects.toThrow('offline');
    await expect(lastKnown('counts', () => Promise.resolve({ transactions: 128 }))).resolves.toEqual({
      transactions: 128,
    });
    await expect(lastKnown('counts', () => Promise.reject(new TypeError('offline')))).resolves.toEqual({
      transactions: 128,
    });
    await expect(lastKnown('counts', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });
});
