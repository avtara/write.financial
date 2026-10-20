// SPDX-License-Identifier: AGPL-3.0-only
import { parseLocalDate } from '@wf/domain/period';
import {
  FxProviderError,
  type FxProvider,
  type FxProviderName,
  type FxQuery,
  type FxRate,
} from '@wf/integrations/fx/provider';
import { describe, expect, it } from 'vitest';
import { fakeDb, fakeDeps } from '../../test/fakes.ts';
import { createFxProcessor, FX_QUOTE, FxUnavailableError } from './fx.ts';

const rate = (provider: FxProviderName, base: string): FxRate => ({
  base,
  quote: 'IDR',
  rate: '17948.00000000',
  provider,
  rateType: provider === 'frankfurter' ? 'bi_transaction' : 'blended',
  asOf: parseLocalDate('2026-10-19'),
});

function provider(
  name: FxProviderName,
  answer: (query: FxQuery) => FxRate[] | Error,
  queries: FxQuery[] = [],
): FxProvider {
  return {
    name,
    hosts: [],
    fetchRates: (query) => {
      queries.push(query);
      const result = answer(query);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  };
}

const job = { id: 'fx.2026-10-19', data: {}, attemptsMade: 0 };

describe('createFxProcessor', () => {
  it('fetches IDR rates for the default bases plus every currency in use and upserts them', async () => {
    const db = fakeDb(undefined, ['IDR', 'USD', 'THB', 'XAU']);
    const queries: FxQuery[] = [];
    const frankfurter = provider(
      'frankfurter',
      ({ bases }) => bases.filter((base) => base !== 'XAU' && base !== 'THB').map((base) => rate('frankfurter', base)),
      queries,
    );
    const fawazahmed0 = provider('fawazahmed0', () => [rate('fawazahmed0', 'THB')]);
    const run = createFxProcessor(fakeDeps({ db }), [frankfurter, fawazahmed0]);

    expect(await run(job)).toEqual({ written: { frankfurter: 8, fawazahmed0: 1 }, missing: ['XAU'], failures: [] });
    expect(FX_QUOTE).toBe('IDR');
    expect(queries).toEqual([
      { quote: 'IDR', bases: ['AUD', 'CNY', 'EUR', 'GBP', 'JPY', 'MYR', 'SGD', 'THB', 'USD', 'XAU'] },
    ]);
    expect(db.fxUpserts).toHaveLength(1);
    expect(db.fxUpserts[0]?.map((row) => `${row.provider}:${row.base}`)).toEqual([
      'frankfurter:AUD',
      'frankfurter:CNY',
      'frankfurter:EUR',
      'frankfurter:GBP',
      'frankfurter:JPY',
      'frankfurter:MYR',
      'frankfurter:SGD',
      'frankfurter:USD',
      'fawazahmed0:THB',
    ]);
  });

  it('fails without writing when no source answers, so BullMQ retries and the last rates stay', async () => {
    const db = fakeDb(undefined, []);
    const down = provider('frankfurter', () => new FxProviderError('frankfurter', 'HTTP 503'));
    const run = createFxProcessor(fakeDeps({ db }), [down]);
    await expect(run(job)).rejects.toThrow(
      new FxUnavailableError(
        'No FX reference rate available (AUD, CNY, EUR, GBP, JPY, MYR, SGD, USD): FxProviderError: frankfurter: HTTP 503',
      ),
    );
    const silent = createFxProcessor(fakeDeps({ db }), [provider('open-er-api', () => [])]);
    await expect(silent(job)).rejects.toThrow(/: no source covers these currencies$/);
    expect(db.fxUpserts).toEqual([]);
  });

  it('reports partial failures of a successful run', async () => {
    const db = fakeDb(undefined, []);
    const run = createFxProcessor(fakeDeps({ db }), [
      provider('frankfurter', () => new FxProviderError('frankfurter', 'request failed')),
      provider('open-er-api', ({ bases }) => bases.map((base) => rate('open-er-api', base))),
    ]);
    expect(await run(job)).toEqual({
      written: { 'open-er-api': 8 },
      missing: [],
      failures: [{ provider: 'frankfurter', error: 'FxProviderError: frankfurter: request failed' }],
    });
  });

  it('rejects a payload with keys', async () => {
    const run = createFxProcessor(fakeDeps(), []);
    await expect(run({ ...job, data: { userId: 'u1' } })).rejects.toThrow();
  });
});
