// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import { listRecent, searchEverything, touchRecent } from './search.ts';

const fake = vi.hoisted(() => ({
  services: { recentItems: { touch: vi.fn(() => Promise.resolve()) }, now: () => new Date('2026-10-18T09:00:00Z') },
  searchFor: vi.fn(() => Promise.resolve({ found: true })),
  recentFor: vi.fn(() => Promise.resolve([{ kind: 'page', path: '/' }])),
}));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({ services: () => Promise.resolve(fake.services) }));
vi.mock('../search.ts', () => ({ searchFor: fake.searchFor, recentFor: fake.recentFor }));

const USER_ID = fakeSession().user.id;
const ACCOUNT_ID = '0b9f6c1e-9a52-4c1e-8f4e-3f0d8c1a2b3c';
const signedIn = () => requestContext(fakeSession());
const signedOut = () => requestContext(null);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('⌘K server functions', () => {
  it('searches, lists recent items, and remembers what was opened, for the session user', async () => {
    expect(await call(searchEverything, { context: signedIn(), data: { query: 'netflix' } })).toEqual({
      ok: true,
      value: { found: true },
    });
    expect(fake.searchFor).toHaveBeenCalledWith(fake.services, USER_ID, 'netflix');

    expect(await call(listRecent, { context: signedIn(), data: {} })).toEqual({
      ok: true,
      value: [{ kind: 'page', path: '/' }],
    });
    expect(fake.recentFor).toHaveBeenCalledWith(fake.services, USER_ID);

    expect(await call(touchRecent, { context: signedIn(), data: { kind: 'account', ref: ACCOUNT_ID } })).toEqual({
      ok: true,
      value: null,
    });
    expect(fake.services.recentItems.touch).toHaveBeenCalledWith(USER_ID, 'account', ACCOUNT_ID);
  });

  it('refuses signed-out requests', async () => {
    for (const [fn, data] of [
      [searchEverything, { query: 'kopi' }],
      [listRecent, {}],
      [touchRecent, { kind: 'page', ref: '/' }],
    ] as const) {
      expect(await call(fn, { context: signedOut(), data })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    }
    expect(fake.searchFor).not.toHaveBeenCalled();
    expect(fake.recentFor).not.toHaveBeenCalled();
    expect(fake.services.recentItems.touch).not.toHaveBeenCalled();
  });

  it('validates input with Zod schemas', () => {
    const search = validatorOf(searchEverything);
    expect(search.parse({ query: '  kopi ' })).toEqual({ query: 'kopi' });
    expect(search.safeParse({ query: '   ' }).success).toBe(false);
    expect(search.safeParse({ query: 'x'.repeat(101) }).success).toBe(false);

    const touch = validatorOf(touchRecent);
    expect(touch.safeParse({ kind: 'page', ref: '/settings/profile' }).success).toBe(true);
    expect(touch.safeParse({ kind: 'page', ref: 'https://evil.test/' }).success).toBe(false);
    expect(touch.safeParse({ kind: 'page', ref: `/${'a'.repeat(200)}` }).success).toBe(false);
    expect(touch.safeParse({ kind: 'transaction', ref: ACCOUNT_ID }).success).toBe(true);
    expect(touch.safeParse({ kind: 'transaction', ref: '/' }).success).toBe(false);
    expect(touch.safeParse({ kind: 'user', ref: ACCOUNT_ID }).success).toBe(false);
  });
});
