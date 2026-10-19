// SPDX-License-Identifier: AGPL-3.0-only
import { LedgerError } from '@wf/db/ledger-errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../test/fixtures.ts';
import { requestContext } from '../../test/server-fn.ts';
import { serveAccountLogo } from './account-logo.ts';

const fake = vi.hoisted(() => ({
  accounts: { get: vi.fn() },
  logoStore: { get: vi.fn() },
}));
vi.mock('./runtime.ts', () => ({ services: () => Promise.resolve(fake) }));

const ID = '0192a6c4-0000-7000-8000-0000000000b1';
const USER_ID = fakeSession().user.id;
const KEY = `u/${USER_ID}/0192a6c4-0000-7000-8000-0000000000c1`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('serveAccountLogo', () => {
  it('answers the decrypted logo of the session user’s account, cacheable and not sniffable', async () => {
    fake.accounts.get.mockResolvedValue({ logoKey: KEY });
    fake.logoStore.get.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), mime: 'image/webp' });
    const response = await serveAccountLogo({ context: requestContext(), params: { id: ID } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(fake.accounts.get).toHaveBeenCalledWith(USER_ID, ID);
    expect(fake.logoStore.get).toHaveBeenCalledWith(USER_ID, KEY);
  });

  it('answers 404 for a bad id, a signed-out visitor, an unknown account, or no logo', async () => {
    const statuses = async () =>
      [
        await serveAccountLogo({ context: requestContext(), params: { id: 'nope' } }),
        await serveAccountLogo({ context: requestContext(null), params: { id: ID } }),
      ].map((response) => response.status);
    expect(await statuses()).toEqual([404, 404]);

    fake.accounts.get.mockRejectedValueOnce(new LedgerError('NOT_FOUND'));
    const missing = await serveAccountLogo({ context: requestContext(), params: { id: ID } });
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');

    fake.accounts.get.mockResolvedValueOnce({ logoKey: null });
    expect((await serveAccountLogo({ context: requestContext(), params: { id: ID } })).status).toBe(404);
    expect(fake.logoStore.get).not.toHaveBeenCalled();
  });

  it('rethrows unexpected failures', async () => {
    fake.accounts.get.mockRejectedValueOnce(new Error('database down'));
    await expect(serveAccountLogo({ context: requestContext(), params: { id: ID } })).rejects.toThrow('database down');
  });
});
