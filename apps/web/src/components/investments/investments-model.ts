// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure helpers of the "Investasi" page (design 09): labels and colours per asset class, unit and price formatting,
 * the holdings table's groups ("Daftar saya" / "Kelas aset" / "Platform") and search, the price status of the
 * portfolio (newest quote, unpriced and stale assets), the growth chart's month points, the rebalancing items per
 * class, the USD toggle, and the goal sources of an asset. Valuation itself is `@wf/domain/valuation`.
 */
import type { AssetView, PortfolioSnapshotInput, PortfolioView } from '@wf/db/investments';
import { ratioBps } from '@wf/domain/budget';
import { formatDecimal, parseDecimal, roundDecimal } from '@wf/domain/decimal';
import { convert } from '@wf/domain/fx';
import type { GoalAssetSource } from '@wf/domain/goal-assets';
import { marketValueMinor, type AssetClass, type PriceMode } from '@wf/domain/investments';
import type { Market, QuoteLabel, ResolvedQuote } from '@wf/domain/market';
import type { YearMonth } from '@wf/domain/period';
import {
  growthRangeStart,
  type GrowthRange,
  type PortfolioSnapshot,
  type PositionValue,
  type RebalanceItem,
} from '@wf/domain/valuation';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';

export type HoldingsGrouping = 'list' | 'class' | 'platform';
export type DisplayCurrency = 'base' | 'usd';

/** Design 09 colours of the asset classes (allocation donut, dots, bars). */
export const CLASS_TONE: Readonly<
  Record<AssetClass, { readonly dot: string; readonly fill: string; readonly stroke: string }>
> = {
  us_stocks: { dot: 'bg-blue', fill: 'fill-blue', stroke: 'stroke-blue' },
  international: { dot: 'bg-cyan', fill: 'fill-cyan', stroke: 'stroke-cyan' },
  indonesia: { dot: 'bg-rose', fill: 'fill-rose', stroke: 'stroke-rose' },
  crypto: { dot: 'bg-orange', fill: 'fill-orange', stroke: 'stroke-orange' },
  cash: { dot: 'bg-subtle', fill: 'fill-subtle', stroke: 'stroke-subtle' },
  gold: { dot: 'bg-yellow', fill: 'fill-yellow', stroke: 'stroke-yellow' },
  income: { dot: 'bg-violet', fill: 'fill-violet', stroke: 'stroke-violet' },
};

const CLASS_LABELS: Readonly<Record<AssetClass, () => string>> = {
  us_stocks: m.invest_class_us_stocks,
  international: m.invest_class_international,
  indonesia: m.invest_class_indonesia,
  crypto: m.invest_class_crypto,
  cash: m.invest_class_cash,
  gold: m.invest_class_gold,
  income: m.invest_class_income,
};

/** "Saham AS", "Internasional", … */
export function classLabel(assetClass: AssetClass): string {
  return CLASS_LABELS[assetClass]();
}

const MARKET_LABELS: Readonly<Record<Market, () => string>> = {
  fx: m.invest_market_fx,
  us_equity: m.invest_market_us_equity,
  idx_equity: m.invest_market_idx_equity,
  crypto: m.invest_market_crypto,
  gold_spot: m.invest_market_gold_spot,
  gold_antam: m.invest_market_gold_antam,
  mutual_fund: m.invest_market_mutual_fund,
  sbn: m.invest_market_sbn,
};

export function marketLabel(market: Market): string {
  return MARKET_LABELS[market]();
}

const PRICE_MODE_LABELS: Readonly<Record<PriceMode, () => string>> = {
  server: m.invest_price_mode_server,
  byok: m.invest_price_mode_byok,
  manual: m.invest_price_mode_manual,
  computed: m.invest_price_mode_computed,
};

export function priceModeLabel(mode: PriceMode): string {
  return PRICE_MODE_LABELS[mode]();
}

/** FR-I5 labels: "tertunda", "penutupan", "manual", "estimasi", "terakhir" — never "real-time". */
const QUOTE_LABELS: Readonly<Record<QuoteLabel, () => string>> = {
  delayed: m.invest_quote_delayed,
  close: m.invest_quote_close,
  manual: m.invest_quote_manual,
  estimate: m.invest_quote_estimate,
  last: m.invest_quote_last,
};

export function quoteLabel(label: QuoteLabel): string {
  return QUOTE_LABELS[label]();
}

/** Units for display: at most `digits` fraction digits, rounded half up ("1,197", "0,0725"). */
export function formatUnits(units: string, locale: Locale, digits = 4): string {
  const rounded = formatDecimal(roundDecimal(parseDecimal(units), digits));
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(rounded as `${number}`);
}

/** A price per unit as an amount in `currency`'s minor units (US$690,10 → 69 010), for `<Money>`. */
export function priceMinor(price: string, currency: string): bigint {
  return marketValueMinor('1', price, currency);
}

/**
 * A decimal typed in `locale` ("0,0725" in id, "0.0725" in en; group separators dropped) as a canonical string;
 * `null` unless it is a positive number with at most 18 fraction digits.
 */
export function decimalInput(text: string, locale: Locale): string | null {
  const plain = locale === 'id' ? text.trim().replaceAll('.', '').replace(',', '.') : text.trim().replaceAll(',', '');
  if (!/^\d{1,20}(\.\d{1,18})?$/.test(plain)) return null;
  const scaled = parseDecimal(plain);
  return scaled > 0n ? formatDecimal(scaled) : null;
}

/** A canonical decimal as `locale` writes it, without grouping (an input's starting text). */
export function decimalText(value: string, locale: Locale): string {
  return new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 18 }).format(value as `${number}`);
}

/** A base-currency amount in US dollars at `usdRate` (1 USD = rate base). */
export function toUsd(baseMinor: bigint, base: string, usdRate: string): bigint {
  return convert({ minor: baseMinor, currency: base }, 'USD', { base: 'USD', quote: base, rate: usdRate });
}

/** The goal sources of an asset in `@wf/domain/goal-assets` form. */
export function assetSources(asset: Pick<AssetView, 'goals'>): GoalAssetSource[] {
  return asset.goals.map((goal) => ({ goalId: goal.goalId, mode: goal.mode, bps: goal.bps }));
}

/** Whether the asset holds anything (units, cost, or a pending buy). */
export function isHeld(asset: AssetView): boolean {
  return asset.holding.units !== '0' || asset.holding.costBaseMinor !== 0n || asset.pendingMinor !== 0n;
}

export interface QuoteStatus {
  /** The newest quote of a held asset ("harga 16.42 WIB"); `null` without any. */
  readonly newest: ResolvedQuote | null;
  /** Held assets without any price, valued at cost (FR-G6). */
  readonly unpriced: readonly AssetView[];
  /** Held assets priced from an old quote ("memakai harga terakhir"). */
  readonly stale: readonly AssetView[];
}

/** FR-I5 price status of the held assets. */
export function quoteStatus(assets: readonly AssetView[]): QuoteStatus {
  const held = assets.filter((asset) => asset.holding.units !== '0');
  const quoted = held.flatMap((asset) => (asset.quote === null ? [] : [asset.quote]));
  return {
    newest: quoted.reduce<ResolvedQuote | null>(
      (best, quote) => (best === null || quote.asOf > best.asOf ? quote : best),
      null,
    ),
    unpriced: held.filter((asset) => asset.quote === null),
    stale: held.filter((asset) => asset.quote?.stale === true),
  };
}

/** One line of the holdings table: an asset, or a platform's cash. */
export type HoldingItem =
  | { readonly kind: 'asset'; readonly asset: AssetView }
  | {
      readonly kind: 'cash';
      readonly key: string;
      readonly accountId: string;
      readonly platformName: string;
      readonly currency: string;
      readonly cashMinor: bigint;
      readonly position: PositionValue;
    };

export interface HoldingGroup {
  readonly key: string;
  /** `single`: one asset outside any category (a plain row); the others render as a group heading. */
  readonly kind: 'single' | 'category' | 'class' | 'platform';
  readonly title: string;
  readonly assetClass: AssetClass | null;
  readonly items: readonly HoldingItem[];
  readonly valueBaseMinor: bigint;
  readonly gainBaseMinor: bigint;
  readonly costBaseMinor: bigint;
  readonly realizedBaseMinor: bigint;
  /** Share of the portfolio value. */
  readonly shareBps: number | null;
  /** The class target (class groups and categories, which carry a class). */
  readonly targetBps: number | null;
  /** The quote currency every item shares (for "US$331,50"), else `null`. */
  readonly currency: string | null;
  readonly valueMinor: bigint | null;
}

const itemValue = (item: HoldingItem): bigint =>
  item.kind === 'cash' ? item.position.valueBaseMinor : (item.asset.value?.valueBaseMinor ?? 0n);

/** Realized gain of an asset in the base currency (cash has none). */
const itemRealized = (item: HoldingItem): bigint => (item.kind === 'cash' ? 0n : item.asset.holding.realizedBaseMinor);

function itemCurrency(item: HoldingItem): string {
  return item.kind === 'cash' ? item.currency : item.asset.quoteCurrency;
}

function itemValueMinor(item: HoldingItem): bigint {
  return item.kind === 'cash' ? item.position.valueMinor : (item.asset.value?.valueMinor ?? 0n);
}

function group(
  portfolio: PortfolioView,
  head: Pick<HoldingGroup, 'key' | 'kind' | 'title' | 'assetClass'>,
  items: readonly HoldingItem[],
): HoldingGroup {
  const valueBaseMinor = items.reduce((sum, item) => sum + itemValue(item), 0n);
  const costBaseMinor = items.reduce(
    (sum, item) => sum + (item.kind === 'cash' ? item.position.costBaseMinor : (item.asset.value?.costBaseMinor ?? 0n)),
    0n,
  );
  const currencies = new Set(items.map(itemCurrency));
  const currency = currencies.size === 1 ? ([...currencies][0] as string) : null;
  return {
    ...head,
    items,
    valueBaseMinor,
    costBaseMinor,
    gainBaseMinor: valueBaseMinor - costBaseMinor,
    realizedBaseMinor: items.reduce((sum, item) => sum + itemRealized(item), 0n),
    shareBps: ratioBps(valueBaseMinor, portfolio.summary.valueBaseMinor),
    targetBps: head.assetClass === null ? null : (portfolio.targets[head.assetClass] ?? null),
    currency,
    valueMinor: currency === null ? null : items.reduce((sum, item) => sum + itemValueMinor(item), 0n),
  };
}

/** Every asset (also one just added and not bought yet, so it can be bought from its row) and every platform's cash. */
export function holdingItems(portfolio: PortfolioView): HoldingItem[] {
  const cash = portfolio.platforms.flatMap((platform): HoldingItem[] => {
    const position = portfolio.summary.positions.find((candidate) => candidate.key === `cash:${platform.accountId}`);
    return position === undefined
      ? []
      : [
          {
            kind: 'cash',
            key: position.key,
            accountId: platform.accountId,
            platformName: platform.name,
            currency: platform.currency,
            cashMinor: platform.cashMinor,
            position,
          },
        ];
  });
  return [...portfolio.assets.map((asset): HoldingItem => ({ kind: 'asset', asset })), ...cash];
}

/** Whether `item` matches the search ("yield": ticker, name, or its category's name). */
function matches(item: HoldingItem, query: string, categoryName: (id: string | null) => string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') return true;
  const haystack =
    item.kind === 'cash'
      ? [m.invest_cash_name({ platform: item.platformName }), item.currency]
      : [item.asset.symbol, item.asset.name, categoryName(item.asset.categoryId)];
  return haystack.some((text) => text.toLocaleLowerCase().includes(needle));
}

/**
 * FR-I4 groups of the holdings table. "Daftar saya": single assets first, then each category; "Kelas aset": one
 * group per class (design order); "Platform": one group per platform with its cash. Cash rows belong to class "Kas".
 */
export function holdingGroups(portfolio: PortfolioView, grouping: HoldingsGrouping, query = ''): HoldingGroup[] {
  const categoryName = (id: string | null) => portfolio.categories.find((category) => category.id === id)?.name ?? '';
  const items = holdingItems(portfolio).filter((item) => matches(item, query, categoryName));
  const classOf = (item: HoldingItem): AssetClass => (item.kind === 'cash' ? 'cash' : item.asset.assetClass);
  const platformOf = (item: HoldingItem) => (item.kind === 'cash' ? item.accountId : item.asset.accountId);
  if (grouping === 'class') {
    const classes = [...new Set(items.map(classOf))];
    return Object.keys(CLASS_TONE)
      .filter((assetClass): assetClass is AssetClass => classes.includes(assetClass as AssetClass))
      .map((assetClass) =>
        group(
          portfolio,
          { key: assetClass, kind: 'class', title: classLabel(assetClass), assetClass },
          items.filter((item) => classOf(item) === assetClass),
        ),
      );
  }
  if (grouping === 'platform') {
    return portfolio.platforms.flatMap((platform) => {
      const own = items.filter((item) => platformOf(item) === platform.accountId);
      return own.length === 0
        ? []
        : [
            group(
              portfolio,
              { key: platform.accountId, kind: 'platform', title: platform.name, assetClass: null },
              own,
            ),
          ];
    });
  }
  const singles = items
    .filter((item) => item.kind === 'cash' || item.asset.categoryId === null)
    .map((item) =>
      group(
        portfolio,
        {
          key: item.kind === 'cash' ? item.key : item.asset.id,
          kind: 'single',
          title: item.kind === 'cash' ? m.invest_cash_name({ platform: item.platformName }) : item.asset.symbol,
          assetClass: classOf(item),
        },
        [item],
      ),
    );
  const categories = portfolio.categories.flatMap((category) => {
    const own = items.filter((item) => item.kind === 'asset' && item.asset.categoryId === category.id);
    return own.length === 0
      ? []
      : [
          group(
            portfolio,
            { key: category.id, kind: 'category', title: category.name, assetClass: category.assetClass },
            own,
          ),
        ];
  });
  return [...singles, ...categories];
}

/** The month a snapshot closes (`2026-09-30` → `2026-09`). */
const monthOf = (date: string) => date.slice(0, 7) as YearMonth;

/**
 * Growth chart points (FR-I3): each month's last snapshot, then this month's live value. The live point's
 * contributions are its cost basis change since the last snapshot (buys add cost, sales remove it).
 */
export function growthPoints(
  snapshots: readonly PortfolioSnapshotInput[],
  live: { readonly month: YearMonth; readonly valueMinor: bigint; readonly costMinor: bigint },
): PortfolioSnapshot[] {
  const byMonth = new Map<YearMonth, PortfolioSnapshot>();
  for (const snapshot of [...snapshots].sort((a, b) => a.date.localeCompare(b.date))) {
    const month = monthOf(snapshot.date);
    if (month >= live.month) continue;
    byMonth.set(month, {
      month,
      valueMinor: snapshot.valueBaseMinor,
      costMinor: snapshot.costBaseMinor,
      contributionsMinor: snapshot.contributionsBaseMinor,
    });
  }
  const points = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  const previous = points.at(-1);
  return [
    ...points,
    {
      month: live.month,
      valueMinor: live.valueMinor,
      costMinor: live.costMinor,
      contributionsMinor: previous === undefined ? live.costMinor : live.costMinor - previous.costMinor,
    },
  ];
}

/** The points of `range` (YTD keeps last December as its baseline). */
export function pointsInRange(points: readonly PortfolioSnapshot[], range: GrowthRange): PortfolioSnapshot[] {
  const current = points.at(-1);
  if (current === undefined) return [];
  const start = growthRangeStart(range, current.month);
  return start === null ? [...points] : points.filter((point) => point.month >= start);
}

/**
 * FR-I3 rebalancing items per asset class; a class held wholly in one other currency also gets its quote reference
 * ("+US$113,76") when the rate to it is known.
 */
export function rebalanceItems(portfolio: PortfolioView, rates: Readonly<Record<string, string>>): RebalanceItem[] {
  const allocation = portfolio.allocation;
  if (allocation === null) return [];
  return allocation.rows.map((row) => {
    const currencies = new Set(
      holdingItems(portfolio)
        .filter((item) => (item.kind === 'cash' ? 'cash' : item.asset.assetClass) === row.key)
        .map(itemCurrency),
    );
    const only = currencies.size === 1 ? ([...currencies][0] as string) : null;
    const rate = only === null || only === portfolio.baseCurrency ? undefined : rates[only];
    return {
      key: row.key,
      valueMinor: row.valueMinor,
      quote: rate === undefined ? null : { currency: only as string, fxRate: rate },
    };
  });
}
