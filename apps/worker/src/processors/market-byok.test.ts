// SPDX-License-Identifier: AGPL-3.0-only
import type { MarketCredentialView } from '@wf/db/market-credentials';
import type { MarketTargetRow, SyncCredential } from '@wf/db/market-jobs';
import type { ByokProvider } from '@wf/domain/market';
import type { FetchQuotesInput } from '@wf/integrations/market/http';
import { describe, expect, it } from 'vitest';
import { fakeAdapters, fakeDb, fakeDeps } from '../../test/fakes.ts';
import { createMarketByokProcessor } from './market-byok.ts';

const USER = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7d';
// Thursday 15 Oct, 12.05 WIB (IDX noon refresh), 01.05 EDT (US closed).
const NOW = new Date('2026-10-15T05:05:00Z');

const view = (provider: ByokProvider, overrides: Partial<MarketCredentialView> = {}): MarketCredentialView => ({
  id: provider,
  provider,
  last4: 'fake',
  active: true,
  status: 'connected',
  quotaUsed: 0,
  quotaLimit: null,
  quotaResetAt: null,
  retryAfter: null,
  lastTestedAt: null,
  updatedAt: NOW,
  ...overrides,
});

const credential = (provider: ByokProvider): SyncCredential => ({
  provider,
  apiKey: `fake-${provider}-key`,
  active: true,
  status: 'connected',
  quotaUsed: 0,
  quotaResetAt: null,
  retryAfter: null,
});

const TARGETS: MarketTargetRow[] = [
  { market: 'idx_equity', currency: 'IDR', symbols: { eodhd: 'BBCA', marketstack: 'BBCA' }, serverAsOf: null },
  { market: 'us_equity', currency: 'USD', symbols: { tiingo: 'SPY', finnhub: 'SPY' }, serverAsOf: null },
  // Fresh from the built-in source: the user's key is not asked.
  {
    market: 'crypto',
    currency: 'IDR',
    symbols: { coinmarketcap: 'BTC', coingecko: 'BTC' },
    serverAsOf: new Date('2026-10-15T05:00:00Z'),
  },
  // Stale built-in price (over an hour): the user's key prices it.
  {
    market: 'crypto',
    currency: 'IDR',
    symbols: { coinmarketcap: 'ETH', coingecko: 'ETH' },
    serverAsOf: new Date('2026-10-15T03:00:00Z'),
  },
];

function deps(keys: MarketCredentialView[], lastRequests: Partial<Record<ByokProvider, Date>> = {}) {
  const db = fakeDb();
  const adapters = fakeAdapters();
  const inputs: FetchQuotesInput[] = [];
  adapters.eodhd.fetchQuotes = (input) => {
    inputs.push(input);
    return Promise.resolve({
      quotes: [{ symbol: 'BBCA.JK', currency: 'IDR', price: '8750', prevClose: '8700', asOf: NOW }],
      calls: [],
      failure: null,
      unverified: false,
      credits: null,
    });
  };
  return {
    inputs,
    adapters,
    deps: fakeDeps(
      {
        db: {
          ...db,
          marketCredentials: { ...db.marketCredentials, list: () => Promise.resolve(keys) },
          marketJobs: {
            ...db.marketJobs,
            userTargets: (...args: unknown[]) => {
              db.calls.push({ method: 'marketJobs.userTargets', args });
              return Promise.resolve(TARGETS);
            },
            lastRequests: () => Promise.resolve(lastRequests),
            credential: (_: string, provider: ByokProvider) => {
              const key = keys.find((candidate) => candidate.provider === provider);
              return Promise.resolve(key === undefined ? null : { ...credential(provider), active: key.active });
            },
          },
        },
        market: { adapters, cmcApiKey: null },
      },
      NOW,
    ),
  };
}

const job = { id: 'mkb', data: { userId: USER }, attemptsMade: 0 };

describe('market-byok processor', () => {
  it('refreshes each due market with the user’s keys in order, and only what the built-in source lacks', async () => {
    const {
      deps: d,
      inputs,
      adapters,
    } = deps([view('eodhd'), view('tiingo'), view('coinmarketcap', { active: false }), view('coingecko')], {
      eodhd: new Date('2026-10-15T03:00:00Z'),
    });
    const result = await createMarketByokProcessor(d)(job);
    expect(d.db.calls[0]).toEqual({ method: 'marketJobs.userTargets', args: [USER, { fetchedOnly: true }] });
    expect(inputs[0]?.requests).toEqual([{ symbol: 'BBCA.JK', currency: 'IDR' }]);
    expect(adapters.inputs.map(({ provider, input }) => [provider, input.requests])).toEqual([
      ['coingecko', [{ symbol: 'ETH', currency: 'IDR' }]],
    ]);
    // The US session is closed at 01.05 EDT: Tiingo waits.
    expect(result).toEqual({
      markets: [
        {
          market: 'idx_equity',
          priced: 1,
          missing: 0,
          runs: [{ provider: 'eodhd', status: 'connected' }],
          skipped: [],
        },
        {
          market: 'crypto',
          priced: 0,
          missing: 1,
          runs: [{ provider: 'coingecko', status: 'connected' }],
          // The switched-off CoinMarketCap key is passed over.
          skipped: ['coinmarketcap'],
        },
      ],
    });
    expect(d.db.calls.filter((call) => call.method === 'marketData.recordUserQuotes')).toHaveLength(1);
  });

  it('skips markets not due, without a usable key, or with too many symbols for the quota', async () => {
    const {
      deps: d,
      adapters,
      inputs,
    } = deps(
      [
        // Asked a minute ago.
        view('eodhd'),
        // Paused until later: no usable US or crypto key.
        view('tiingo', { retryAfter: new Date('2026-10-15T06:00:00Z') }),
        view('coingecko', { active: false }),
      ],
      { eodhd: new Date('2026-10-15T05:04:00Z') },
    );
    expect(await createMarketByokProcessor(d)(job)).toEqual({ markets: [] });
    expect(inputs).toEqual([]);
    expect(adapters.inputs).toEqual([]);
  });

  it('leaves a market whose symbols no free plan can carry', async () => {
    const many: MarketTargetRow[] = Array.from({ length: 30 }, (_, index) => ({
      market: 'us_equity',
      currency: 'USD',
      symbols: { alpha_vantage: `S${index}` },
      serverAsOf: null,
    }));
    const { deps: d, adapters } = deps([view('alpha_vantage')]);
    d.db.marketJobs.userTargets = () => Promise.resolve(many);
    expect(await createMarketByokProcessor(d)(job)).toEqual({ markets: [] });
    expect(adapters.inputs).toEqual([]);
  });

  it('rejects a payload without a user', async () => {
    await expect(createMarketByokProcessor(fakeDeps())({ ...job, data: {} })).rejects.toThrow();
  });
});
