// SPDX-License-Identifier: AGPL-3.0-only
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createOpenErApi, OPEN_ER_API_URL } from './open-er-api.ts';

/** Recorded on 2026-10-19 (shortened). */
const LATEST = {
  result: 'success',
  provider: 'https://www.exchangerate-api.com',
  time_last_update_unix: 1792368152,
  time_last_update_utc: 'Mon, 19 Oct 2026 00:02:32 +0000',
  base_code: 'USD',
  rates: { USD: 1, IDR: 18010.5, SGD: 1.2795, JPY: 158.2, ZZZ: 0 },
};

let calls = 0;
const server = setupServer(
  http.get(OPEN_ER_API_URL, () => {
    calls += 1;
    return HttpResponse.json(LATEST);
  }),
);

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
  calls = 0;
});
afterAll(() => {
  server.close();
});

describe('createOpenErApi', () => {
  const openErApi = createOpenErApi();

  it('only reaches open.er-api.com', () => {
    expect(openErApi).toMatchObject({ name: 'open-er-api', hosts: ['open.er-api.com'] });
  });

  it('crosses every base through one USD table and dates it by the UTC publication day', async () => {
    const rates = await openErApi.fetchRates({ quote: 'IDR', bases: ['USD', 'SGD', 'JPY', 'GBP', 'ZZZ'] });
    expect(rates).toEqual([
      {
        base: 'USD',
        quote: 'IDR',
        rate: '18010.50000000',
        provider: 'open-er-api',
        rateType: 'blended',
        asOf: '2026-10-19',
      },
      {
        base: 'SGD',
        quote: 'IDR',
        rate: '14076.20164127',
        provider: 'open-er-api',
        rateType: 'blended',
        asOf: '2026-10-19',
      },
      {
        base: 'JPY',
        quote: 'IDR',
        rate: '113.84639697',
        provider: 'open-er-api',
        rateType: 'blended',
        asOf: '2026-10-19',
      },
    ]);
    expect(calls).toBe(1);
  });

  it('answers nothing for a quote it does not list', async () => {
    expect(await openErApi.fetchRates({ quote: 'XTS', bases: ['USD'] })).toEqual([]);
  });

  it('rejects an error answer and rate limiting', async () => {
    server.use(
      http.get(OPEN_ER_API_URL, () => HttpResponse.json({ result: 'error', 'error-type': 'unsupported-code' })),
    );
    await expect(openErApi.fetchRates({ quote: 'IDR', bases: ['USD'] })).rejects.toThrow(
      /^open-er-api: unexpected response: result: /,
    );
    server.use(http.get(OPEN_ER_API_URL, () => new HttpResponse(null, { status: 429 })));
    await expect(openErApi.fetchRates({ quote: 'IDR', bases: ['USD'] })).rejects.toThrow('open-er-api: HTTP 429');
  });
});
