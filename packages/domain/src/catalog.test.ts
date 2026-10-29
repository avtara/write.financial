// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { getCatalogRecord, searchCatalog } from './catalog.ts';

describe('local reference search', () => {
  it('finds Indonesian banks by alias, case-insensitively, without leaking other kinds or account types', () => {
    expect(
      searchCatalog('  bank   central asia  ', { kind: 'provider', accountType: 'bank' }).map((r) => r.id),
    ).toEqual(['provider:bca']);
    expect(searchCatalog('bca', { kind: 'provider', accountType: 'credit_card' })[0]?.id).toBe('provider:bca');
    expect(searchCatalog('bca', { kind: 'provider', accountType: 'ewallet' })).toEqual([]);
    expect(searchCatalog('gopay', { kind: 'provider', accountType: 'ewallet' })[0]?.name).toBe('GoPay');
    expect(searchCatalog('IBKR', { kind: 'provider', accountType: 'investment' })[0]?.name).toBe('Interactive Brokers');
    expect(searchCatalog('sentral', { kind: 'provider' })).toEqual([]);
    expect(searchCatalog('rakyat', { kind: 'provider' })[0]?.id).toBe('provider:bri');
  });

  it('never opens the whole directory and bounds broad queries even when a larger limit is requested', () => {
    expect(searchCatalog(' \t ', { kind: 'provider' })).toEqual([]);
    expect(searchCatalog('a', { kind: 'provider' })).toHaveLength(6);
    expect(searchCatalog('a', { kind: 'provider', limit: 100 })).toHaveLength(8);
    expect(searchCatalog('a', { kind: 'provider', limit: 2.9 })).toHaveLength(2);
    expect(searchCatalog('a', { kind: 'provider', limit: -1 })).toEqual([]);
  });

  it('finds common subscriptions by name and alias without suggesting prices or billing dates', () => {
    expect(searchCatalog('Netflix', { kind: 'service' })[0]?.id).toBe('service:netflix');
    expect(searchCatalog('YT Premium', { kind: 'service' })[0]?.name).toBe('YouTube Premium');
    expect(searchCatalog('spotify premium', { kind: 'service' })[0]?.name).toBe('Spotify');
    expect(searchCatalog('not listed locally', { kind: 'service' })).toEqual([]);
  });

  it('searches listing identity by ticker/company, filtering the selected platform quote currency', () => {
    expect(searchCatalog('BCA', { kind: 'instrument', currency: 'IDR' })[0]).toMatchObject({
      id: 'stock:xidx:bbca',
      symbol: 'BBCA',
      venue: 'XIDX',
      currency: 'IDR',
      market: 'idx_equity',
      assetClass: 'indonesia',
    });
    expect(searchCatalog('AAPL', { kind: 'instrument', currency: 'IDR' })).toEqual([]);
    expect(searchCatalog('Apple', { kind: 'instrument', currency: 'USD' })[0]?.id).toBe('stock:xnas:aapl');
    expect(searchCatalog('Telkom', { kind: 'instrument' }).map((r) => [r.symbol, r.venue, r.currency])).toEqual([
      ['TLKM', 'XIDX', 'IDR'],
      ['TLK', 'XNYS', 'USD'],
    ]);
    expect(searchCatalog('Telkom', { kind: 'instrument', currency: 'USD' }).map((r) => r.id)).toEqual([
      'stock:xnys:tlk',
    ]);
    expect(searchCatalog('Telkom', { kind: 'instrument', currency: '' })).toEqual([]);
  });

  it('resolves persisted associations exactly and leaves unknown/manual identities unbranded', () => {
    expect(getCatalogRecord('provider:bca')?.logoPath).toBe('/catalog-logos/bca.svg');
    expect(getCatalogRecord('stock:xidx:bbca')?.logoPath).toBe('/catalog-logos/bca.svg');
    expect(getCatalogRecord('service:spotify')?.logoPath).toBe('/catalog-logos/spotify.svg');
    expect(getCatalogRecord('provider:stockbit')?.logoPath).toBeNull();
    for (const id of [undefined, null, '', 'not-in-catalog', 'constructor', '__proto__']) {
      expect(getCatalogRecord(id)).toBeNull();
    }
  });
});
