// SPDX-License-Identifier: AGPL-3.0-only
import type { ByokProvider, Market, ServerProvider } from '@wf/domain/market';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketAdapters } from './adapters.ts';
import type { AdapterFailure, AdapterResult, FetchQuotesInput, MarketAdapter, MarketCall } from './http.ts';
import {
  CMC_MONTHLY_CREDITS,
  quotaWindow,
  requestSymbol,
  runByokProvider,
  syncByokMarket,
  syncServerProvider,
  TEST_ENDPOINT_PREFIX,
  type ByokPorts,
  type CredentialUpdate,
  type MarketTarget,
  type ProviderState,
  type ServerPorts,
  type StoredCredential,
} from './sync.ts';

const NOW = new Date('2026-10-15T09:42:00Z');
const USER = '0192a6c0-0000-7000-8000-000000000001';
const AS_OF = new Date('2026-10-15T09:15:42Z');

const call = (provider: MarketCall['provider'], errorCode: string | null = null): MarketCall => ({
  provider,
  endpoint: 'GET /x',
  httpStatus: errorCode === null ? 200 : 429,
  ok: errorCode === null,
  durationMs: 5,
  errorCode,
});

type FakeAdapter = MarketAdapter & { inputs: FetchQuotesInput[] };

/** An adapter answering `prices` (request symbol → price) for the asked symbols, failing with `failure`. */
function fakeAdapter(
  provider: MarketAdapter['provider'],
  prices: Record<string, string>,
  extra: { failure?: AdapterFailure; unverified?: boolean; credits?: number; calls?: number } = {},
): FakeAdapter {
  const inputs: FetchQuotesInput[] = [];
  return {
    provider,
    inputs,
    fetchQuotes: (input) => {
      inputs.push(input);
      const result: AdapterResult = {
        quotes: input.requests.flatMap((request) => {
          const price = prices[request.symbol];
          return price === undefined ? [] : [{ ...request, price, prevClose: null, asOf: AS_OF }];
        }),
        calls: Array.from({ length: extra.calls ?? 1 }, () => call(provider, extra.failure?.code ?? null)),
        failure: extra.failure ?? null,
        unverified: extra.unverified ?? false,
        credits: extra.credits ?? null,
      };
      return Promise.resolve(result);
    },
  };
}

const credential = (provider: ByokProvider, overrides: Partial<StoredCredential> = {}): StoredCredential => ({
  provider,
  apiKey: `fake-${provider}-key`,
  active: true,
  status: 'connected',
  quotaUsed: 0,
  quotaResetAt: null,
  retryAfter: null,
  ...overrides,
});

const target = (
  market: Market,
  symbol: string,
  currency: string,
  symbols: Record<string, string> = {},
): MarketTarget => ({
  market,
  currency,
  symbols: {
    tiingo: symbol,
    finnhub: symbol,
    eodhd: symbol,
    marketstack: symbol,
    coinmarketcap: symbol,
    coingecko: symbol,
    ...symbols,
  },
  serverAsOf: null,
});

function byokPorts(credentials: StoredCredential[]) {
  const updates: [ByokProvider, CredentialUpdate][] = [];
  const ports = {
    credential: vi.fn((_: string, provider: ByokProvider) =>
      Promise.resolve(credentials.find((entry) => entry.provider === provider) ?? null),
    ),
    setStatus: vi.fn((_: string, provider: ByokProvider, update: CredentialUpdate) => {
      updates.push([provider, update]);
      return Promise.resolve();
    }),
    recordUserQuotes: vi.fn(() => Promise.resolve()),
    logRequest: vi.fn(() => Promise.resolve()),
  } satisfies ByokPorts;
  return { ports, updates };
}

describe('requestSymbol and quotaWindow', () => {
  it('adds the exchange suffix to bare IDX tickers at EODHD and Marketstack only', () => {
    expect(requestSymbol('idx_equity', 'eodhd', 'BBCA')).toBe('BBCA.JK');
    expect(requestSymbol('idx_equity', 'marketstack', 'BBCA')).toBe('BBCA.XIDX');
    expect(requestSymbol('idx_equity', 'eodhd', 'JKSE.INDX')).toBe('JKSE.INDX');
    expect(requestSymbol('us_equity', 'eodhd', 'SPY')).toBe('SPY');
    expect(requestSymbol('idx_equity', 'tiingo', 'BBCA')).toBe('BBCA');
  });

  it('meters the month, else the day, else nothing', () => {
    expect(quotaWindow('coingecko', NOW)).toEqual({ limit: 10_000, resetAt: new Date('2026-11-01T00:00:00Z') });
    expect(quotaWindow('eodhd', NOW)).toEqual({ limit: 20, resetAt: new Date('2026-10-16T00:00:00Z') });
    expect(quotaWindow('finnhub', NOW)).toEqual({ limit: null, resetAt: null });
  });
});

describe('runByokProvider', () => {
  it('stores the user’s prices under the stored symbols, logs the calls, and counts the quota', async () => {
    const { ports, updates } = byokPorts([]);
    const eodhd = fakeAdapter('eodhd', { 'BBCA.JK': '8750' });
    const run = await runByokProvider(ports, eodhd, {
      userId: USER,
      credential: credential('eodhd', { quotaUsed: 5, quotaResetAt: new Date('2026-10-16T00:00:00Z') }),
      targets: [target('idx_equity', 'BBCA', 'IDR'), target('idx_equity', 'TLKM', 'IDR')],
      now: NOW,
    });
    expect(eodhd.inputs[0]).toEqual({
      apiKey: 'fake-eodhd-key',
      requests: [
        { symbol: 'BBCA.JK', currency: 'IDR' },
        { symbol: 'TLKM.JK', currency: 'IDR' },
      ],
      now: NOW,
    });
    expect(ports.recordUserQuotes).toHaveBeenCalledWith(
      USER,
      [
        {
          provider: 'eodhd',
          symbol: 'BBCA',
          quoteCurrency: 'IDR',
          bucketTs: new Date('2026-10-15T09:15:00Z'),
          price: '8750',
          prevClose: null,
        },
      ],
      NOW,
    );
    expect(ports.logRequest).toHaveBeenCalledWith(USER, { ...call('eodhd'), at: NOW });
    // Each symbol of an EODHD real-time call counts.
    expect(updates).toEqual([
      [
        'eodhd',
        {
          status: 'connected',
          quotaUsed: 7,
          quotaLimit: 20,
          quotaResetAt: new Date('2026-10-16T00:00:00Z'),
          retryAfter: null,
        },
      ],
    ]);
    expect(run).toEqual({
      provider: 'eodhd',
      status: 'connected',
      pausedUntil: null,
      calls: 1,
      results: [
        { symbol: 'BBCA', currency: 'IDR', provider: 'eodhd', price: '8750', asOf: AS_OF },
        { symbol: 'TLKM', currency: 'IDR', provider: null, price: null, asOf: null },
      ],
    });
  });

  it('marks a connection test, restarts an expired quota period, and keeps Alpha Vantage unverified', async () => {
    const { ports, updates } = byokPorts([]);
    await runByokProvider(ports, fakeAdapter('alpha_vantage', {}, { unverified: true, calls: 2 }), {
      userId: USER,
      credential: credential('alpha_vantage', { quotaUsed: 24, quotaResetAt: new Date('2026-10-15T00:00:00Z') }),
      // No Alpha Vantage symbol stored for the target: asked as ''.
      targets: [target('us_equity', 'SPY', 'USD')],
      now: NOW,
      test: true,
    });
    expect(ports.logRequest).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ endpoint: `${TEST_ENDPOINT_PREFIX}GET /x` }),
    );
    expect(ports.recordUserQuotes).not.toHaveBeenCalled();
    expect(updates[0]?.[1]).toEqual({
      status: 'unverified',
      quotaUsed: 2,
      quotaLimit: 25,
      quotaResetAt: new Date('2026-10-16T00:00:00Z'),
      retryAfter: null,
      testedAt: NOW,
    });
  });

  it('pauses after a 429 until Retry-After, backs off without one, and pauses an exhausted quota until its reset', async () => {
    const limited = (retryAfter: string | null): AdapterFailure => ({
      status: 'rate_limited',
      retryAfter,
      quotaResetAt: null,
      code: 'http_429',
    });
    const spy = [target('us_equity', 'SPY', 'USD')];
    const { ports, updates } = byokPorts([]);
    const first = await runByokProvider(ports, fakeAdapter('tiingo', {}, { failure: limited('30') }), {
      userId: USER,
      credential: credential('tiingo'),
      targets: spy,
      now: NOW,
    });
    expect(first).toMatchObject({ status: 'rate_limited', pausedUntil: new Date('2026-10-15T09:42:30Z') });
    expect(updates[0]?.[1]).toMatchObject({ status: 'rate_limited', retryAfter: new Date('2026-10-15T09:42:30Z') });
    const again = await runByokProvider(ports, fakeAdapter('tiingo', {}, { failure: limited(null) }), {
      userId: USER,
      credential: credential('tiingo', { status: 'rate_limited' }),
      targets: spy,
      now: NOW,
    });
    expect(again.pausedUntil).toEqual(new Date('2026-10-15T09:44:00Z'));
    const month = new Date('2026-11-01T00:00:00Z');
    const exhausted = await runByokProvider(
      ports,
      fakeAdapter(
        'coingecko',
        {},
        { failure: { status: 'quota_exhausted', retryAfter: null, quotaResetAt: month, code: 'x' } },
      ),
      { userId: USER, credential: credential('coingecko'), targets: [target('crypto', 'BTC', 'IDR')], now: NOW },
    );
    expect(exhausted).toMatchObject({ status: 'quota_exhausted', pausedUntil: month });
    expect(updates[2]?.[1]).toMatchObject({ status: 'quota_exhausted', quotaResetAt: month, retryAfter: month });
    const wrong = await runByokProvider(
      ports,
      fakeAdapter(
        'finnhub',
        {},
        { failure: { status: 'invalid_key', retryAfter: null, quotaResetAt: null, code: 'http_401' } },
      ),
      { userId: USER, credential: credential('finnhub'), targets: spy, now: NOW },
    );
    expect(wrong).toMatchObject({ status: 'invalid_key', pausedUntil: null });
    expect(updates[3]?.[1]).toMatchObject({ status: 'invalid_key', retryAfter: null, quotaUsed: 1, quotaLimit: null });
  });
});

describe('syncByokMarket', () => {
  const adapters = (overrides: Partial<MarketAdapters>) => overrides as MarketAdapters;

  it('falls back provider by provider for the symbols still unpriced, skipping missing, off, and paused keys', async () => {
    const tiingo = fakeAdapter('tiingo', { SPY: '690.1' });
    const finnhub = fakeAdapter('finnhub', { QQQ: '603.55' });
    const { ports } = byokPorts([
      credential('tiingo'),
      credential('finnhub'),
      credential('massive', { active: false }),
      credential('alpha_vantage', { retryAfter: new Date('2026-10-16T00:00:00Z') }),
    ]);
    const sync = await syncByokMarket(ports, adapters({ tiingo, finnhub }), {
      userId: USER,
      market: 'us_equity',
      targets: [
        target('us_equity', 'SPY', 'USD'),
        target('us_equity', 'QQQ', 'USD'),
        target('us_equity', 'VEA', 'USD'),
      ],
      now: NOW,
    });
    expect(tiingo.inputs[0]?.requests.map((request) => request.symbol)).toEqual(['SPY', 'QQQ', 'VEA']);
    expect(finnhub.inputs[0]?.requests.map((request) => request.symbol)).toEqual(['QQQ', 'VEA']);
    expect(sync.runs.map((run) => run.provider)).toEqual(['tiingo', 'finnhub']);
    expect(sync.skipped).toEqual([
      { provider: 'massive', reason: 'inactive', until: null },
      { provider: 'alpha_vantage', reason: 'paused', until: new Date('2026-10-16T00:00:00Z') },
    ]);
    expect(sync.results).toEqual([
      { symbol: 'SPY', currency: 'USD', provider: 'tiingo', price: '690.1', asOf: AS_OF },
      { symbol: 'QQQ', currency: 'USD', provider: 'finnhub', price: '603.55', asOf: AS_OF },
      { symbol: 'VEA', currency: 'USD', provider: null, price: null, asOf: null },
    ]);
  });

  it('stops once every symbol is priced and ignores the built-in steps', async () => {
    const cmc = fakeAdapter('coinmarketcap', { BTC: '1459802000' });
    const coingecko = fakeAdapter('coingecko', {});
    const { ports } = byokPorts([credential('coinmarketcap'), credential('coingecko')]);
    const sync = await syncByokMarket(ports, adapters({ coinmarketcap: cmc, coingecko }), {
      userId: USER,
      market: 'crypto',
      targets: [target('crypto', 'BTC', 'IDR')],
      now: NOW,
    });
    expect(cmc.inputs).toHaveLength(1);
    expect(coingecko.inputs).toHaveLength(0);
    expect(sync.results[0]?.provider).toBe('coinmarketcap');
    const none = await syncByokMarket(byokPorts([]).ports, adapters({}), {
      userId: USER,
      market: 'crypto',
      targets: [{ market: 'crypto', currency: 'IDR', symbols: {}, serverAsOf: null }],
      now: NOW,
    });
    expect(none.results).toEqual([{ symbol: '', currency: 'IDR', provider: null, price: null, asOf: null }]);
  });
});

describe('syncServerProvider', () => {
  function serverPorts(state: ProviderState | null) {
    const states: [ServerProvider, ProviderState][] = [];
    const ports = {
      providerState: vi.fn(() => Promise.resolve(state)),
      setProviderState: vi.fn((provider: ServerProvider, next: ProviderState) => {
        states.push([provider, next]);
        return Promise.resolve();
      }),
      recordServerQuotes: vi.fn(() => Promise.resolve()),
      logRequest: vi.fn(() => Promise.resolve()),
    } satisfies ServerPorts;
    return { ports, states };
  }
  const btc = [{ symbol: 'BTC', currency: 'IDR' }];
  const month = new Date('2026-11-01T00:00:00Z');
  let cmc: FakeAdapter;

  beforeEach(() => {
    cmc = fakeAdapter('coinmarketcap', { BTC: '1459802000' }, { credits: 1 });
  });

  it('prices the union of symbols into the global cache and counts the month’s credits', async () => {
    const { ports, states } = serverPorts({
      status: 'connected',
      pausedUntil: null,
      quotaUsed: 100,
      quotaLimit: CMC_MONTHLY_CREDITS,
      quotaResetAt: month,
    });
    const run = await syncServerProvider(ports, cmc, {
      provider: 'coinmarketcap',
      apiKey: 'fake-operator',
      requests: btc,
      now: NOW,
    });
    expect(cmc.inputs[0]).toEqual({ apiKey: 'fake-operator', requests: btc, now: NOW });
    expect(ports.recordServerQuotes).toHaveBeenCalledWith(
      [
        {
          provider: 'coinmarketcap',
          symbol: 'BTC',
          quoteCurrency: 'IDR',
          bucketTs: new Date('2026-10-15T09:15:00Z'),
          price: '1459802000',
          prevClose: null,
        },
      ],
      NOW,
    );
    expect(ports.logRequest).toHaveBeenCalledWith(null, { ...call('coinmarketcap'), at: NOW });
    expect(run).toEqual({
      provider: 'coinmarketcap',
      status: 'connected',
      pausedUntil: null,
      quotes: 1,
      quotaUsed: 101,
      skipped: null,
    });
    expect(states).toEqual([
      [
        'coinmarketcap',
        { status: 'connected', pausedUntil: null, quotaUsed: 101, quotaLimit: 15_000, quotaResetAt: month },
      ],
    ]);
  });

  it('asks nothing without the operator key, while paused, or once only the reserve is left', async () => {
    const unconfigured = serverPorts(null);
    expect(
      await syncServerProvider(unconfigured.ports, cmc, {
        provider: 'coinmarketcap',
        apiKey: null,
        requests: btc,
        now: NOW,
      }),
    ).toMatchObject({ status: 'unconfigured', skipped: 'unconfigured', quotaUsed: 0 });
    const pausedUntil = new Date('2026-10-15T09:43:00Z');
    const paused = serverPorts({
      status: 'rate_limited',
      pausedUntil,
      quotaUsed: 5,
      quotaLimit: 15_000,
      quotaResetAt: month,
    });
    expect(
      await syncServerProvider(paused.ports, cmc, { provider: 'coinmarketcap', apiKey: 'k', requests: btc, now: NOW }),
    ).toMatchObject({ status: 'rate_limited', pausedUntil, skipped: 'paused', quotaUsed: 5 });
    const spent = serverPorts({
      status: 'connected',
      pausedUntil: null,
      quotaUsed: 13_500,
      quotaLimit: 15_000,
      quotaResetAt: month,
    });
    expect(
      await syncServerProvider(spent.ports, cmc, { provider: 'coinmarketcap', apiKey: 'k', requests: btc, now: NOW }),
    ).toMatchObject({ status: 'quota_exhausted', pausedUntil: month, skipped: 'credits' });
    expect(spent.states[0]?.[1]).toMatchObject({ status: 'quota_exhausted', pausedUntil: month });
    expect(cmc.inputs).toHaveLength(0);
  });

  it('pauses after a 429, restarts the count in a new month, and asks nothing for no symbols', async () => {
    const old = new Date('2026-10-01T00:00:00Z');
    const { ports, states } = serverPorts({
      status: 'connected',
      pausedUntil: null,
      quotaUsed: 14_000,
      quotaLimit: 15_000,
      quotaResetAt: old,
    });
    const failing = fakeAdapter(
      'coinmarketcap',
      {},
      {
        failure: { status: 'rate_limited', retryAfter: '60', quotaResetAt: null, code: 'cmc_1008' },
      },
    );
    const run = await syncServerProvider(ports, failing, {
      provider: 'coinmarketcap',
      apiKey: 'k',
      requests: btc,
      now: NOW,
    });
    expect(run).toMatchObject({
      status: 'rate_limited',
      pausedUntil: new Date('2026-10-15T09:43:00Z'),
      quotes: 0,
      quotaUsed: 0,
    });
    expect(ports.recordServerQuotes).not.toHaveBeenCalled();
    expect(states[0]?.[1]).toMatchObject({ status: 'rate_limited', quotaUsed: 0 });
    const idle = serverPorts(null);
    expect(
      await syncServerProvider(idle.ports, cmc, { provider: 'coinmarketcap', apiKey: 'k', requests: [], now: NOW }),
    ).toEqual({
      provider: 'coinmarketcap',
      status: 'connected',
      pausedUntil: null,
      quotes: 0,
      quotaUsed: 0,
      skipped: null,
    });
    expect(idle.ports.setProviderState).not.toHaveBeenCalled();
  });

  it('keeps no meter for the keyless gold spot', async () => {
    const { ports, states } = serverPorts(null);
    const gold = fakeAdapter('fawazahmed0', { XAU: '75442309' });
    const run = await syncServerProvider(ports, gold, {
      provider: 'fawazahmed0',
      apiKey: null,
      requests: [{ symbol: 'XAU', currency: 'IDR' }],
      now: NOW,
    });
    expect(run).toMatchObject({ status: 'connected', quotes: 1, quotaUsed: 0 });
    expect(states[0]?.[1]).toEqual({
      status: 'connected',
      pausedUntil: null,
      quotaUsed: 0,
      quotaLimit: null,
      quotaResetAt: null,
    });
    const failed = serverPorts(null);
    const down = fakeAdapter(
      'fawazahmed0',
      {},
      { failure: { status: 'error', retryAfter: null, quotaResetAt: null, code: 'http_503' } },
    );
    expect(
      await syncServerProvider(failed.ports, down, {
        provider: 'fawazahmed0',
        apiKey: null,
        requests: [{ symbol: 'XAU', currency: 'IDR' }],
        now: NOW,
      }),
    ).toMatchObject({ status: 'error', pausedUntil: null });
  });
});
