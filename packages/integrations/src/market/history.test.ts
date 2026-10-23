// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { createMarketAdapters } from './adapters.ts';
import { fetchPriorClose, type HistoricalProvider } from './history.ts';
import type { FetchQuotesInput } from './http.ts';

const input: FetchQuotesInput = {
  apiKey: 'fake-history-key',
  requests: [{ symbol: 'SPY', currency: 'USD' }],
  now: new Date('2026-10-15T00:00:00Z'),
};

/** The URL a mocked `fetch` was called with. */
function urlOf(call: Parameters<typeof fetch>[0]): string {
  return typeof call === 'string' ? call : call instanceof URL ? call.href : call.url;
}

function priorCloseOf(provider: HistoricalProvider, fetcher: typeof fetch) {
  const adapter = createMarketAdapters({ fetch: fetcher })[provider];
  const fetch = adapter.fetchPriorClose?.bind(adapter);
  if (fetch === undefined) throw new Error(`${provider} has no history`);
  return fetch;
}

describe('prior Dec 31 close', () => {
  it.each(['tiingo', 'eodhd'] as const)(
    'uses the final returned session, not current or adjusted prices (%s)',
    async (provider) => {
      const fetcher = vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json([
            { date: '2025-12-29', close: '91', adjClose: '10' },
            { date: '2026-01-02', close: '999' },
            { date: '2025-12-30', close: '92.75' },
            { date: '2025-12-31', close: 'NA' },
            { date: '2024-12-31', close: '1' },
            { date: 'bad', close: '1' },
          ]),
        ),
      );
      const result = await priorCloseOf(provider, fetcher)(input);
      expect(result.quotes).toEqual([
        { symbol: 'SPY', currency: 'USD', price: '92.75', prevClose: null, asOf: new Date('2025-12-30T00:00:00Z') },
      ]);
      const call = fetcher.mock.calls[0];
      if (call === undefined) throw new Error('fetch was not called');
      expect(urlOf(call[0])).toContain(provider === 'tiingo' ? 'endDate=2025-12-31' : 'to=2025-12-31');
      expect(result.calls[0]?.endpoint).not.toContain('fake-history-key');
      expect(call[1]?.redirect).toBe('error');
    },
  );

  it('skips an exchange holiday at Massive and keeps the previous actual session', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ results: [] }))
      .mockResolvedValueOnce(Response.json({ results: [{ T: 'SPY', c: '93.25' }] }));
    const result = await priorCloseOf('massive', fetcher)(input);
    const first = fetcher.mock.calls[0];
    const second = fetcher.mock.calls[1];
    if (first === undefined || second === undefined) throw new Error('fetch was not called twice');
    expect(urlOf(first[0])).toContain('/2025-12-31?');
    expect(urlOf(second[0])).toContain('/2025-12-30?');
    expect(result.quotes).toEqual([
      { symbol: 'SPY', currency: 'USD', price: '93.25', prevClose: null, asOf: new Date('2025-12-30T21:00:00Z') },
    ]);
  });

  it.each(['tiingo', 'eodhd', 'massive'] as const)(
    'preserves a provider failure without inventing a baseline (%s)',
    async (provider) => {
      const result = await fetchPriorClose(provider, input, {
        fetch: () => Promise.resolve(Response.json({}, { status: 429, headers: { 'Retry-After': '60' } })),
      });
      expect(result.quotes).toEqual([]);
      expect(result.failure).toMatchObject({ status: 'rate_limited', retryAfter: '60' });
      expect(result.calls[0]).toMatchObject({ httpStatus: 429, ok: false, errorCode: 'http_429' });
    },
  );

  it.each(['tiingo', 'eodhd', 'massive'] as const)(
    'propagates missing-key authentication refusal without creating history (%s)',
    async (provider) => {
      const result = await fetchPriorClose(
        provider,
        { ...input, apiKey: null },
        {
          fetch: () => Promise.resolve(Response.json({ error: 'Key required' }, { status: 401 })),
        },
      );
      expect(result.quotes).toEqual([]);
      expect(result.failure).toMatchObject({ status: 'invalid_key', code: 'http_401' });
    },
  );

  it('does not invent history from malformed or missing rows and skips non-USD Tiingo requests', async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ error: 'No history' })));
    const result = await fetchPriorClose(
      'tiingo',
      { ...input, requests: [{ symbol: 'X', currency: 'IDR' }, ...input.requests] },
      { fetch: fetcher },
    );
    expect(result.quotes).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const missing = await fetchPriorClose('eodhd', input, {
      fetch: () => Promise.resolve(Response.json([])),
    });
    expect(missing.quotes).toEqual([]);
  });

  it('leaves a missing Massive ticker unpriced, rejects non-USD and tolerates an absent results array', async () => {
    const result = await fetchPriorClose(
      'massive',
      { ...input, requests: [...input.requests, { symbol: 'X', currency: 'IDR' }] },
      { fetch: () => Promise.resolve(Response.json({ results: [{ T: 'OTHER', c: 1 }] })) },
    );
    expect(result.quotes).toEqual([]);
    const absent = await fetchPriorClose('massive', input, {
      fetch: () => Promise.resolve(Response.json({})),
    });
    expect(absent.quotes).toEqual([]);
  });
});
