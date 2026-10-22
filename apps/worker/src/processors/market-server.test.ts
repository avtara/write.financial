// SPDX-License-Identifier: AGPL-3.0-only
import type { AdapterResult, FetchQuotesInput, MarketAdapter } from '@wf/integrations/market/http';
import { describe, expect, it } from 'vitest';
import { fakeAdapters, fakeDb, fakeDeps, type FakeAdapters } from '../../test/fakes.ts';
import { createMarketServerProcessor, GoldSpotUnavailableError } from './market-server.ts';

const NOW = new Date('2026-10-15T09:40:00Z');
const AS_OF = new Date('2026-10-15T09:39:00Z');

function db() {
  const base = fakeDb();
  return {
    ...base,
    marketJobs: {
      ...base.marketJobs,
      serverTargets: () =>
        Promise.resolve([
          { market: 'crypto' as const, symbol: 'BTC', currency: 'IDR' },
          { market: 'crypto' as const, symbol: 'ETH', currency: 'USD' },
          { market: 'gold_spot' as const, symbol: 'XAU', currency: 'IDR' },
        ]),
    },
  };
}

const answering = (
  provider: MarketAdapter['provider'],
  result: Partial<AdapterResult>,
  inputs: FetchQuotesInput[],
) => ({
  provider,
  fetchQuotes: (input: FetchQuotesInput) => {
    inputs.push(input);
    return Promise.resolve({ quotes: [], calls: [], failure: null, unverified: false, credits: null, ...result });
  },
});

describe('market-server processor', () => {
  it('prices every user’s crypto with the operator key into the global cache', async () => {
    const inputs: FetchQuotesInput[] = [];
    const adapters = {
      ...fakeAdapters(),
      coinmarketcap: answering(
        'coinmarketcap',
        { quotes: [{ symbol: 'BTC', currency: 'IDR', price: '1459802000', prevClose: null, asOf: AS_OF }], credits: 2 },
        inputs,
      ),
    };
    const deps = fakeDeps({ db: db(), market: { adapters, cmcApiKey: 'fake-cmc-operator-key' } }, NOW);
    const result = await createMarketServerProcessor(deps)({ id: 'x', data: { source: 'crypto' }, attemptsMade: 0 });
    expect(inputs).toEqual([
      {
        apiKey: 'fake-cmc-operator-key',
        requests: [
          { symbol: 'BTC', currency: 'IDR' },
          { symbol: 'ETH', currency: 'USD' },
        ],
        now: NOW,
      },
    ]);
    expect(result).toEqual({
      provider: 'coinmarketcap',
      status: 'connected',
      pausedUntil: null,
      quotes: 1,
      quotaUsed: 2,
      skipped: null,
      asked: 2,
    });
    expect(deps.db.calls.map((call) => call.method)).toEqual([
      'marketJobs.providerState',
      'marketData.recordServerQuotes',
      'marketJobs.setProviderState',
    ]);
  });

  it('asks nothing without an operator key', async () => {
    const deps = fakeDeps({ db: db(), market: { adapters: fakeAdapters(), cmcApiKey: null } }, NOW);
    const result = await createMarketServerProcessor(deps)({ id: 'x', data: { source: 'crypto' }, attemptsMade: 0 });
    expect(result).toMatchObject({ status: 'unconfigured', skipped: 'unconfigured' });
    expect((deps.market.adapters as FakeAdapters).inputs).toEqual([]);
  });

  it('reads the XAU spot for gold, and fails a run that got nothing so BullMQ retries it', async () => {
    const inputs: FetchQuotesInput[] = [];
    const gold = (result: Partial<AdapterResult>) => ({
      ...fakeAdapters(),
      fawazahmed0: answering('fawazahmed0', result, inputs),
    });
    const ok = fakeDeps(
      {
        db: db(),
        market: {
          adapters: gold({
            quotes: [{ symbol: 'XAU', currency: 'IDR', price: '75442309', prevClose: null, asOf: AS_OF }],
          }),
          cmcApiKey: null,
        },
      },
      NOW,
    );
    expect(await createMarketServerProcessor(ok)({ id: 'x', data: { source: 'gold' }, attemptsMade: 0 })).toMatchObject(
      {
        provider: 'fawazahmed0',
        status: 'connected',
        quotes: 1,
        asked: 1,
      },
    );
    expect(inputs[0]?.requests).toEqual([{ symbol: 'XAU', currency: 'IDR' }]);
    const down = fakeDeps(
      {
        db: db(),
        market: {
          adapters: gold({ failure: { status: 'error', retryAfter: null, quotaResetAt: null, code: 'http_503' } }),
          cmcApiKey: null,
        },
      },
      NOW,
    );
    await expect(
      createMarketServerProcessor(down)({ id: 'x', data: { source: 'gold' }, attemptsMade: 0 }),
    ).rejects.toThrow(GoldSpotUnavailableError);
  });

  it('rejects an unknown source', async () => {
    await expect(
      createMarketServerProcessor(fakeDeps())({ id: 'x', data: { source: 'stocks' }, attemptsMade: 0 }),
    ).rejects.toThrow();
  });
});
