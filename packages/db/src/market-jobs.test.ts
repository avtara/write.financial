// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixtureGetDek } from '../test/ledger-fixture.ts';
import { insertUser, PGLITE_HOOK_TIMEOUT, pgError, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createMarketCredentials } from './market-credentials.ts';
import { createMarketData } from './market-data.ts';
import { BENCHMARK_TARGETS, createMarketJobs, FETCHED_MARKETS, SERVER_SOURCE } from './market-jobs.ts';

let test: TestDatabase;
let alice: string;
let bob: string;

const NOW = new Date('2026-10-15T09:42:00Z');
const jobs = () => createMarketJobs(test.db, { getDek: fixtureGetDek });
const credentials = () => createMarketCredentials(test.db, { getDek: fixtureGetDek, now: () => NOW });
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const asWorker = <T>(fn: () => Promise<T>) => test.as('wf_worker', fn);
const KEY = 'fake-market-jobs-key';

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

async function asset(
  userId: string,
  values: { symbol: string; currency?: string; market: string; mode?: string; meta?: string },
): Promise<void> {
  const [account] = await test.query<{ id: string }>(
    `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_date, color)
     VALUES ($1, 'investment', 'P', 'P', $2, '2026-01-01', 'cyan') RETURNING id`,
    [userId, values.currency ?? 'USD'],
  );
  const mode = values.mode ?? 'server';
  await test.query(
    `INSERT INTO assets (user_id, account_id, symbol, name, quote_currency, asset_class, market, price_mode,
                         manual_price, manual_price_at, meta)
     VALUES ($1, $2, $3, $3, $4, 'us_stocks', $5, $6, $7, $8, $9::jsonb)`,
    [
      userId,
      account?.id,
      values.symbol,
      values.currency ?? 'USD',
      values.market,
      mode,
      mode === 'manual' ? '1' : null,
      mode === 'manual' ? NOW : null,
      values.meta ?? '{}',
    ],
  );
}

beforeEach(async () => {
  await test.query('DELETE FROM users');
  await test.query('DELETE FROM market_quotes');
  await test.query('DELETE FROM market_provider_state');
  await test.query('DELETE FROM market_api_logs');
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
  await test.query('UPDATE users SET two_factor_enabled = true');
});

describe('serverTargets (wf_market_server_targets)', () => {
  it('is the union of every user’s fetched crypto and gold symbols per currency, XAU for Antam estimates', async () => {
    await asset(alice, { symbol: 'BTC', currency: 'IDR', market: 'crypto' });
    await asset(bob, { symbol: 'BTC', currency: 'IDR', market: 'crypto', mode: 'byok' });
    await asset(bob, {
      symbol: 'ETH',
      currency: 'USD',
      market: 'crypto',
      meta: '{"symbols":{"coinmarketcap":"ETH2"}}',
    });
    await asset(bob, { symbol: 'SOL', currency: 'IDR', market: 'crypto', mode: 'manual' });
    await asset(alice, { symbol: 'XAU', currency: 'IDR', market: 'gold_spot' });
    await asset(bob, { symbol: 'EMAS', currency: 'IDR', market: 'gold_antam', mode: 'computed' });
    await asset(bob, { symbol: 'SPY', market: 'us_equity' });
    expect(await asWorker(() => jobs().serverTargets())).toEqual([
      { market: 'crypto', symbol: 'BTC', currency: 'IDR' },
      { market: 'crypto', symbol: 'ETH2', currency: 'USD' },
      { market: 'gold_spot', symbol: 'XAU', currency: 'IDR' },
    ]);
  });

  it('is the worker’s only (not the app’s)', async () => {
    await expect(asApp(() => jobs().serverTargets())).rejects.toMatchObject(
      pgError(/permission denied for function wf_market_server_targets/),
    );
    await expect(asApp(() => jobs().byokUsers())).rejects.toMatchObject(
      pgError(/permission denied for function wf_market_byok_users/),
    );
  });
});

describe('byokUsers (wf_market_byok_users)', () => {
  it('lists users with an active key once, with their time zone, not users being deleted', async () => {
    await asApp(() => credentials().save(alice, { provider: 'tiingo', apiKey: KEY }));
    await asApp(() => credentials().save(alice, { provider: 'eodhd', apiKey: KEY }));
    await asApp(() => credentials().save(bob, { provider: 'tiingo', apiKey: KEY, active: false }));
    const carol = await insertUser(test, 'carol@example.test');
    await test.query('UPDATE users SET two_factor_enabled = true WHERE id = $1', [carol]);
    await asApp(() => credentials().save(carol, { provider: 'tiingo', apiKey: KEY }));
    await test.query('UPDATE users SET deletion_requested_at = now() WHERE id = $1', [carol]);
    await test.query(`UPDATE users SET timezone = 'Asia/Makassar' WHERE id = $1`, [alice]);
    expect(await asWorker(() => jobs().byokUsers())).toEqual([{ userId: alice, timeZone: 'Asia/Makassar' }]);
  });
});

describe('userTargets', () => {
  it('turns the user’s assets into deduplicated targets with each provider’s symbol, plus the benchmarks', async () => {
    await asset(alice, { symbol: 'SPY', market: 'us_equity' });
    await asset(alice, { symbol: 'SPY', market: 'us_equity', mode: 'byok' });
    await asset(alice, {
      symbol: 'BBCA',
      currency: 'IDR',
      market: 'idx_equity',
      meta: '{"symbols":{"eodhd":"BBCA.JK"}}',
    });
    await asset(alice, { symbol: 'TLKM', currency: 'IDR', market: 'idx_equity', mode: 'manual' });
    await asset(alice, { symbol: 'BTC', currency: 'IDR', market: 'crypto' });
    await asset(alice, { symbol: 'RDPU', currency: 'IDR', market: 'mutual_fund', mode: 'manual' });
    await asset(bob, { symbol: 'QQQ', market: 'us_equity' });
    await asWorker(() =>
      createMarketData(test.db).recordServerQuotes(
        [
          {
            provider: 'coinmarketcap',
            symbol: 'BTC',
            quoteCurrency: 'IDR',
            bucketTs: new Date('2026-10-15T09:40:00Z'),
            price: '1459802000',
            prevClose: null,
          },
        ],
        NOW,
      ),
    );
    const polled = await asWorker(() => jobs().userTargets(alice, { fetchedOnly: true }));
    expect(polled).toEqual([
      {
        market: 'us_equity',
        currency: 'USD',
        symbols: { tiingo: 'SPY', finnhub: 'SPY', massive: 'SPY', alpha_vantage: 'SPY' },
        serverAsOf: null,
      },
      { market: 'idx_equity', currency: 'IDR', symbols: { eodhd: 'BBCA.JK', marketstack: 'BBCA' }, serverAsOf: null },
      {
        market: 'crypto',
        currency: 'IDR',
        symbols: { coinmarketcap: 'BTC', coingecko: 'BTC' },
        serverAsOf: new Date('2026-10-15T09:40:00Z'),
      },
      { market: 'idx_equity', currency: 'IDR', symbols: { eodhd: 'JKSE.INDX', marketstack: 'IHSG' }, serverAsOf: null },
    ]);
    const tested = await asApp(() => jobs().userTargets(alice));
    expect(
      tested.map((target) => target.symbols.marketstack ?? target.symbols.tiingo ?? target.symbols.coingecko),
    ).toEqual(['SPY', 'BBCA', 'TLKM', 'BTC', 'IHSG']);
    expect(FETCHED_MARKETS).toEqual(['us_equity', 'idx_equity', 'crypto', 'gold_spot']);
    expect(SERVER_SOURCE).toEqual({ crypto: 'coinmarketcap', gold_spot: 'fawazahmed0' });
    expect(BENCHMARK_TARGETS.map((benchmark) => benchmark.symbol)).toEqual(['SPY', 'IHSG']);
  });
});

describe('credential, lastRequests, testsSince, quoteCounts', () => {
  it('decrypts the user’s own key for the request and reads its state', async () => {
    await asApp(() => credentials().save(alice, { provider: 'tiingo', apiKey: KEY }));
    await asWorker(() =>
      credentials().setStatus(alice, 'tiingo', {
        status: 'rate_limited',
        quotaUsed: 3,
        quotaResetAt: new Date('2026-10-16T00:00:00Z'),
        retryAfter: new Date('2026-10-15T09:43:00Z'),
      }),
    );
    expect(await asWorker(() => jobs().credential(alice, 'tiingo'))).toEqual({
      provider: 'tiingo',
      apiKey: KEY,
      active: true,
      status: 'rate_limited',
      quotaUsed: 3,
      quotaResetAt: new Date('2026-10-16T00:00:00Z'),
      retryAfter: new Date('2026-10-15T09:43:00Z'),
    });
    expect(await asWorker(() => jobs().credential(bob, 'tiingo'))).toBeNull();
  });

  it('knows when each provider was last asked, the tests of the last hour, and the prices per key', async () => {
    const data = createMarketData(test.db);
    const log = (userId: string | null, provider: 'tiingo' | 'eodhd', endpoint: string, at: string) =>
      data.logRequest(userId, { provider, endpoint, httpStatus: 200, ok: true, durationMs: 5, at: new Date(at) });
    await asWorker(async () => {
      await log(alice, 'tiingo', 'GET /iex', '2026-10-15T09:30:00Z');
      await log(alice, 'tiingo', 'TEST GET /iex', '2026-10-15T09:00:00Z');
      await log(alice, 'tiingo', 'TEST GET /iex', '2026-10-15T09:00:00Z');
      await log(alice, 'tiingo', 'TEST GET /iex', '2026-10-15T08:00:00Z');
      await log(alice, 'eodhd', 'TEST GET /api', '2026-10-15T09:10:00Z');
      await log(bob, 'tiingo', 'TEST GET /iex', '2026-10-15T09:20:00Z');
      await log(null, 'tiingo', 'GET /iex', '2026-10-15T09:40:00Z');
      await data.recordUserQuotes(
        alice,
        ['SPY', 'QQQ'].map((symbol) => ({
          provider: 'tiingo' as const,
          symbol,
          quoteCurrency: 'USD',
          bucketTs: NOW,
          price: '1',
          prevClose: null,
        })),
        NOW,
      );
    });
    expect(await asApp(() => jobs().lastRequests(alice))).toEqual({
      tiingo: new Date('2026-10-15T09:30:00Z'),
      eodhd: new Date('2026-10-15T09:10:00Z'),
    });
    expect(await asApp(() => jobs().testsSince(alice, 'tiingo', new Date('2026-10-15T08:42:00Z')))).toBe(1);
    expect(await asApp(() => jobs().testsSince(alice, 'finnhub', new Date('2026-10-15T08:42:00Z')))).toBe(0);
    expect(await asApp(() => jobs().quoteCounts(alice))).toEqual({ tiingo: 2 });
    expect(await asApp(() => jobs().quoteCounts(bob))).toEqual({});
  });
});

describe('provider state (market_provider_state)', () => {
  it('is kept by the worker and read by the app', async () => {
    expect(await asWorker(() => jobs().providerState('coinmarketcap'))).toBeNull();
    const state = {
      status: 'connected' as const,
      pausedUntil: null,
      quotaUsed: 101,
      quotaLimit: 15_000,
      quotaResetAt: new Date('2026-11-01T00:00:00Z'),
    };
    await asWorker(() => jobs().setProviderState('coinmarketcap', state, NOW));
    await asWorker(() =>
      jobs().setProviderState('coinmarketcap', { ...state, status: 'rate_limited', pausedUntil: NOW }, NOW),
    );
    await asWorker(() =>
      jobs().setProviderState(
        'fawazahmed0',
        { status: 'error', pausedUntil: null, quotaUsed: 0, quotaLimit: null, quotaResetAt: null },
        NOW,
      ),
    );
    expect(await asWorker(() => jobs().providerState('coinmarketcap'))).toEqual({
      ...state,
      status: 'rate_limited',
      pausedUntil: NOW,
    });
    expect(await asApp(() => jobs().providerStates())).toEqual([
      {
        provider: 'fawazahmed0',
        status: 'error',
        pausedUntil: null,
        quotaUsed: 0,
        quotaLimit: null,
        quotaResetAt: null,
        updatedAt: NOW,
      },
      { provider: 'coinmarketcap', ...state, status: 'rate_limited', pausedUntil: NOW, updatedAt: NOW },
    ]);
    await expect(asApp(() => jobs().setProviderState('coinmarketcap', state, NOW))).rejects.toMatchObject(
      pgError(/permission denied for table market_provider_state/),
    );
  });
});
