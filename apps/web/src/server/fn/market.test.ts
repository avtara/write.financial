// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import {
  getMarketApiLog,
  getMarketSettings,
  removeMarketKey,
  saveMarketKey,
  setMarketKeyActive,
  syncMarketSource,
  testMarketKey,
} from './market.ts';

const NOW = new Date('2026-10-15T05:05:00Z');
const AS_OF = new Date('2026-10-15T05:00:00Z');

const fake = vi.hoisted(() => {
  const result = (quotes: { symbol: string; price: string }[], failure: object | null = null) => ({
    quotes: quotes.map((quote) => ({
      ...quote,
      currency: 'IDR',
      prevClose: null,
      asOf: new Date('2026-10-15T05:00:00Z'),
    })),
    calls: [],
    failure,
    unverified: false,
    credits: null,
  });
  const credential = (provider: string) => ({
    provider,
    apiKey: 'fake-key',
    active: true,
    status: 'connected',
    quotaUsed: 0,
    quotaResetAt: null,
    retryAfter: null,
  });
  return {
    result,
    credential,
    config: { market: { cmcApiKey: null as string | null } },
    marketData: {
      recordUserQuotes: vi.fn(() => Promise.resolve()),
      logRequest: vi.fn(() => Promise.resolve()),
      apiLog: vi.fn(() =>
        Promise.resolve([
          { id: 'new', at: new Date('2026-10-15T05:00:00Z') },
          { id: 'old', at: new Date('2026-09-01T00:00:00Z') },
        ]),
      ),
    },
    marketCredentials: {
      list: vi.fn(() => Promise.resolve([] as object[])),
      save: vi.fn(() => Promise.resolve('saved')),
      setActive: vi.fn(() => Promise.resolve('active')),
      setStatus: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve({ quotesDeleted: 3 })),
    },
    marketJobs: {
      userTargets: vi.fn(() => Promise.resolve([] as object[])),
      credential: vi.fn((_: string, provider: string) => Promise.resolve(credential(provider) as object | null)),
      testsSince: vi.fn(() => Promise.resolve(0)),
      quoteCounts: vi.fn(() => Promise.resolve({ eodhd: 2 })),
      providerStates: vi.fn(() => Promise.resolve([])),
    },
    marketAdapters: {
      eodhd: {
        provider: 'eodhd',
        fetchQuotes: vi.fn(() => Promise.resolve(result([{ symbol: 'BBCA.JK', price: '8750' }]))),
      },
      marketstack: { provider: 'marketstack', fetchQuotes: vi.fn(() => Promise.resolve(result([]))) },
      tiingo: { provider: 'tiingo', fetchQuotes: vi.fn(() => Promise.resolve(result([]))) },
    },
  };
});

vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () =>
    Promise.resolve({
      config: fake.config,
      marketData: fake.marketData,
      marketCredentials: fake.marketCredentials,
      marketJobs: fake.marketJobs,
      marketAdapters: fake.marketAdapters,
      now: () => new Date('2026-10-15T05:05:00Z'),
    }),
}));

const USER_ID = fakeSession().user.id;
const signedIn = (twoFactorEnabled = true) => requestContext(fakeSession({ twoFactorEnabled }));
const parse = (fn: unknown, data: unknown): unknown => validatorOf(fn).parse(data);
const key = (provider: string, active = true) => ({ provider, active });
const idx = (symbol: string, serverAsOf: Date | null = null) => ({
  market: 'idx_equity',
  currency: 'IDR',
  symbols: { eodhd: symbol, marketstack: symbol },
  serverAsOf,
});

beforeEach(() => {
  vi.clearAllMocks();
  fake.marketJobs.userTargets.mockResolvedValue([]);
  fake.marketCredentials.list.mockResolvedValue([]);
  fake.marketJobs.testsSince.mockResolvedValue(0);
  fake.marketJobs.credential.mockImplementation((_: string, provider: string) =>
    Promise.resolve(fake.credential(provider)),
  );
});

describe('market settings', () => {
  it('reads the keys, saved prices, built-in sources, and symbols per market of the session user', async () => {
    fake.marketJobs.userTargets.mockResolvedValue([idx('BBCA'), idx('IHSG'), { ...idx('SPY'), market: 'us_equity' }]);
    expect(await call(getMarketSettings, { context: signedIn(false) })).toEqual({
      ok: true,
      value: {
        twoFactorEnabled: false,
        keys: [],
        quoteCounts: { eodhd: 2 },
        serverSources: [],
        cmcConfigured: false,
        symbolCounts: { idx_equity: 2, us_equity: 1 },
      },
    });
    expect(fake.marketJobs.userTargets).toHaveBeenCalledWith(USER_ID);
  });

  it('saves a key only with 2FA, and switches or deletes it', async () => {
    const input = parse(saveMarketKey, { provider: 'eodhd', apiKey: '  fake-eodhd-key  ' });
    expect(input).toEqual({ provider: 'eodhd', apiKey: 'fake-eodhd-key' });
    expect(await call(saveMarketKey, { context: signedIn(false), data: input })).toEqual({
      ok: false,
      code: 'TWO_FACTOR_REQUIRED',
    });
    expect(fake.marketCredentials.save).not.toHaveBeenCalled();
    expect(await call(saveMarketKey, { context: signedIn(), data: input })).toEqual({ ok: true, value: 'saved' });
    expect(fake.marketCredentials.save).toHaveBeenCalledWith(USER_ID, input);
    expect(() => parse(saveMarketKey, { provider: 'frankfurter', apiKey: 'fake-key' })).toThrow();
    expect(() => parse(saveMarketKey, { provider: 'eodhd', apiKey: 'abc' })).toThrow();
    expect(await call(setMarketKeyActive, { context: signedIn(), data: { provider: 'eodhd', active: false } })).toEqual(
      { ok: true, value: 'active' },
    );
    expect(fake.marketCredentials.setActive).toHaveBeenCalledWith(USER_ID, 'eodhd', false);
    expect(await call(removeMarketKey, { context: signedIn(), data: { provider: 'eodhd' } })).toEqual({
      ok: true,
      value: { quotesDeleted: 3 },
    });
    expect(fake.marketCredentials.remove).toHaveBeenCalledWith(USER_ID, 'eodhd');
  });

  it('keeps the last 30 days of the API log', async () => {
    expect(await call(getMarketApiLog, { context: signedIn(), data: {} })).toEqual({
      ok: true,
      value: [{ id: 'new', at: AS_OF }],
    });
    expect(fake.marketData.apiLog).toHaveBeenCalledWith(USER_ID, {});
    await call(getMarketApiLog, { context: signedIn(), data: { limit: 50 } });
    expect(fake.marketData.apiLog).toHaveBeenLastCalledWith(USER_ID, { limit: 50 });
  });
});

describe('testMarketKey', () => {
  it('asks the user’s own symbols of the provider’s market with the saved key and reports each', async () => {
    fake.marketJobs.userTargets.mockResolvedValue([
      idx('BBCA'),
      idx('TLKM'),
      idx('BBRI'),
      idx('ASII'),
      { ...idx('SPY'), market: 'us_equity' },
    ]);
    const answer = await call(testMarketKey, { context: signedIn(), data: { provider: 'eodhd' } });
    expect(fake.marketAdapters.eodhd.fetchQuotes).toHaveBeenCalledWith({
      apiKey: 'fake-key',
      requests: ['BBCA.JK', 'TLKM.JK', 'BBRI.JK'].map((symbol) => ({ symbol, currency: 'IDR' })),
      now: NOW,
    });
    expect(answer).toEqual({
      ok: true,
      value: {
        provider: 'eodhd',
        status: 'connected',
        pausedUntil: null,
        results: [
          { symbol: 'BBCA', currency: 'IDR', provider: 'eodhd', price: '8750', asOf: AS_OF },
          { symbol: 'TLKM', currency: 'IDR', provider: null, price: null, asOf: null },
          { symbol: 'BBRI', currency: 'IDR', provider: null, price: null, asOf: null },
        ],
      },
    });
    expect(fake.marketCredentials.setStatus).toHaveBeenCalledWith(
      USER_ID,
      'eodhd',
      expect.objectContaining({ status: 'connected', testedAt: NOW }),
    );
  });

  it('asks a well-known symbol when the user holds none in that market', async () => {
    await call(testMarketKey, { context: signedIn(), data: { provider: 'tiingo' } });
    expect(fake.marketAdapters.tiingo.fetchQuotes).toHaveBeenCalledWith(
      expect.objectContaining({ requests: [{ symbol: 'SPY', currency: 'USD' }] }),
    );
  });

  it('refuses without a key and after 5 tests in the hour', async () => {
    fake.marketJobs.credential.mockResolvedValue(null);
    expect(await call(testMarketKey, { context: signedIn(), data: { provider: 'eodhd' } })).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
    fake.marketJobs.credential.mockResolvedValue(fake.credential('eodhd'));
    fake.marketJobs.testsSince.mockResolvedValue(5);
    expect(await call(testMarketKey, { context: signedIn(), data: { provider: 'eodhd' } })).toEqual({
      ok: false,
      code: 'MARKET_TEST_LIMIT',
    });
    expect(fake.marketJobs.testsSince).toHaveBeenCalledWith(USER_ID, 'eodhd', new Date('2026-10-15T04:05:00Z'));
  });
});

describe('syncMarketSource', () => {
  it('needs nothing for a source the built-in cache prices, and a key otherwise', async () => {
    fake.marketJobs.userTargets.mockResolvedValue([{ ...idx('BTC', AS_OF), market: 'crypto' }]);
    expect(await call(syncMarketSource, { context: signedIn(), data: { market: 'crypto' } })).toEqual({
      ok: true,
      value: { market: 'crypto', status: 'cached', synced: 0, missing: 0, provider: null, pausedUntil: null },
    });
    fake.marketJobs.userTargets.mockResolvedValue([idx('BBCA')]);
    fake.marketCredentials.list.mockResolvedValue([key('tiingo'), key('eodhd', false)]);
    expect(await call(syncMarketSource, { context: signedIn(), data: { market: 'idx_equity' } })).toMatchObject({
      value: { status: 'no_key', missing: 1 },
    });
    expect(fake.marketJobs.userTargets).toHaveBeenCalledWith(USER_ID, { fetchedOnly: true });
    expect(() => parse(syncMarketSource, { market: 'fx' })).toThrow();
  });

  it('prices with the user’s keys in order and reports synced, partial, failed, and paused', async () => {
    fake.marketCredentials.list.mockResolvedValue([key('eodhd'), key('marketstack')]);
    fake.marketJobs.userTargets.mockResolvedValue([idx('BBCA')]);
    expect(await call(syncMarketSource, { context: signedIn(), data: { market: 'idx_equity' } })).toEqual({
      ok: true,
      value: { market: 'idx_equity', status: 'synced', synced: 1, missing: 0, provider: 'eodhd', pausedUntil: null },
    });
    fake.marketJobs.userTargets.mockResolvedValue([idx('BBCA'), idx('TLKM')]);
    expect(await call(syncMarketSource, { context: signedIn(), data: { market: 'idx_equity' } })).toMatchObject({
      value: { status: 'partial', synced: 1, missing: 1, provider: 'eodhd' },
    });
    fake.marketJobs.userTargets.mockResolvedValue([idx('TLKM')]);
    expect(await call(syncMarketSource, { context: signedIn(), data: { market: 'idx_equity' } })).toMatchObject({
      value: { status: 'failed', synced: 0, provider: null, pausedUntil: null },
    });
    const until = new Date('2026-10-15T06:00:00Z');
    fake.marketJobs.credential.mockImplementation((_: string, provider: string) =>
      Promise.resolve({ ...fake.credential(provider), retryAfter: until }),
    );
    expect(await call(syncMarketSource, { context: signedIn(), data: { market: 'idx_equity' } })).toMatchObject({
      value: { status: 'paused', pausedUntil: until },
    });
    // A 429 on the first key: paused until Retry-After, reported with the run.
    fake.marketJobs.credential.mockImplementation((_: string, provider: string) =>
      Promise.resolve(provider === 'eodhd' ? fake.credential(provider) : null),
    );
    fake.marketAdapters.eodhd.fetchQuotes.mockResolvedValueOnce(
      fake.result([], { status: 'rate_limited', retryAfter: '60', quotaResetAt: null, code: 'http_429' }),
    );
    expect(await call(syncMarketSource, { context: signedIn(), data: { market: 'idx_equity' } })).toMatchObject({
      value: { status: 'failed', pausedUntil: new Date('2026-10-15T05:06:00Z') },
    });
  });
});
