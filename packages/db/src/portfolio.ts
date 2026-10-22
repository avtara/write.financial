// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The value of every asset of the user now (in-transaction building block shared by the investments, accounts, and
 * goals repositories): its holding (view `holdings`), its effective quote (`market-data`), the current rate to the
 * base currency, and `@wf/domain/valuation` `positionValue`. Pending buys ("diproses") are not part of the value;
 * they are reported apart (`pendingBaseMinor`, at the trade-date rate) for the goals they fund.
 */
import { formatDecimal, parseDecimal } from '@wf/domain/decimal';
import { EMPTY_HOLDING, type Holding } from '@wf/domain/investments';
import type { ResolvedQuote } from '@wf/domain/market';
import { positionValue, type PositionValue } from '@wf/domain/valuation';
import { asc } from 'drizzle-orm';
import type { Transaction } from './db.ts';
import { referenceRateIn } from './fx-rates.ts';
import { userContextIn } from './ledger-core.ts';
import { effectiveQuotesIn } from './market-data.ts';
import { assets, holdings } from './schema.ts';

export type AssetRow = typeof assets.$inferSelect;

export interface AssetValuation {
  readonly asset: AssetRow;
  readonly holding: Holding;
  /** Paid for, units not received yet; quote and base (trade-date rate) minor units. */
  readonly pendingMinor: bigint;
  readonly pendingBaseMinor: bigint;
  readonly quote: ResolvedQuote | null;
  /** 1 quote unit in the base currency now; `null` when no rate is known. */
  readonly fxRate: string | null;
  /** `null` when the rate is missing. Without a quote the holding is valued at cost (FR-G6, `priced: false`). */
  readonly value: PositionValue | null;
}

export interface AssetValues {
  readonly baseCurrency: string;
  readonly assets: AssetValuation[];
  /** Quote currencies without a rate to the base currency. */
  readonly missingRates: string[];
}

/** 1 `currency` = rate × `base` now (manual → built-in), `'1'` for the base itself, `null` when unknown. */
export async function currentRateIn(tx: Transaction, currency: string, base: string): Promise<string | null> {
  if (currency === base) return '1';
  return (await referenceRateIn(tx, currency, base))?.rate ?? null;
}

/** Every asset of the user (in sort order) with its holding, quote, and value as of `now`. */
export async function assetValuesIn(tx: Transaction, userId: string, now: Date): Promise<AssetValues> {
  const { baseCurrency } = await userContextIn(tx, userId);
  const rows = await tx.select().from(assets).orderBy(asc(assets.sortOrder), asc(assets.createdAt), asc(assets.id));
  const held = await tx.select().from(holdings);
  const quotes = await effectiveQuotesIn(tx, rows, now);
  const rates = new Map<string, string | null>();
  for (const currency of new Set(rows.map((row) => row.quoteCurrency))) {
    rates.set(currency, await currentRateIn(tx, currency, baseCurrency));
  }
  const valued = rows.map((asset): AssetValuation => {
    const row = held.find((candidate) => candidate.assetId === asset.id);
    const holding: Holding =
      row === undefined
        ? EMPTY_HOLDING
        : {
            units: formatDecimal(parseDecimal(row.units)),
            costMinor: row.costMinor,
            costBaseMinor: row.costBaseMinor,
            realizedMinor: row.realizedMinor,
            realizedBaseMinor: row.realizedBaseMinor,
            dividendMinor: row.dividendMinor,
            dividendBaseMinor: row.dividendBaseMinor,
          };
    const quote = quotes.get(asset.id) ?? null;
    const fxRate = rates.get(asset.quoteCurrency) ?? null;
    return {
      asset,
      holding,
      pendingMinor: row?.pendingMinor ?? 0n,
      pendingBaseMinor: row?.pendingBaseMinor ?? 0n,
      quote,
      fxRate,
      value:
        fxRate === null
          ? null
          : positionValue(
              {
                key: asset.id,
                assetClass: asset.assetClass,
                currency: asset.quoteCurrency,
                units: holding.units,
                price: quote?.price ?? null,
                prevClose: quote?.prevClose ?? null,
                fxRate,
                prevFxRate: null,
                costMinor: holding.costMinor,
                costBaseMinor: holding.costBaseMinor,
              },
              baseCurrency,
            ),
    };
  });
  const missingRates = [...rates].flatMap(([currency, rate]) => (rate === null ? [currency] : [])).sort();
  return { baseCurrency, assets: valued, missingRates };
}

/** Σ value (base) of the holdings on each investment account; accounts with an unvalued holding map to `null`. */
export function holdingsValueByAccount(values: AssetValues): Map<string, bigint | null> {
  const byAccount = new Map<string, bigint | null>();
  for (const { asset, value } of values.assets) {
    const sum = byAccount.get(asset.accountId);
    byAccount.set(asset.accountId, value === null || sum === null ? null : (sum ?? 0n) + value.valueBaseMinor);
  }
  return byAccount;
}
