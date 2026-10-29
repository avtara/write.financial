// SPDX-License-Identifier: AGPL-3.0-only
import { setLocale } from '@wf/i18n/runtime';
import type { YearMonth } from '@wf/domain/period';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BBCA,
  BTC,
  investmentsOverview,
  manualQuote,
  portfolioView,
  RDPU,
  SEED_ASSETS,
  SPY,
} from '../../../test/investment-fixtures.ts';
import {
  assetSources,
  decimalInput,
  decimalText,
  formatUnits,
  growthPoints,
  holdingGroups,
  holdingItems,
  isHeld,
  marketLabel,
  pointsInRange,
  priceMinor,
  priceModeLabel,
  quoteLabel,
  quoteStatus,
  rebalanceItems,
  toUsd,
} from './investments-model.ts';

beforeAll(async () => {
  await setLocale('id', { reload: false });
});

const ym = (value: string) => value as YearMonth;

describe('labels and decimal inputs', () => {
  it('labels every market, price mode, and quote source', async () => {
    expect(marketLabel('fx')).toBe('Kurs');
    expect(marketLabel('us_equity')).toBe('Saham/ETF AS');
    expect(marketLabel('idx_equity')).toBe('Saham BEI');
    expect(marketLabel('crypto')).toBe('Kripto');
    expect(marketLabel('gold_spot')).toBe('Emas spot');
    expect(marketLabel('gold_antam')).toBe('Emas Antam');
    expect(marketLabel('mutual_fund')).toBe('Reksa dana');
    expect(marketLabel('sbn')).toBe('SBN ritel');
    expect(priceModeLabel('server')).toBe('Bawaan server');
    expect(priceModeLabel('byok')).toBe('Key pribadi (BYOK)');
    expect(priceModeLabel('manual')).toBe('Manual');
    expect(priceModeLabel('computed')).toBe('Dihitung (estimasi)');
    expect(quoteLabel('delayed')).toBe('tertunda');
    expect(quoteLabel('close')).toBe('penutupan');
    expect(quoteLabel('manual')).toBe('manual');
    expect(quoteLabel('estimate')).toBe('estimasi');
    expect(quoteLabel('last')).toBe('terakhir');
    await setLocale('en', { reload: false });
    expect(marketLabel('crypto')).toBe('Crypto');
    await setLocale('id', { reload: false });
  });

  it('reads a typed decimal in each locale and writes one back without grouping', () => {
    expect(decimalInput('0,0725', 'id')).toBe('0.0725');
    expect(decimalInput('1.234,5', 'id')).toBe('1234.5');
    expect(decimalInput('0.0725', 'en')).toBe('0.0725');
    expect(decimalInput('1,234.5', 'en')).toBe('1234.5');
    expect(decimalInput(' 12 ', 'id')).toBe('12');
    expect(decimalInput('0', 'id')).toBeNull();
    expect(decimalInput('-1', 'id')).toBeNull();
    expect(decimalInput('1,2,3', 'id')).toBeNull();
    expect(decimalInput('1.1234567890123456789', 'en')).toBeNull();
    expect(decimalText('0.0725', 'id')).toBe('0,0725');
    expect(decimalText('1234.5', 'en')).toBe('1234.5');
  });
});

describe('formatting', () => {
  it('rounds units for display and turns prices into amounts', () => {
    expect(formatUnits('1.196475979415', 'id', 3)).toBe('1,196');
    expect(formatUnits('0.07245326764237', 'id')).toBe('0,0725');
    expect(formatUnits('1500000', 'en', 0)).toBe('1,500,000');
    expect(priceMinor('690.10', 'USD')).toBe(69_010n);
    expect(priceMinor('8025', 'IDR')).toBe(8_025n);
    expect(toUsd(61_420_000n, 'IDR', '16350')).toBe(375_657n);
  });
});

describe('quote status', () => {
  it('takes the newest quote of a held asset and lists the unpriced and stale ones', () => {
    const newer = { ...BTC, quote: manualQuote('1', { asOf: SPY.quote?.asOf ?? 0 + 1, label: 'delayed' }) };
    expect(quoteStatus(SEED_ASSETS)).toEqual({ newest: SPY.quote, unpriced: [], stale: [] });
    const unpriced = { ...BBCA, quote: null };
    const stale = { ...SPY, quote: manualQuote('690.1', { stale: true, asOf: 1, label: 'last', source: 'last' }) };
    const later = { ...BTC, quote: manualQuote('1', { asOf: (SPY.quote?.asOf as number) + 1, label: 'delayed' }) };
    const status = quoteStatus([stale, unpriced, later, newer, { ...RDPU, quote: null }]);
    expect(status.newest).toBe(later.quote);
    expect(status.unpriced).toEqual([unpriced]);
    expect(status.stale).toEqual([stale]);
    expect(quoteStatus([]).newest).toBeNull();
  });
});

describe('holdings', () => {
  const portfolio = portfolioView();

  it('lists held assets and the platforms’ cash', () => {
    const items = holdingItems(portfolio);
    // RDPU is a pending buy: still held (paid, units to come).
    expect(isHeld(RDPU)).toBe(true);
    expect(isHeld({ ...RDPU, pendingMinor: 0n })).toBe(false);
    expect(items.filter((item) => item.kind === 'cash')).toEqual([
      expect.objectContaining({ platformName: 'Gotrade', currency: 'USD', cashMinor: 5_199n }),
    ]);
    expect(items.filter((item) => item.kind === 'asset')).toHaveLength(SEED_ASSETS.length);
  });

  it('“Daftar saya”: single assets and cash first, then the categories with their totals', () => {
    const groups = holdingGroups(portfolio, 'list');
    expect(groups.filter((entry) => entry.kind === 'single').map((entry) => entry.title)).toEqual([
      'SPY',
      'QQQ',
      'VEA',
      'SCHD',
      'VWO',
      'SGOV',
      'BTC',
      'XAU',
      'RDPU',
      'Kas Gotrade',
    ]);
    const categories = groups.filter((entry) => entry.kind === 'category');
    expect(categories.map((entry) => [entry.title, entry.items.length, entry.valueBaseMinor])).toEqual([
      ['Indonesia', 5, 6_800_000n],
      ['YieldMax', 4, 3_100_000n],
      ['US individual', 5, 5_420_000n],
    ]);
    // No rate to the base currency: the asset counts nothing in the totals.
    const unvalued = holdingGroups(portfolioView({ assets: [{ ...SPY, value: null }] }), 'list')[0];
    expect([unvalued?.valueBaseMinor, unvalued?.costBaseMinor, unvalued?.valueMinor]).toEqual([0n, 0n, 0n]);
    const yieldmax = categories[1];
    expect([yieldmax?.currency, yieldmax?.targetBps, yieldmax?.shareBps]).toEqual(['USD', 600, 505]);
    expect(yieldmax?.valueMinor).toBe(18_960n);
    const indonesia = categories[0];
    expect([indonesia?.currency, indonesia?.valueMinor]).toEqual(['IDR', 6_800_000n]);
    const spy = groups[0];
    expect([spy?.valueBaseMinor, spy?.gainBaseMinor, spy?.shareBps, spy?.realizedBaseMinor]).toEqual([
      13_500_000n,
      2_100_000n,
      2198,
      0n,
    ]);
    // Realized: the sales' gain plus the dividends that went out in cash.
    const dividend = { ...SPY, dividendCashMinor: 700n, dividendCashBaseMinor: 1_163_000n };
    const [only] = holdingGroups(portfolioView({ assets: [dividend] }), 'list');
    expect(only?.realizedBaseMinor).toBe(1_163_000n);
  });

  it('searches tickers, names and category names (“yield” → 4 YieldMax assets + SCHD)', () => {
    const groups = holdingGroups(portfolio, 'list', ' Yield ');
    expect(groups.flatMap((entry) => entry.items).length).toBe(4);
    expect(holdingGroups(portfolio, 'list', 'kas').map((entry) => entry.title)).toEqual(['Kas Gotrade']);
    expect(holdingGroups(portfolio, 'list', 'tidak ada')).toEqual([]);
  });

  it('groups by class with targets, and by platform with its cash', () => {
    const classes = holdingGroups(portfolio, 'class');
    expect(classes.map((entry) => [entry.key, entry.targetBps])).toEqual([
      ['us_stocks', 5000],
      ['international', 1200],
      ['indonesia', 1200],
      ['crypto', 700],
      ['cash', 800],
      ['gold', 500],
      ['income', 600],
    ]);
    expect(classes.reduce((sum, entry) => sum + entry.valueBaseMinor, 0n)).toBe(61_420_000n);
    const platforms = holdingGroups(portfolio, 'platform');
    expect(platforms.map((entry) => [entry.title, entry.valueBaseMinor])).toEqual([
      ['Gotrade', 45_420_000n],
      ['Indodax', 5_500_000n],
      ['Stockbit', 4_300_000n],
      ['Pluang', 3_700_000n],
      ['Bibit', 2_500_000n],
    ]);
    expect(holdingGroups(portfolio, 'platform', 'BTC').map((entry) => entry.title)).toEqual(['Indodax']);
    const noTargets = portfolioView({ targets: {} });
    expect(holdingGroups(noTargets, 'class')[0]?.targetBps).toBeNull();
    expect(holdingGroups(portfolioView({ assets: [] }), 'list').map((entry) => entry.title)).toEqual(['Kas Gotrade']);
  });
});

describe('growth', () => {
  const live = { month: ym('2026-10'), valueMinor: 61_420_000n, costMinor: 53_931_000n };
  const snapshot = (date: string, value: bigint, cost: bigint, contributions = 0n) => ({
    date: date as never,
    valueBaseMinor: value,
    costBaseMinor: cost,
    contributionsBaseMinor: contributions,
  });

  it('keeps each month’s last snapshot and adds the live month (contributions = cost change)', () => {
    const points = growthPoints(investmentsOverview().snapshots, live);
    expect(points).toEqual([
      { month: '2026-09', valueMinor: 57_700_000n, costMinor: 50_900_000n, contributionsMinor: 3_000_000n },
      { month: '2026-10', valueMinor: 61_420_000n, costMinor: 53_931_000n, contributionsMinor: 3_031_000n },
    ]);
    const several = growthPoints(
      [
        snapshot('2026-08-31', 50n, 40n),
        snapshot('2025-12-31', 10n, 10n),
        snapshot('2026-10-14', 99n, 99n),
        snapshot('2026-08-15', 45n, 40n),
      ],
      live,
    );
    expect(several.map((point) => [point.month, point.valueMinor])).toEqual([
      ['2025-12', 10n],
      ['2026-08', 50n],
      ['2026-10', 61_420_000n],
    ]);
    expect(growthPoints([], live)[0]?.contributionsMinor).toBe(53_931_000n);
  });

  it('cuts the ranges (YTD from last December, 1B the month before, Semua all)', () => {
    const points = growthPoints(
      [snapshot('2025-11-30', 1n, 1n), snapshot('2025-12-31', 2n, 2n), snapshot('2026-09-30', 3n, 3n)],
      live,
    );
    expect(pointsInRange(points, 'ytd').map((point) => point.month)).toEqual(['2025-12', '2026-09', '2026-10']);
    expect(pointsInRange(points, '1m').map((point) => point.month)).toEqual(['2026-09', '2026-10']);
    expect(pointsInRange(points, 'all')).toHaveLength(4);
    expect(pointsInRange([], 'all')).toEqual([]);
  });
});

describe('rebalancing items and goal sources', () => {
  it('rebalances per class, with a USD reference for classes held only in USD', () => {
    const items = rebalanceItems(portfolioView(), { USD: '16350' });
    expect(items.find((item) => item.key === 'us_stocks')).toEqual({
      key: 'us_stocks',
      valueMinor: 31_220_000n,
      quote: { currency: 'USD', fxRate: '16350' },
    });
    expect(items.find((item) => item.key === 'crypto')?.quote).toBeNull();
    expect(rebalanceItems(portfolioView(), {}).every((item) => item.quote === null)).toBe(true);
    expect(rebalanceItems(portfolioView({ targets: {} }), {})).toEqual([]);
  });

  it('maps an asset’s goals to domain sources', () => {
    expect(assetSources(SPY)).toEqual([
      { goalId: 'goal-rumah', mode: 'percent', bps: 6000 },
      { goalId: 'goal-pensiun', mode: 'percent', bps: 4000 },
    ]);
  });
});
