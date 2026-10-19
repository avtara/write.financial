// SPDX-License-Identifier: AGPL-3.0-only
import { parseLocalDate } from '@wf/domain/period';
import { describe, expect, it, vi } from 'vitest';
import { FxProviderError, type FxProvider, type FxProviderName, type FxQuery, type FxRate } from './provider.ts';
import { createBuiltInFxProviders, DEFAULT_FX_BASES, fetchReferenceRates, InvalidCurrencyError } from './rates.ts';

const rate = (provider: FxProviderName, base: string): FxRate => ({
  base,
  quote: 'IDR',
  rate: '1.00000000',
  provider,
  rateType: 'blended',
  asOf: parseLocalDate('2026-10-19'),
});

function fake(name: FxProviderName, answer: (query: FxQuery) => FxRate[] | Error): FxProvider & { queries: FxQuery[] } {
  const queries: FxQuery[] = [];
  return {
    name,
    hosts: [],
    queries,
    fetchRates: (query) => {
      queries.push(query);
      const result = answer(query);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  };
}

describe('fetchReferenceRates', () => {
  it('asks each source only for the bases the previous ones left, in order', async () => {
    const frankfurter = fake('frankfurter', () => [rate('frankfurter', 'USD'), rate('frankfurter', 'EUR')]);
    const fawazahmed0 = fake('fawazahmed0', () => new FxProviderError('fawazahmed0', 'HTTP 503'));
    const openErApi = fake('open-er-api', ({ bases }) =>
      bases.filter((base) => base !== 'XAG').map((base) => rate('open-er-api', base)),
    );
    const result = await fetchReferenceRates([frankfurter, fawazahmed0, openErApi], {
      quote: 'IDR',
      bases: ['USD', 'SGD', 'EUR', 'IDR', 'USD', 'XAG'],
    });
    expect(frankfurter.queries).toEqual([{ quote: 'IDR', bases: ['EUR', 'SGD', 'USD', 'XAG'] }]);
    expect(fawazahmed0.queries).toEqual([{ quote: 'IDR', bases: ['SGD', 'XAG'] }]);
    expect(openErApi.queries).toEqual([{ quote: 'IDR', bases: ['SGD', 'XAG'] }]);
    expect(result).toEqual({
      rates: [rate('frankfurter', 'USD'), rate('frankfurter', 'EUR'), rate('open-er-api', 'SGD')],
      missing: ['XAG'],
      failures: [{ provider: 'fawazahmed0', error: 'FxProviderError: fawazahmed0: HTTP 503' }],
    });
  });

  it('stops once every base is answered and ignores rates for bases it did not ask for', async () => {
    const frankfurter = fake('frankfurter', () => [rate('frankfurter', 'USD'), rate('frankfurter', 'GBP')]);
    const fallback = fake('fawazahmed0', () => []);
    const result = await fetchReferenceRates([frankfurter, fallback], { quote: 'IDR', bases: new Set(['USD']) });
    expect(result).toEqual({ rates: [rate('frankfurter', 'USD')], missing: [], failures: [] });
    expect(fallback.queries).toEqual([]);
  });

  it('rejects codes that are not three upper-case letters before any request', async () => {
    const provider = fake('frankfurter', () => []);
    await expect(fetchReferenceRates([provider], { quote: 'IDR', bases: ['usd'] })).rejects.toThrow(
      new InvalidCurrencyError('usd'),
    );
    await expect(fetchReferenceRates([provider], { quote: 'IDR&x=1', bases: [] })).rejects.toThrow(
      'Invalid currency code: "IDR&x=1"',
    );
    expect(provider.queries).toEqual([]);
  });
});

describe('createBuiltInFxProviders', () => {
  it('orders Frankfurter, fawazahmed0, open.er-api and passes the options to each', async () => {
    const offline = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
    const providers = createBuiltInFxProviders({ fetch: offline as unknown as typeof fetch, timeoutMs: 50 });
    expect(providers.map((provider) => provider.name)).toEqual(['frankfurter', 'fawazahmed0', 'open-er-api']);
    const result = await fetchReferenceRates(providers, { quote: 'IDR', bases: DEFAULT_FX_BASES });
    expect(result.missing).toEqual(['AUD', 'CNY', 'EUR', 'GBP', 'JPY', 'MYR', 'SGD', 'USD']);
    expect(result.failures.map((failure) => failure.error)).toEqual([
      'FxProviderError: frankfurter: request failed',
      'FxProviderError: fawazahmed0: request failed',
      'FxProviderError: open-er-api: request failed',
    ]);
    // Frankfurter stops at the first failing base; fawazahmed0 tries both hosts.
    expect(offline).toHaveBeenCalledTimes(4);
    expect(createBuiltInFxProviders()).toHaveLength(3);
  });
});
