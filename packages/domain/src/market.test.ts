// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  BYOK_PROVIDERS,
  CREDENTIAL_STATUSES,
  EGRESS_ALLOWLIST,
  FALLBACK_ORDER,
  MARKETS,
  MARKET_PROVIDERS,
  MARKET_SESSIONS,
  PROVIDER_FEEDS,
  PROVIDER_QUOTAS,
  QUOTA_RESERVE_BPS,
  QUOTE_LABELS,
  QUOTE_SOURCES,
  SERVER_PROVIDERS,
  STALE_AFTER_MS,
  isEgressAllowed,
  rateLimitDecision,
  refreshPlan,
  resolveQuote,
  type MarketProvider,
  type QuoteInput,
} from './market.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const NOW = Date.UTC(2026, 9, 15, 9, 42);

describe('providers and enums', () => {
  it('lists the server, BYOK and all providers, and the statuses', () => {
    expect(SERVER_PROVIDERS).toEqual(['frankfurter', 'fawazahmed0', 'open_er_api', 'coinmarketcap']);
    expect(BYOK_PROVIDERS).toEqual([
      'tiingo',
      'finnhub',
      'massive',
      'alpha_vantage',
      'eodhd',
      'marketstack',
      'coinmarketcap',
      'coingecko',
      'goldapi',
      'metals_dev',
    ]);
    expect([...MARKET_PROVIDERS].sort()).toEqual([...new Set([...SERVER_PROVIDERS, ...BYOK_PROVIDERS])].sort());
    expect(QUOTE_SOURCES).toEqual(['byok', 'manual', 'server', 'computed', 'last']);
    expect(CREDENTIAL_STATUSES).toEqual([
      'untested',
      'connected',
      'unverified',
      'invalid_key',
      'quota_exhausted',
      'rate_limited',
      'error',
    ]);
    expect(MARKETS).toEqual([
      'fx',
      'us_equity',
      'idx_equity',
      'crypto',
      'gold_spot',
      'gold_antam',
      'mutual_fund',
      'sbn',
    ]);
  });

  it('never labels anything real-time', () => {
    expect(QUOTE_LABELS).toEqual(['delayed', 'close', 'manual', 'estimate', 'last']);
    expect(new Set(Object.values(PROVIDER_FEEDS))).toEqual(new Set(['delayed', 'close']));
    expect(PROVIDER_FEEDS.tiingo).toBe('delayed');
    expect(PROVIDER_FEEDS.massive).toBe('close');
  });
});

describe('FALLBACK_ORDER (FR-I6 table, research §2.8)', () => {
  const names = (market: keyof typeof FALLBACK_ORDER): string[] =>
    FALLBACK_ORDER[market].map((step) => (step.provider === null ? step.mode : `${step.mode}:${step.provider}`));

  it('follows the FR-I6 order per market', () => {
    expect(names('fx')).toEqual(['server:frankfurter', 'server:fawazahmed0', 'server:open_er_api', 'manual']);
    expect(names('us_equity')).toEqual(['byok:tiingo', 'byok:finnhub', 'byok:massive', 'byok:alpha_vantage', 'manual']);
    expect(names('idx_equity')).toEqual(['byok:eodhd', 'byok:marketstack', 'manual']);
    expect(names('crypto')).toEqual(['server:coinmarketcap', 'byok:coinmarketcap', 'byok:coingecko', 'manual']);
    expect(names('gold_spot')).toEqual(['server:fawazahmed0', 'byok:goldapi', 'byok:metals_dev', 'manual']);
    expect(names('gold_antam')).toEqual(['manual', 'computed']);
    expect(names('mutual_fund')).toEqual(['manual', 'computed']);
    expect(names('sbn')).toEqual(['computed', 'manual']);
  });

  it('only uses server sources as server and BYOK sources as BYOK, never a prohibited host', () => {
    for (const market of MARKETS) {
      for (const step of FALLBACK_ORDER[market]) {
        if (step.mode === 'server') expect(SERVER_PROVIDERS).toContain(step.provider);
        else if (step.mode === 'byok') expect(BYOK_PROVIDERS).toContain(step.provider);
        else expect(step.provider).toBeNull();
      }
    }
    const hosts = Object.values(EGRESS_ALLOWLIST).flat().join(' ');
    for (const banned of [
      'yahoo',
      'stooq',
      'twelvedata',
      'financialmodelingprep',
      'indodax',
      'pasardana',
      'bareksa',
      'bibit',
      'logammulia',
      'idx.co.id',
      'bi.go.id',
    ]) {
      expect(hosts).not.toContain(banned);
    }
  });
});

describe('resolveQuote (manual lock → computed → BYOK → server → manual → last)', () => {
  const base: QuoteInput = {
    market: 'us_equity',
    priceMode: 'byok',
    manual: null,
    computed: null,
    byok: [],
    server: null,
    last: null,
    now: NOW,
  };
  const tiingo = { provider: 'tiingo', price: '690.10', prevClose: '686.20', asOf: NOW - 5 * MINUTE } as const;
  const finnhub = { provider: 'finnhub', price: '690.00', prevClose: null, asOf: NOW - MINUTE } as const;
  const manual = { price: '680', prevClose: null, asOf: NOW - 10 * DAY };

  it('uses the first fresh BYOK result in the user order, labelled "tertunda"', () => {
    expect(resolveQuote({ ...base, byok: [tiingo, finnhub] })).toEqual({
      ...tiingo,
      source: 'byok',
      stale: false,
      label: 'delayed',
    });
    const staleTiingo = { ...tiingo, asOf: NOW - 5 * DAY };
    expect(resolveQuote({ ...base, byok: [staleTiingo, finnhub] })).toMatchObject({
      provider: 'finnhub',
      source: 'byok',
    });
  });

  it('honours a manual lock and computed prices before any fetched quote', () => {
    expect(resolveQuote({ ...base, priceMode: 'manual', manual, byok: [tiingo] })).toEqual({
      ...manual,
      source: 'manual',
      provider: null,
      stale: true,
      label: 'manual',
    });
    const computed = { price: '2572028', prevClose: null, asOf: NOW };
    expect(resolveQuote({ ...base, market: 'gold_antam', priceMode: 'computed', computed })).toEqual({
      ...computed,
      source: 'computed',
      provider: null,
      stale: false,
      label: 'estimate',
    });
    // Typed and computed prices only win in their own mode (or as the manual fallback).
    expect(resolveQuote({ ...base, manual, computed, byok: [tiingo] })?.source).toBe('byok');
    // The modes need their value; without it the chain goes on.
    expect(resolveQuote({ ...base, priceMode: 'manual', byok: [tiingo] })?.source).toBe('byok');
    expect(resolveQuote({ ...base, priceMode: 'computed', byok: [tiingo] })?.source).toBe('byok');
  });

  it('falls back to the server, then a typed price, then the newest stale quote with its date', () => {
    const cmc = { provider: 'coinmarketcap', price: '1460000000', prevClose: null, asOf: NOW - 5 * MINUTE } as const;
    expect(resolveQuote({ ...base, market: 'crypto', server: cmc })).toMatchObject({
      source: 'server',
      label: 'delayed',
      stale: false,
    });
    const old = { ...cmc, asOf: NOW - 2 * 60 * MINUTE };
    expect(resolveQuote({ ...base, market: 'crypto', server: old, manual })).toMatchObject({
      source: 'manual',
      label: 'manual',
    });
    const last = { provider: 'tiingo', price: '600', prevClose: null, asOf: NOW - 6 * DAY } as const;
    const olderByok = { ...tiingo, asOf: NOW - 9 * DAY };
    expect(resolveQuote({ ...base, byok: [olderByok], last })).toEqual({
      ...last,
      source: 'last',
      stale: true,
      label: 'last',
    });
    expect(resolveQuote({ ...base, byok: [{ ...tiingo, asOf: NOW - 5 * DAY }], last })).toMatchObject({
      price: '690.10',
      source: 'last',
    });
    expect(resolveQuote({ ...base, server: { ...cmc, asOf: NOW - 5 * DAY } })).toMatchObject({
      provider: 'coinmarketcap',
      source: 'last',
    });
    expect(resolveQuote(base)).toBeNull();
  });

  it('prefers the earlier source among equally old stale quotes', () => {
    const old = { ...tiingo, asOf: NOW - 9 * DAY };
    const last = { ...old, price: '1' };
    expect(resolveQuote({ ...base, byok: [old], last })).toMatchObject({ price: '690.10', source: 'last' });
  });

  it('counts a quote exactly at the threshold as fresh', () => {
    const atLimit = { ...tiingo, asOf: NOW - STALE_AFTER_MS.us_equity };
    expect(resolveQuote({ ...base, byok: [atLimit] })?.stale).toBe(false);
    expect(resolveQuote({ ...base, byok: [{ ...atLimit, asOf: atLimit.asOf - 1 }] })?.stale).toBe(true);
    expect(STALE_AFTER_MS).toEqual({
      fx: 4 * DAY,
      us_equity: 4 * DAY,
      idx_equity: 4 * DAY,
      crypto: 60 * MINUTE,
      gold_spot: 4 * DAY,
      gold_antam: 4 * DAY,
      mutual_fund: 7 * DAY,
      sbn: 31 * DAY,
    });
  });
});

describe('refreshPlan (FR-ST4 frequency within the free quota, research §2.9)', () => {
  it('matches the research table', () => {
    expect(QUOTA_RESERVE_BPS).toBe(1000);
    expect(refreshPlan('tiingo', 'us_equity', 15)).toEqual({
      intervalMinutes: 15,
      refreshesPerDay: 26,
      callsPerRefresh: 1,
      callsPerDay: 26,
      callsPerMonth: 598,
    });
    expect(refreshPlan('finnhub', 'us_equity', 15)).toEqual({
      intervalMinutes: 15,
      refreshesPerDay: 26,
      callsPerRefresh: 15,
      callsPerDay: 390,
      callsPerMonth: 8970,
    });
    expect(refreshPlan('massive', 'us_equity', 15)).toEqual({
      intervalMinutes: null,
      refreshesPerDay: 1,
      callsPerRefresh: 1,
      callsPerDay: 1,
      callsPerMonth: 23,
    });
    expect(refreshPlan('alpha_vantage', 'us_equity', 15)).toEqual({
      intervalMinutes: null,
      refreshesPerDay: 1,
      callsPerRefresh: 15,
      callsPerDay: 15,
      callsPerMonth: 345,
    });
    expect(refreshPlan('eodhd', 'idx_equity', 4)).toEqual({
      intervalMinutes: null,
      refreshesPerDay: 4,
      callsPerRefresh: 4,
      callsPerDay: 16,
      callsPerMonth: 368,
    });
    expect(refreshPlan('marketstack', 'idx_equity', 4)).toEqual({
      intervalMinutes: null,
      refreshesPerDay: 1,
      callsPerRefresh: 1,
      callsPerDay: 1,
      callsPerMonth: 23,
    });
    expect(refreshPlan('coinmarketcap', 'crypto', 3)).toEqual({
      intervalMinutes: 5,
      refreshesPerDay: 288,
      callsPerRefresh: 1,
      callsPerDay: 288,
      callsPerMonth: 8928,
    });
    expect(refreshPlan('coingecko', 'crypto', 3)).toEqual({
      intervalMinutes: 10,
      refreshesPerDay: 144,
      callsPerRefresh: 1,
      callsPerDay: 144,
      callsPerMonth: 4464,
    });
    expect(refreshPlan('goldapi', 'gold_spot', 1)).toEqual({
      intervalMinutes: null,
      refreshesPerDay: 2,
      callsPerRefresh: 1,
      callsPerDay: 2,
      callsPerMonth: 62,
    });
    expect(refreshPlan('metals_dev', 'gold_spot', 1)).toMatchObject({ refreshesPerDay: 2 });
  });

  it('slows down as symbols grow and gives up when nothing fits', () => {
    expect(refreshPlan('tiingo', 'us_equity', 1000)).toMatchObject({ intervalMinutes: 15, callsPerRefresh: 10 });
    expect(refreshPlan('tiingo', 'us_equity', 1200)).toMatchObject({
      intervalMinutes: 30,
      refreshesPerDay: 13,
      callsPerRefresh: 12,
    });
    expect(refreshPlan('eodhd', 'idx_equity', 6)).toMatchObject({ refreshesPerDay: 3, callsPerDay: 18 });
    expect(refreshPlan('eodhd', 'idx_equity', 18)).toMatchObject({ refreshesPerDay: 1, callsPerDay: 18 });
    expect(refreshPlan('eodhd', 'idx_equity', 19)).toBeNull();
    expect(refreshPlan('alpha_vantage', 'us_equity', 22)).toMatchObject({ callsPerDay: 22 });
    // End-of-day providers refresh once even when more would fit.
    expect(refreshPlan('alpha_vantage', 'us_equity', 5)).toMatchObject({ refreshesPerDay: 1, callsPerDay: 5 });
    // Exactly the hourly allowance (45 of 50): hourly refreshes.
    expect(refreshPlan('tiingo', 'us_equity', 4500)).toEqual({
      intervalMinutes: 60,
      refreshesPerDay: 6,
      callsPerRefresh: 45,
      callsPerDay: 270,
      callsPerMonth: 6210,
    });
    expect(refreshPlan('tiingo', 'us_equity', 4501)).toBeNull();
    expect(refreshPlan('alpha_vantage', 'us_equity', 23)).toBeNull();
    expect(refreshPlan('finnhub', 'us_equity', 54)).toMatchObject({ intervalMinutes: 15 });
    expect(refreshPlan('finnhub', 'us_equity', 55)).toBeNull();
    expect(refreshPlan('goldapi', 'gold_spot', 3)).toBeNull();
    expect(refreshPlan('goldapi', 'gold_spot', 2)).toMatchObject({ refreshesPerDay: 1, callsPerMonth: 62 });
    expect(() => refreshPlan('tiingo', 'us_equity', 0)).toThrow('Symbol count must be ≥ 1: 0');
    expect(() => refreshPlan('tiingo', 'us_equity', 1.5)).toThrow(RangeError);
  });

  it('describes every BYOK provider and market', () => {
    expect(Object.keys(PROVIDER_QUOTAS).sort()).toEqual([...BYOK_PROVIDERS].sort());
    expect(MARKET_SESSIONS).toEqual({
      fx: { minutesPerDay: 1440, daysPerMonth: 31 },
      us_equity: { minutesPerDay: 390, daysPerMonth: 23 },
      idx_equity: { minutesPerDay: 435, daysPerMonth: 23 },
      crypto: { minutesPerDay: 1440, daysPerMonth: 31 },
      gold_spot: { minutesPerDay: 1440, daysPerMonth: 31 },
      gold_antam: { minutesPerDay: 1440, daysPerMonth: 31 },
      mutual_fund: { minutesPerDay: 1440, daysPerMonth: 31 },
      sbn: { minutesPerDay: 1440, daysPerMonth: 31 },
    });
    expect(PROVIDER_QUOTAS.tiingo).toEqual({
      symbolsPerCall: 100,
      perMinute: null,
      perHour: 50,
      perDay: 1000,
      perMonth: null,
      minIntervalMinutes: 15,
      eodOnly: false,
    });
  });
});

describe('rateLimitDecision (429 → pause until retry-after, then fall back)', () => {
  const input = { retryAfter: null, quotaResetAt: null, attempt: 0, now: NOW };

  it('honours Retry-After in seconds or as an HTTP date (KR0zN "retry-after 30 dtk")', () => {
    expect(rateLimitDecision({ ...input, retryAfter: '30' })).toEqual({
      pauseUntil: NOW + 30_000,
      status: 'rate_limited',
      fallBack: true,
    });
    expect(rateLimitDecision({ ...input, retryAfter: ' 30 ' }).pauseUntil).toBe(NOW + 30_000);
    expect(rateLimitDecision({ ...input, retryAfter: '0' }).pauseUntil).toBe(NOW);
    for (const unreadable of ['30x', 'x30', 'soon', '']) {
      expect(rateLimitDecision({ ...input, retryAfter: unreadable }).pauseUntil).toBe(NOW + MINUTE);
    }
    const date = new Date(NOW + 120_000).toUTCString();
    expect(rateLimitDecision({ ...input, retryAfter: date }).pauseUntil).toBe(NOW + 120_000);
    expect(rateLimitDecision({ ...input, retryAfter: new Date(NOW - 120_000).toUTCString() }).pauseUntil).toBe(NOW);
  });

  it('pauses until the quota resets ("Kuota habis s.d. …") without Retry-After', () => {
    expect(rateLimitDecision({ ...input, quotaResetAt: NOW + DAY })).toEqual({
      pauseUntil: NOW + DAY,
      status: 'quota_exhausted',
      fallBack: true,
    });
    expect(rateLimitDecision({ ...input, retryAfter: 'soon', quotaResetAt: NOW + DAY }).status).toBe('quota_exhausted');
  });

  it('backs off exponentially otherwise, at most an hour', () => {
    expect(rateLimitDecision(input)).toEqual({ pauseUntil: NOW + MINUTE, status: 'rate_limited', fallBack: true });
    expect(rateLimitDecision({ ...input, retryAfter: '' }).pauseUntil).toBe(NOW + MINUTE);
    expect(rateLimitDecision({ ...input, quotaResetAt: NOW }).pauseUntil).toBe(NOW + MINUTE);
    expect(rateLimitDecision({ ...input, attempt: 3 }).pauseUntil).toBe(NOW + 8 * MINUTE);
    expect(rateLimitDecision({ ...input, attempt: 10 }).pauseUntil).toBe(NOW + 60 * MINUTE);
    expect(rateLimitDecision({ ...input, attempt: -2 }).pauseUntil).toBe(NOW + MINUTE);
  });
});

describe('isEgressAllowed (egress allowlist the adapters must use)', () => {
  it('allows each provider only its own HTTPS hosts', () => {
    expect(isEgressAllowed('frankfurter', 'https://api.frankfurter.dev/v2/rate/usd/idr')).toBe(true);
    expect(
      isEgressAllowed(
        'fawazahmed0',
        'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
      ),
    ).toBe(true);
    expect(isEgressAllowed('fawazahmed0', 'https://latest.currency-api.pages.dev/v1/currencies/xau.min.json')).toBe(
      true,
    );
    expect(isEgressAllowed('fawazahmed0', 'https://2026-10-16.currency-api.pages.dev/v1/currencies/xau.json')).toBe(
      true,
    );
    expect(isEgressAllowed('tiingo', 'https://api.tiingo.com/iex/?tickers=spy')).toBe(true);
    expect(isEgressAllowed('tiingo', 'https://finnhub.io/api/v1/quote')).toBe(false);
    expect(isEgressAllowed('finnhub', 'https://finnhub.io/api/v1/quote?symbol=SPY')).toBe(true);
    // research §3 test endpoints
    const samples: [MarketProvider, string][] = [
      ['open_er_api', 'https://open.er-api.com/v6/latest/USD'],
      ['coinmarketcap', 'https://pro-api.coinmarketcap.com/v1/key/info'],
      ['massive', 'https://api.massive.com/v1/marketstatus/now'],
      ['alpha_vantage', 'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=SPY'],
      ['eodhd', 'https://eodhd.com/api/eod/BBCA.JK?fmt=json'],
      ['marketstack', 'https://api.marketstack.com/v2/eod/latest?symbols=AAPL'],
      ['coingecko', 'https://api.coingecko.com/api/v3/ping'],
      ['goldapi', 'https://www.goldapi.io/api/stat'],
      ['metals_dev', 'https://api.metals.dev/usage'],
    ];
    for (const [provider, url] of samples) {
      expect(isEgressAllowed(provider, url)).toBe(true);
      expect(isEgressAllowed(provider === 'eodhd' ? 'tiingo' : 'eodhd', url)).toBe(false);
    }
  });

  it('refuses other schemes, ports, credentials, lookalike hosts and garbage', () => {
    expect(isEgressAllowed('tiingo', 'http://api.tiingo.com/api/test')).toBe(false);
    expect(isEgressAllowed('tiingo', 'https://api.tiingo.com:8443/api/test')).toBe(false);
    expect(isEgressAllowed('tiingo', 'https://user@api.tiingo.com/')).toBe(false);
    expect(isEgressAllowed('tiingo', 'https://user:pw@api.tiingo.com/')).toBe(false);
    expect(isEgressAllowed('tiingo', 'https://:pw@api.tiingo.com/')).toBe(false);
    expect(isEgressAllowed('tiingo', 'https://api.tiingo.com.evil.example/')).toBe(false);
    expect(isEgressAllowed('tiingo', 'https://evilapi.tiingo.com/')).toBe(false);
    expect(isEgressAllowed('fawazahmed0', 'https://currency-api.pages.dev/')).toBe(false);
    expect(isEgressAllowed('fawazahmed0', 'https://.currency-api.pages.dev/')).toBe(false);
    expect(isEgressAllowed('fawazahmed0', 'https://a.b.currency-api.pages.dev/')).toBe(false);
    expect(isEgressAllowed('fawazahmed0', 'https://evilcurrency-api.pages.dev/')).toBe(false);
    expect(isEgressAllowed('finnhub', 'not a url')).toBe(false);
    expect(isEgressAllowed('finnhub', 'https://query1.finance.yahoo.com/v8/finance/chart/SPY')).toBe(false);
  });

  it('has an allowlist for every provider', () => {
    expect(Object.keys(EGRESS_ALLOWLIST).sort()).toEqual([...MARKET_PROVIDERS].sort());
    expect(EGRESS_ALLOWLIST.coinmarketcap).toEqual(['pro-api.coinmarketcap.com']);
  });
});
