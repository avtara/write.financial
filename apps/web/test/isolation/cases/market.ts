// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/market.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`. A has an own Tiingo key with prices it fetched and a logged request
 * (M5 exit: user A's BYOK results are never readable by user B); B sees, changes, tests, and deletes none of it.
 */
import type { ApiLogView } from '@wf/db/market-data';
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import type { MarketSettings } from '../../../src/server/fn/market.ts';
import { aId, as, bId, type Case, type Name, ok, superuser, UNAUTHENTICATED } from '../harness.ts';

/** A's own key, one price it fetched, and one request it made; inserted once, before the first case runs. */
let seeded: Promise<void> | undefined;
function seedA(): Promise<void> {
  seeded ??= (async () => {
    await superuser`
      INSERT INTO market_credentials (user_id, provider, api_key_enc, last4, status)
      VALUES (${aId}, 'tiingo', '\\x01', 'a4a4', 'connected') ON CONFLICT DO NOTHING`;
    await superuser`
      INSERT INTO user_quotes (user_id, provider, symbol, quote_currency, bucket_ts, price)
      VALUES (${aId}, 'tiingo', 'SPY', 'USD', '2026-10-14T20:00:00Z', 690.1) ON CONFLICT DO NOTHING`;
    await superuser`
      INSERT INTO market_api_logs (user_id, provider, endpoint, http_status, ok, duration_ms, at)
      VALUES (${aId}, 'tiingo', 'GET /iex · spy', 200, true, 12, now())`;
  })();
  return seeded;
}

const aRows = async () => ({
  keys: await superuser`SELECT provider, last4, active, status FROM market_credentials WHERE user_id = ${aId}`,
  quotes: await superuser`SELECT provider, symbol, price::text FROM user_quotes WHERE user_id = ${aId}`,
});

export const cases = {
  getMarketSettings: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      await seedA();
      const ofB = await as<Result<MarketSettings>>('B', 'getMarketSettings');
      expect(ofB.ok && [ofB.value.keys, ofB.value.quoteCounts]).toEqual([[], {}]);
      const ofA = await as<Result<MarketSettings>>('A', 'getMarketSettings');
      expect(ofA.ok && ofA.value.keys.map((key) => [key.provider, key.last4])).toEqual([['tiingo', 'a4a4']]);
      expect(ofA.ok && ofA.value.quoteCounts).toEqual({ tiingo: 1 });
    },
  },
  saveMarketKey: {
    input: () => ({ provider: 'tiingo', apiKey: 'fake-isolation-key' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seedA();
      const before = await aRows();
      // B (2FA on) saves its own Tiingo key; A's key with the same provider is untouched and never returned.
      const saved = await as('B', 'saveMarketKey', input);
      expect(saved).toMatchObject(ok({ provider: 'tiingo', last4: '-key' }));
      expect(JSON.stringify(saved)).not.toContain('fake-isolation-key');
      expect(await superuser`SELECT last4 FROM market_credentials WHERE user_id = ${bId}`).toEqual([{ last4: '-key' }]);
      expect(await aRows()).toEqual(before);
    },
  },
  setMarketKeyActive: {
    input: () => ({ provider: 'tiingo', active: false }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seedA();
      const before = await aRows();
      // Only B's own key (if any) is switched off; A's stays on.
      const answer = await as<Result<{ provider: string }>>('B', 'setMarketKeyActive', input);
      expect(answer.ok ? answer.value.provider : answer.code).toMatch(/^(tiingo|NOT_FOUND)$/);
      expect(await aRows()).toEqual(before);
      expect(before.keys).toMatchObject([{ active: true }]);
    },
  },
  removeMarketKey: {
    input: () => ({ provider: 'tiingo' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seedA();
      const before = await aRows();
      // B deletes only its own key (and its own prices: none); A's key and the prices it fetched survive.
      const answer = await as<Result<{ quotesDeleted: number }>>('B', 'removeMarketKey', input);
      expect(String(answer.ok ? answer.value.quotesDeleted : answer.code)).toMatch(/^(0|NOT_FOUND)$/);
      expect(await superuser`SELECT * FROM market_credentials WHERE user_id = ${bId}`).toEqual([]);
      expect(await aRows()).toEqual(before);
      expect(before.quotes).toHaveLength(1);
    },
  },
  testMarketKey: {
    input: () => ({ provider: 'tiingo' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seedA();
      const before = await aRows();
      // B has no key: nothing is asked with A's.
      expect(await as('B', 'testMarketKey', input)).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(await aRows()).toEqual(before);
    },
  },
  syncMarketSource: {
    input: () => ({ market: 'us_equity' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seedA();
      const before = await aRows();
      // Only B's keys count: A's Tiingo key never prices B's symbols.
      expect(await as('B', 'syncMarketSource', input)).toMatchObject(ok({ market: 'us_equity', status: 'no_key' }));
      expect(await aRows()).toEqual(before);
      expect(await superuser`SELECT * FROM user_quotes WHERE user_id = ${bId}`).toEqual([]);
    },
  },
  getMarketApiLog: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seedA();
      const ofB = await as<Result<ApiLogView[]>>('B', 'getMarketApiLog', input);
      expect(ofB.ok && ofB.value.filter((entry) => entry.own)).toEqual([]);
      const ofA = await as<Result<ApiLogView[]>>('A', 'getMarketApiLog', input);
      expect(ofA.ok && ofA.value.filter((entry) => entry.own).map((entry) => entry.endpoint)).toContain(
        'GET /iex · spy',
      );
    },
  },
} satisfies Partial<Record<Name, Case>>;
