// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { withUser } from './db.ts';
import { createMarketData, deleteUserQuotesIn, effectiveQuotesIn, providerSymbol } from './market-data.ts';

let test: TestDatabase;
let alice: string;
let bob: string;

const NOW = new Date('2026-10-15T09:42:00Z');
const repo = () => createMarketData(test.db, { now: () => NOW });
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const asWorker = <T>(fn: () => Promise<T>) => test.as('wf_worker', fn);
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

/** An asset of `userId` on a fresh investment account; returns its id. */
async function asset(
  userId: string,
  values: {
    symbol: string;
    currency?: string;
    market: string;
    mode?: string;
    manual?: string;
    premium?: number;
    meta?: string;
  },
): Promise<string> {
  const [account] = await test.query<{ id: string }>(
    `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_date, color)
     VALUES ($1, 'investment', 'P', 'P', $2, '2026-01-01', 'cyan') RETURNING id`,
    [userId, values.currency ?? 'USD'],
  );
  const [row] = await test.query<{ id: string }>(
    `INSERT INTO assets (user_id, account_id, symbol, name, quote_currency, asset_class, market, price_mode,
                         manual_price, manual_price_at, premium_bps, meta)
     VALUES ($1, $2, $3, $3, $4, 'us_stocks', $5, $6, $7, $8, $9, $10::jsonb) RETURNING id`,
    [
      userId,
      account?.id,
      values.symbol,
      values.currency ?? 'USD',
      values.market,
      values.mode ?? (values.manual === undefined ? 'server' : 'manual'),
      values.manual ?? null,
      values.manual === undefined ? null : minutesAgo(60),
      values.premium ?? null,
      values.meta ?? '{}',
    ],
  );
  return row?.id as string;
}

const key = (userId: string, provider: string) =>
  test.query(
    `INSERT INTO market_credentials (user_id, provider, api_key_enc, last4) VALUES ($1, $2, '\\x01', 'abcd')`,
    [userId, provider],
  );

beforeEach(async () => {
  await test.query('DELETE FROM users');
  await test.query('DELETE FROM market_quotes');
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
});

describe('providerSymbol', () => {
  it('uses meta.symbols[provider], else the ticker', () => {
    const bbca = { symbol: 'BBCA', meta: { symbols: { eodhd: 'BBCA.JK', marketstack: '' } } };
    expect(providerSymbol(bbca, 'eodhd')).toBe('BBCA.JK');
    expect(providerSymbol(bbca, 'marketstack')).toBe('BBCA');
    expect(providerSymbol(bbca, 'tiingo')).toBe('BBCA');
    expect(providerSymbol({ symbol: 'X', meta: { symbols: ['eodhd'] } }, 'eodhd')).toBe('X');
    expect(providerSymbol({ symbol: 'X', meta: { symbols: null } }, 'eodhd')).toBe('X');
    expect(providerSymbol({ symbol: 'X', meta: {} }, 'eodhd')).toBe('X');
  });
});

describe('quotes (FR-I5, FR-I6 resolution)', () => {
  it('takes the user’s fresh BYOK result first (in fallback order, keys only), then built-in, then manual', async () => {
    const spy = await asset(alice, { symbol: 'SPY', market: 'us_equity', manual: '680', mode: 'byok' });
    const btc = await asset(alice, { symbol: 'BTC', currency: 'IDR', market: 'crypto' });
    const qqq = await asset(alice, { symbol: 'QQQ', market: 'us_equity', manual: '600.5', mode: 'byok' });
    await key(alice, 'finnhub');
    await asWorker(async () => {
      await repo().recordUserQuotes(
        alice,
        [
          // Tiingo first in the order, but Alice has no Tiingo key (any more): ignored.
          {
            provider: 'tiingo',
            symbol: 'SPY',
            quoteCurrency: 'USD',
            bucketTs: minutesAgo(15),
            price: '700',
            prevClose: null,
          },
          {
            provider: 'finnhub',
            symbol: 'SPY',
            quoteCurrency: 'USD',
            bucketTs: minutesAgo(30),
            price: '690.10',
            prevClose: '686.20',
          },
          {
            provider: 'finnhub',
            symbol: 'SPY',
            quoteCurrency: 'USD',
            bucketTs: minutesAgo(45),
            price: '689',
            prevClose: null,
          },
        ],
        NOW,
      );
      await repo().recordServerQuotes(
        [
          {
            provider: 'coinmarketcap',
            symbol: 'BTC',
            quoteCurrency: 'IDR',
            bucketTs: minutesAgo(5),
            price: '1460000000',
            prevClose: '1450000000',
            sourceAttr: 'CMC',
          },
        ],
        NOW,
      );
    });
    const quotes = await asApp(() => repo().quotes(alice));
    expect(quotes.get(spy)).toEqual({
      price: '690.1',
      prevClose: '686.2',
      source: 'byok',
      provider: 'finnhub',
      asOf: minutesAgo(30).getTime(),
      stale: false,
      label: 'delayed',
    });
    expect(quotes.get(btc)).toMatchObject({ source: 'server', provider: 'coinmarketcap', price: '1460000000' });
    // No fetched quote at all: the typed price.
    expect(quotes.get(qqq)).toMatchObject({ source: 'manual', price: '600.5', label: 'manual' });
    // Only the asked-for assets; another user's assets are not visible.
    expect([...(await asApp(() => repo().quotes(alice, [btc]))).keys()]).toEqual([btc]);
    expect((await asApp(() => repo().quotes(bob))).size).toBe(0);
  });

  it('locks a manual price, estimates Antam from spot + premium, and returns null with nothing known', async () => {
    const locked = await asset(alice, { symbol: 'SGOV', market: 'us_equity', manual: '100.48', mode: 'manual' });
    const antam = await asset(alice, {
      symbol: 'ANTAM',
      currency: 'IDR',
      market: 'gold_antam',
      mode: 'computed',
      premium: 650,
    });
    const bare = await asset(alice, { symbol: 'IDX30', currency: 'IDR', market: 'mutual_fund', mode: 'computed' });
    await key(alice, 'tiingo');
    await asWorker(async () => {
      await repo().recordUserQuotes(
        alice,
        [
          {
            provider: 'tiingo',
            symbol: 'SGOV',
            quoteCurrency: 'USD',
            bucketTs: minutesAgo(1),
            price: '101',
            prevClose: null,
          },
        ],
        NOW,
      );
      // fawazahmed0 XAU→IDR per troy ounce.
      await repo().recordServerQuotes(
        [
          {
            provider: 'fawazahmed0',
            symbol: 'XAU',
            quoteCurrency: 'IDR',
            bucketTs: minutesAgo(600),
            price: '75442309',
            prevClose: null,
          },
        ],
        NOW,
      );
    });
    const quotes = await asApp(() => repo().quotes(alice));
    expect(quotes.get(locked)).toMatchObject({ source: 'manual', price: '100.48' });
    expect(quotes.get(antam)).toMatchObject({ source: 'computed', label: 'estimate', stale: false });
    expect(Number(quotes.get(antam)?.price)).toBeCloseTo((75_442_309 / 31.1034768) * 1.065, 3);
    expect(quotes.get(bare)).toBeNull();
  });

  it('falls back to the newest stale quote, labelled "last"', async () => {
    const spy = await asset(alice, { symbol: 'SPY', market: 'us_equity' });
    await key(alice, 'tiingo');
    await asWorker(() =>
      repo().recordUserQuotes(
        alice,
        [
          {
            provider: 'tiingo',
            symbol: 'SPY',
            quoteCurrency: 'USD',
            bucketTs: minutesAgo(10 * 24 * 60),
            price: '650',
            prevClose: null,
          },
        ],
        NOW,
      ),
    );
    expect((await asApp(() => repo().quotes(alice))).get(spy)).toMatchObject({
      source: 'last',
      stale: true,
      price: '650',
    });
  });

  it('takes the first built-in source of the market’s order (real clock by default)', async () => {
    const usd = await asset(alice, { symbol: 'USD', currency: 'IDR', market: 'fx' });
    const sgd = await asset(alice, { symbol: 'SGD', currency: 'IDR', market: 'fx' });
    const fresh = new Date(Date.now() - 60_000);
    await asWorker(() =>
      repo().recordServerQuotes(
        [
          {
            provider: 'fawazahmed0',
            symbol: 'USD',
            quoteCurrency: 'IDR',
            bucketTs: fresh,
            price: '16360',
            prevClose: null,
          },
          {
            provider: 'frankfurter',
            symbol: 'USD',
            quoteCurrency: 'IDR',
            bucketTs: fresh,
            price: '16350',
            prevClose: null,
          },
          {
            provider: 'fawazahmed0',
            symbol: 'SGD',
            quoteCurrency: 'IDR',
            bucketTs: fresh,
            price: '12500',
            prevClose: null,
          },
        ],
        fresh,
      ),
    );
    const quotes = await asApp(() => createMarketData(test.db).quotes(alice));
    expect(quotes.get(usd)).toMatchObject({ source: 'server', provider: 'frankfurter', price: '16350' });
    expect(quotes.get(sgd)).toMatchObject({ source: 'server', provider: 'fawazahmed0', price: '12500' });
  });

  it('resolves nothing for an empty list', async () => {
    expect(await withUser(test.db, alice, (tx) => effectiveQuotesIn(tx, [], NOW))).toEqual(new Map());
  });
});

describe('setManualPrice', () => {
  it('stores the price and its date, and locks it on request', async () => {
    const spy = await asset(alice, { symbol: 'SPY', market: 'us_equity' });
    await asApp(() => repo().setManualPrice(alice, spy, { price: '690.100', at: minutesAgo(5) }));
    expect(await test.query(`SELECT manual_price::text AS price, price_mode AS mode FROM assets`)).toEqual([
      { price: '690.100000000000000000', mode: 'server' },
    ]);
    await asApp(() => repo().setManualPrice(alice, spy, { price: '691', at: minutesAgo(1), lock: true }));
    expect((await asApp(() => repo().quotes(alice))).get(spy)).toMatchObject({ source: 'manual', price: '691' });
  });

  it('refuses another user’s asset and prices that are not positive decimals', async () => {
    const spy = await asset(alice, { symbol: 'SPY', market: 'us_equity' });
    await expect(asApp(() => repo().setManualPrice(bob, spy, { price: '1', at: NOW }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    for (const price of ['abc', '0', '-1']) {
      await expect(asApp(() => repo().setManualPrice(alice, spy, { price, at: NOW }))).rejects.toMatchObject({
        code: 'INVALID_ASSET',
      });
    }
  });
});

describe('worker writes', () => {
  it('upserts built-in quotes per slot and skips an empty batch', async () => {
    const quote = {
      provider: 'frankfurter',
      symbol: 'USD',
      quoteCurrency: 'IDR',
      bucketTs: minutesAgo(60),
      prevClose: null,
    } as const;
    await asWorker(async () => {
      await repo().recordServerQuotes([], NOW);
      await repo().recordServerQuotes([{ ...quote, price: '16350' }], NOW);
      await repo().recordServerQuotes([{ ...quote, price: '16351', prevClose: '16300', sourceAttr: 'BI' }], NOW);
    });
    expect(
      await test.query(`SELECT price::text AS price, prev_close::text AS prev, source_attr AS attr FROM market_quotes`),
    ).toEqual([{ price: '16351.000000000000000000', prev: '16300.000000000000000000', attr: 'BI' }]);
    await expect(asWorker(() => repo().recordServerQuotes([{ ...quote, price: '0' }], NOW))).rejects.toMatchObject({
      code: 'INVALID_ASSET',
    });
  });

  it('upserts BYOK results for the user only, refusing built-in providers', async () => {
    const quote = { provider: 'eodhd', symbol: 'BBCA.JK', quoteCurrency: 'IDR', bucketTs: minutesAgo(60) } as const;
    await asWorker(async () => {
      await repo().recordUserQuotes(alice, [{ ...quote, price: '8000', prevClose: '7950' }], NOW);
      await repo().recordUserQuotes(alice, [{ ...quote, price: '8025', prevClose: null }], NOW);
    });
    expect(await test.query(`SELECT user_id, price::text AS price, prev_close FROM user_quotes`)).toEqual([
      { user_id: alice, price: '8025.000000000000000000', prev_close: null },
    ]);
    await expect(
      asWorker(() =>
        repo().recordUserQuotes(
          alice,
          [{ ...quote, provider: 'frankfurter' as 'eodhd', price: '1', prevClose: null }],
          NOW,
        ),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_MARKET_CREDENTIAL' });
    expect(await asApp(() => withUser(test.db, alice, (tx) => deleteUserQuotesIn(tx, 'eodhd')))).toBe(1);
  });
});

describe('apiLog', () => {
  it('lists the user’s requests and the built-in fetches, newest first, never another user’s', async () => {
    const entry = { endpoint: 'https://api.tiingo.com/iex?token=***', httpStatus: 200, ok: true, durationMs: 120 };
    await asWorker(async () => {
      await repo().logRequest(null, { ...entry, provider: 'frankfurter', at: minutesAgo(30) });
      await repo().logRequest(bob, { ...entry, provider: 'tiingo', at: minutesAgo(20) });
    });
    await asApp(() =>
      repo().logRequest(alice, {
        ...entry,
        provider: 'coingecko',
        httpStatus: 429,
        ok: false,
        retry: 1,
        errorCode: 'rate_limited',
        at: minutesAgo(10),
      }),
    );
    const log = await asApp(() => repo().apiLog(alice));
    expect(log.map((row) => [row.provider, row.own, row.httpStatus, row.retry, row.errorCode])).toEqual([
      ['coingecko', true, 429, 1, 'rate_limited'],
      ['frankfurter', false, 200, 0, null],
    ]);
    expect(await asApp(() => repo().apiLog(alice, { limit: 0 }))).toHaveLength(1);
  });
});
