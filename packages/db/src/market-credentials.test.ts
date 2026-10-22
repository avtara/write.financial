// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixtureGetDek } from '../test/ledger-fixture.ts';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createMarketCredentials } from './market-credentials.ts';
import { createMarketData } from './market-data.ts';

let test: TestDatabase;
let alice: string;
let bob: string;

const NOW = new Date('2026-10-15T09:42:00Z');
const repo = () => createMarketCredentials(test.db, { getDek: fixtureGetDek, now: () => NOW });
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const asWorker = <T>(fn: () => Promise<T>) => test.as('wf_worker', fn);
const KEY = 'tiingo-0123456789abcdef';

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
  await test.query('UPDATE users SET two_factor_enabled = true');
});

describe('save (FR-ST4)', () => {
  it('stores the key encrypted, shows only its last 4, and resets the status when replaced', async () => {
    const saved = await asApp(() => repo().save(alice, { provider: 'tiingo', apiKey: `  ${KEY}  ` }));
    expect(saved).toMatchObject({
      provider: 'tiingo',
      last4: 'cdef',
      active: true,
      status: 'untested',
      quotaUsed: 0,
      quotaLimit: null,
      retryAfter: null,
      lastTestedAt: null,
      updatedAt: NOW,
    });
    expect(JSON.stringify(saved)).not.toContain(KEY);
    const [row] = await test.query<{ enc: Uint8Array }>('SELECT api_key_enc AS enc FROM market_credentials');
    expect(Buffer.from(row?.enc ?? []).toString('latin1')).not.toContain(KEY);
    await asApp(() =>
      repo().setStatus(alice, 'tiingo', { status: 'connected', quotaUsed: 4, quotaLimit: 1000, testedAt: NOW }),
    );
    const replaced = await asApp(() =>
      repo().save(alice, { provider: 'tiingo', apiKey: 'other-key-9876', active: false }),
    );
    expect(replaced).toMatchObject({ id: saved.id, last4: '9876', active: false, status: 'untested', quotaUsed: 0 });
    expect(await asWorker(() => repo().apiKey(alice, 'tiingo'))).toBe('other-key-9876');
    expect(await asApp(() => repo().list(alice))).toEqual([replaced]);
    expect(await asApp(() => repo().list(bob))).toEqual([]);
  });

  it('refuses providers without BYOK, unusable keys, and users without 2FA', async () => {
    await expect(
      asApp(() => repo().save(alice, { provider: 'frankfurter' as 'tiingo', apiKey: KEY })),
    ).rejects.toMatchObject({ code: 'INVALID_MARKET_CREDENTIAL' });
    for (const apiKey of ['abc', 'with space key', 'x'.repeat(513)]) {
      await expect(asApp(() => repo().save(alice, { provider: 'tiingo', apiKey }))).rejects.toMatchObject({
        code: 'INVALID_MARKET_CREDENTIAL',
      });
    }
    await test.query('UPDATE users SET two_factor_enabled = false WHERE id = $1', [bob]);
    await expect(asApp(() => repo().save(bob, { provider: 'tiingo', apiKey: KEY }))).rejects.toMatchObject({
      code: 'TWO_FACTOR_REQUIRED',
    });
  });
});

describe('setActive, setStatus, apiKey', () => {
  it('pauses after a 429 until retry-after, keeping omitted fields, and finds nothing without a key', async () => {
    await asApp(() => repo().save(alice, { provider: 'coingecko', apiKey: KEY }));
    expect(await asApp(() => repo().setActive(alice, 'coingecko', false))).toMatchObject({ active: false });
    const retryAfter = new Date(NOW.getTime() + 30_000);
    await asWorker(() =>
      repo().setStatus(alice, 'coingecko', {
        status: 'quota_exhausted',
        quotaUsed: 10_000,
        quotaLimit: 10_000,
        quotaResetAt: new Date('2026-11-01T00:00:00Z'),
        retryAfter,
      }),
    );
    expect(await asWorker(() => repo().setStatus(alice, 'coingecko', { status: 'rate_limited' }))).toMatchObject({
      status: 'rate_limited',
      quotaUsed: 10_000,
      quotaLimit: 10_000,
      quotaResetAt: new Date('2026-11-01T00:00:00Z'),
      retryAfter,
      lastTestedAt: null,
    });
    await expect(asApp(() => repo().setActive(bob, 'coingecko', true))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(asApp(() => repo().setStatus(bob, 'coingecko', { status: 'error' }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await asApp(() => repo().apiKey(bob, 'coingecko'))).toBeNull();
  });
});

describe('remove', () => {
  it('deletes the key and that provider’s results of the user only (real clock by default)', async () => {
    const credentials = createMarketCredentials(test.db, { getDek: fixtureGetDek });
    for (const userId of [alice, bob])
      await asApp(() => credentials.save(userId, { provider: 'finnhub', apiKey: KEY }));
    const quote = { quoteCurrency: 'USD', bucketTs: NOW, price: '690.1', prevClose: null } as const;
    await asWorker(async () => {
      await createMarketData(test.db).recordUserQuotes(
        alice,
        [
          { ...quote, provider: 'finnhub', symbol: 'SPY' },
          { ...quote, provider: 'finnhub', symbol: 'QQQ' },
          { ...quote, provider: 'tiingo', symbol: 'SPY' },
        ],
        NOW,
      );
      await createMarketData(test.db).recordUserQuotes(bob, [{ ...quote, provider: 'finnhub', symbol: 'SPY' }], NOW);
    });
    expect(await asApp(() => credentials.remove(alice, 'finnhub'))).toEqual({ quotesDeleted: 2 });
    expect(await test.query('SELECT user_id, provider FROM user_quotes ORDER BY user_id = $1', [alice])).toEqual([
      { user_id: bob, provider: 'finnhub' },
      { user_id: alice, provider: 'tiingo' },
    ]);
    await expect(asApp(() => credentials.remove(alice, 'finnhub'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
