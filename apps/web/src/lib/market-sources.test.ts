// SPDX-License-Identifier: AGPL-3.0-only
import { BYOK_PROVIDERS, EGRESS_ALLOWLIST } from '@wf/domain/market';
import { describe, expect, it } from 'vitest';
import { byokProvidersOf, FREE_KEY_URLS, PROBE_SYMBOLS, PROVIDER_MARKET, SYNC_MARKETS } from './market-sources.ts';

describe('market sources', () => {
  it('maps every BYOK provider to its one market, in fallback order', () => {
    expect(PROVIDER_MARKET).toEqual({
      tiingo: 'us_equity',
      finnhub: 'us_equity',
      massive: 'us_equity',
      alpha_vantage: 'us_equity',
      eodhd: 'idx_equity',
      marketstack: 'idx_equity',
      coinmarketcap: 'crypto',
      coingecko: 'crypto',
      goldapi: 'gold_spot',
      metals_dev: 'gold_spot',
    });
    expect(SYNC_MARKETS.map(byokProvidersOf)).toEqual([
      ['tiingo', 'finnhub', 'massive', 'alpha_vantage'],
      ['eodhd', 'marketstack'],
      ['coinmarketcap', 'coingecko'],
      ['goldapi', 'metals_dev'],
    ]);
    expect(Object.keys(PROBE_SYMBOLS)).toEqual([...SYNC_MARKETS]);
  });

  it('links every free-key page over HTTPS', () => {
    for (const provider of BYOK_PROVIDERS) {
      expect(new URL(FREE_KEY_URLS[provider]).protocol).toBe('https:');
      expect(EGRESS_ALLOWLIST[provider].length).toBeGreaterThan(0);
    }
  });
});
