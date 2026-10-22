// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Investments (FR-I1–I4, FR-G2/G5): assets on platforms (investment accounts with cash in their currency), "Daftar
 * saya" categories, allocation targets per class, and trades. The cash leg of a trade goes through the ledger on the
 * platform account (a managed transaction, changed only here):
 * - buy (also a pending one, "diproses"): an `investment` transaction, −amount, fee and tax as fee postings
 *   ("Biaya platform", "Pajak & meterai");
 * - sell: an `investment` transaction, +gross proceeds, fee and tax; proceeds withdrawn to a bank add a transfer of
 *   the net amount from the platform;
 * - dividend: kept in cash → a `dividend` transaction on the platform (+gross, fee, tax); into an account → the same
 *   on that account (same currency); reinvested (DRIP) → no cash, units only;
 * - cash top-up: a transfer into the platform;
 * - adjust ("Sesuaikan kepemilikan" › koreksi): units only, no cash.
 * Holdings are derived (view `holdings`): each trade stores its effect (`@wf/domain/investments` `tradeEffect`), and
 * every write replays the asset's trades in order, so a backdated or removed trade keeps every later effect right and
 * overselling is refused. A sale or lower correction of an asset held by goals re-splits their percentages so the
 * other goals keep their units (`sellAllocation`; two or more goals need `reduceGoalId`, FR-G5).
 */
import { randomUUID } from 'node:crypto';
import type { BuiltInCategoryKey } from '@wf/domain/categories';
import { formatDecimal, parseDecimal } from '@wf/domain/decimal';
import { formatRate, parseRate } from '@wf/domain/fx';
import { goalShares, needsGoalChoice, sellAllocation, splitUnits, type GoalAssetSource } from '@wf/domain/goal-assets';
import {
  applyEffect,
  ASSET_CLASSES,
  averagePrice,
  EMPTY_HOLDING,
  InvalidTradeError,
  marketValueMinor,
  PRICE_MODES,
  tradeEffect,
  type AssetClass,
  type Currencies,
  type DividendMode,
  type Holding,
  type PriceMode,
  type TradeInput,
} from '@wf/domain/investments';
import { MARKETS, type Market, type ResolvedQuote } from '@wf/domain/market';
import { currencyInfo } from '@wf/domain/money';
import type { LocalDate } from '@wf/domain/period';
import { expensePostings, incomePostings, type PostingDraft, type TransactionType } from '@wf/domain/transactions';
import {
  allocation as allocationOf,
  checkTargets,
  classItems,
  portfolioSummary,
  trailingDividends,
  type Allocation,
  type PortfolioSummary,
  type PositionValue,
  type TrailingDividends,
} from '@wf/domain/valuation';
import { and, asc, eq, inArray, isNotNull, ne, sql, type SQL } from 'drizzle-orm';
import { viewsIn as accountViewsIn } from './accounts.ts';
import { logActivity } from './activity.ts';
import { firstRow, withUser, type Database, type Transaction } from './db.ts';
import {
  accountsIn,
  assertOpenDatesIn,
  assertOpenTransactionsIn,
  builtInCategoryIn,
  localDateOf,
  recordTransactionIn,
  userContextIn,
  valuationIn,
  type LedgerAccount,
} from './ledger-core.ts';
import { referenceRateIn } from './fx-rates.ts';
import { LedgerError } from './ledger-errors.ts';
import { assetValuesIn, currentRateIn, type AssetRow, type AssetValuation } from './portfolio.ts';
import {
  accounts,
  allocationTargets,
  assetCategories,
  assets,
  goalFundingSources,
  goals,
  investmentTrades,
  portfolioSnapshots,
  postings,
  transactions,
  type JsonObject,
} from './schema.ts';

export interface AssetInput {
  /** The platform: an active investment account; its currency is the asset's quote currency. */
  readonly accountId: string;
  /** Ticker, 1–20 characters, unique per platform. */
  readonly symbol: string;
  readonly name: string;
  readonly assetClass: AssetClass;
  readonly market: Market;
  readonly categoryId?: string | null;
  /** Default `manual` when a manual price is given, else `server`. */
  readonly priceMode?: PriceMode;
  /** Positive decimal (quote major units) with its date; both or neither. */
  readonly manualPrice?: string | null;
  readonly manualPriceAt?: Date | null;
  /** Antam premium over spot. */
  readonly premiumBps?: number | null;
  readonly meta?: JsonObject;
}

/** Editable fields; omitted ones are kept. The platform (and so the currency) never changes. */
export type AssetPatch = Partial<Omit<AssetInput, 'accountId'>>;

interface TradeCommon {
  /** Idempotency key of the form submission (also the client id of the cash transaction). */
  readonly clientId: string;
  readonly occurredAt: Date;
  readonly description?: string | null;
}

interface PricedTrade extends TradeCommon {
  readonly assetId: string;
  /** Positive decimal. */
  readonly units: string;
  /** Price per unit (quote major), for the history. */
  readonly price?: string | null;
  /** Buy: paid without fee and tax; sell: gross proceeds. Quote-currency minor units. */
  readonly amountMinor: bigint;
  readonly feeMinor?: bigint;
  readonly taxMinor?: bigint;
  /** 1 quote = `fxRate` base on the trade date; default the reference rate then. */
  readonly fxRate?: string;
}

/** FR-I2 "Catat transaksi investasi". */
export type TradeRecord =
  | (PricedTrade & {
      readonly kind: 'buy';
      /** "Diproses": paid now, units known when allotted (`settleTrade`); `units` is then an estimate. */
      readonly pending?: boolean;
    })
  | (PricedTrade & {
      readonly kind: 'sell';
      /** "Tarik ke …": the net proceeds go on to this account (same currency); default: stay in platform cash. */
      readonly proceedsAccountId?: string | null;
      /** FR-G5: the goal whose units are sold when two or more goals hold the asset beyond its free units. */
      readonly reduceGoalId?: string | null;
    })
  | (TradeCommon & {
      readonly kind: 'dividend';
      readonly assetId: string;
      /** Gross. */
      readonly amountMinor: bigint;
      readonly feeMinor?: bigint;
      readonly taxMinor?: bigint;
      readonly fxRate?: string;
      readonly mode: DividendMode;
      /** `reinvest`: the units bought with it. */
      readonly units?: string;
      /** `account`: where it was paid (same currency as the asset). */
      readonly accountId?: string | null;
    })
  | (TradeCommon & {
      readonly kind: 'cash_topup';
      /** The platform. */
      readonly accountId: string;
      readonly fromAccountId: string;
      /** In the source account's currency. */
      readonly sentMinor: bigint;
      /** In the platform's currency; default `sentMinor` (same currency). */
      readonly receivedMinor?: bigint;
    });

/** "Sesuaikan kepemilikan": make the recorded units match the platform. */
export interface AdjustInput {
  readonly clientId: string;
  readonly assetId: string;
  readonly occurredAt: Date;
  /** Units shown by the platform now. */
  readonly units: string;
  /**
   * More units: `unrecorded_buy` (a buy without a cash leg here, `amountMinor` = its cost), `drip` (a reinvested
   * dividend, `amountMinor` = its value; cost unchanged), or `correction` (no cost). Fewer units: `correction` only
   * (cost reduced proportionally); a sale is recorded with `recordTrade` (`sell`).
   */
  readonly reason: 'unrecorded_buy' | 'drip' | 'correction';
  readonly amountMinor?: bigint;
  readonly price?: string | null;
  readonly fxRate?: string;
  readonly reduceGoalId?: string | null;
}

export interface TradeView {
  readonly id: string;
  readonly assetId: string | null;
  readonly accountId: string;
  readonly kind: TradeRecord['kind'] | 'adjust';
  readonly status: 'settled' | 'pending';
  readonly occurredAt: Date;
  readonly localDate: LocalDate;
  readonly units: string;
  readonly price: string | null;
  readonly amountMinor: bigint;
  readonly feeMinor: bigint;
  readonly taxMinor: bigint;
  readonly fxRate: string;
  readonly dividendMode: DividendMode | null;
  readonly proceedsAccountId: string | null;
  readonly transactionId: string | null;
  readonly transferTransactionId: string | null;
  readonly reducedGoalId: string | null;
  readonly description: string | null;
  /** Realized by this trade (sell), quote and base minor units. */
  readonly realizedMinor: bigint;
  readonly realizedBaseMinor: bigint;
  /** Net dividend received by this trade. */
  readonly dividendMinor: bigint;
}

export interface AssetGoalView {
  readonly sourceId: string;
  readonly goalId: string;
  readonly goalName: string;
  readonly mode: 'whole' | 'percent';
  /** 10 000 for a whole asset. */
  readonly bps: number;
  readonly units: string;
  /** The goal's part of the value plus pending buys, base currency. */
  readonly valueBaseMinor: bigint;
}

export interface AssetView {
  readonly id: string;
  readonly accountId: string;
  readonly platformName: string;
  readonly symbol: string;
  readonly name: string;
  readonly quoteCurrency: string;
  readonly assetClass: AssetClass;
  readonly market: Market;
  readonly categoryId: string | null;
  readonly priceMode: PriceMode;
  readonly manualPrice: string | null;
  readonly manualPriceAt: Date | null;
  readonly premiumBps: number | null;
  readonly meta: JsonObject;
  readonly holding: Holding;
  readonly pendingMinor: bigint;
  readonly pendingBaseMinor: bigint;
  /** Quote major units; `null` without units. */
  readonly averagePrice: string | null;
  /** With source, provider, time, stale flag, and label (never "real-time"); `null` = valued at cost. */
  readonly quote: ResolvedQuote | null;
  /** `null` when no rate to the base currency is known. */
  readonly value: PositionValue | null;
  readonly goals: AssetGoalView[];
  /** "Bebas dialokasikan". */
  readonly freeBps: number;
}

export interface PlatformView {
  readonly accountId: string;
  readonly name: string;
  readonly currency: string;
  readonly cashMinor: bigint;
  readonly cashBaseMinor: bigint | null;
  readonly holdingsValueBaseMinor: bigint | null;
  /** Cash + holdings ("Total Gotrade"). */
  readonly valueBaseMinor: bigint | null;
  readonly assetCount: number;
}

export interface CategoryView {
  readonly id: string;
  readonly name: string;
  readonly assetClass: AssetClass;
  readonly sortOrder: number;
  readonly assetIds: string[];
}

export interface PortfolioView {
  readonly baseCurrency: string;
  readonly today: LocalDate;
  readonly assets: AssetView[];
  readonly platforms: PlatformView[];
  readonly categories: CategoryView[];
  readonly targets: Partial<Record<AssetClass, number>>;
  /** Value, cost, gain, today, dividends, yield over the holdings and the platforms' cash (class `cash`). */
  readonly summary: PortfolioSummary;
  /** Per class vs the targets; `null` without targets or value. */
  readonly allocation: Allocation | null;
  readonly dividends: TrailingDividends;
  /** Currencies without a rate to the base currency (their positions are left out of the totals). */
  readonly missingRates: string[];
}

/** A day's portfolio value (`portfolio_snapshots`, the growth chart). */
export interface PortfolioSnapshotInput {
  readonly date: LocalDate;
  readonly valueBaseMinor: bigint;
  readonly costBaseMinor: bigint;
  readonly contributionsBaseMinor: bigint;
  /** Value per asset class. */
  readonly breakdown?: Partial<Record<AssetClass, string>>;
}

export interface InvestmentsRepository {
  portfolio: (userId: string) => Promise<PortfolioView>;
  /** Snapshots oldest first (growth chart, FR-I3). */
  snapshots: (userId: string) => Promise<PortfolioSnapshotInput[]>;
  /** Stores (or replaces) a day's snapshot: the daily job (worker) and the seed. */
  recordSnapshot: (userId: string, input: PortfolioSnapshotInput) => Promise<void>;
  /** @throws {LedgerError} `NOT_FOUND` */
  asset: (userId: string, id: string) => Promise<AssetView>;
  /** Trades of an asset (or of a platform's top-ups when `assetId` is null), oldest first. */
  trades: (userId: string, filter: { readonly assetId?: string; readonly accountId?: string }) => Promise<TradeView[]>;
  /** @throws {LedgerError} `INVALID_ASSET`, `NOT_FOUND`, `ACCOUNT_ARCHIVED` */
  createAsset: (userId: string, input: AssetInput) => Promise<AssetView>;
  /** @throws {LedgerError} `NOT_FOUND`, `INVALID_ASSET` */
  updateAsset: (userId: string, id: string, patch: AssetPatch) => Promise<AssetView>;
  /**
   * "Hapus aset": the asset, its trades, and its goal sources go; the trades' cash transactions stay in the ledger
   * (the money moved).
   * @throws {LedgerError} `NOT_FOUND`
   */
  removeAsset: (userId: string, id: string) => Promise<void>;
  /** @throws {LedgerError} `INVALID_ASSET` */
  createCategory: (
    userId: string,
    input: { readonly name: string; readonly assetClass: AssetClass },
  ) => Promise<CategoryView>;
  /**
   * "Ubah kategori": name, class, and (when given) exactly these assets as members — an asset is in one category only,
   * so a chosen asset leaves its old one.
   * @throws {LedgerError} `NOT_FOUND`, `INVALID_ASSET`
   */
  updateCategory: (
    userId: string,
    id: string,
    patch: { readonly name?: string; readonly assetClass?: AssetClass; readonly assetIds?: readonly string[] },
  ) => Promise<CategoryView>;
  /** "Hapus kategori": its assets become single assets. @throws {LedgerError} `NOT_FOUND` */
  removeCategory: (userId: string, id: string) => Promise<void>;
  /** "Pindah ke kategori…" (`null` = single asset). @throws {LedgerError} `NOT_FOUND` */
  moveAsset: (userId: string, assetId: string, categoryId: string | null) => Promise<void>;
  /** FR-I3 targets per class (bps), replacing the set; they must total exactly 100%. @throws `INVALID_ASSET` */
  setTargets: (userId: string, targets: Partial<Record<AssetClass, number>>) => Promise<void>;
  /**
   * Records a trade and its cash leg. Idempotent per `clientId`.
   * @throws {LedgerError} `INVALID_TRADE`, `NOT_FOUND`, `ACCOUNT_ARCHIVED`, `PERIOD_CLOSED`, `FX_RATE_MISSING`
   */
  recordTrade: (userId: string, input: TradeRecord) => Promise<TradeView>;
  /** @throws {LedgerError} `INVALID_TRADE`, `NOT_FOUND`, `PERIOD_CLOSED`, `FX_RATE_MISSING` */
  adjustHoldings: (userId: string, input: AdjustInput) => Promise<TradeView>;
  /** A pending buy got its units ("NAB 16 Okt"). @throws {LedgerError} `NOT_FOUND`, `INVALID_TRADE` */
  settleTrade: (
    userId: string,
    tradeId: string,
    input: { readonly units: string; readonly price?: string | null },
  ) => Promise<TradeView>;
  /**
   * Removes a trade and soft-deletes its cash transactions; later trades are replayed. Goal percentages a sale
   * changed are not restored.
   * @throws {LedgerError} `NOT_FOUND`, `INVALID_TRADE` (a later sale would oversell), `PERIOD_CLOSED`
   */
  removeTrade: (userId: string, tradeId: string) => Promise<void>;
}

const FEE_CATEGORY: BuiltInCategoryKey = 'system:platform_fee';
const TAX_CATEGORY: BuiltInCategoryKey = 'system:tax_stamp';
const SYMBOL_MAX = 20;
const NAME_MAX = 80;
const CATEGORY_NAME_MAX = 40;

const invalidAsset = (message: string) => new LedgerError('INVALID_ASSET', message);
const invalidTrade = (message: string) => new LedgerError('INVALID_TRADE', message);

/** A positive decimal string, normalized. */
function decimalOf(value: string, error: (message: string) => LedgerError): string {
  let scaled: bigint;
  try {
    scaled = parseDecimal(value);
  } catch {
    throw error('Not a decimal');
  }
  if (scaled <= 0n) throw error('The number must be positive');
  return formatDecimal(scaled);
}

function rateOf(value: string): string {
  try {
    parseRate(value);
  } catch {
    throw invalidTrade('Invalid exchange rate');
  }
  return value;
}

const TRADE_VIEW = {
  id: investmentTrades.id,
  assetId: investmentTrades.assetId,
  accountId: investmentTrades.accountId,
  kind: investmentTrades.kind,
  status: investmentTrades.status,
  occurredAt: investmentTrades.occurredAt,
  localDate: investmentTrades.localDate,
  units: investmentTrades.units,
  price: investmentTrades.price,
  amountMinor: investmentTrades.amountMinor,
  feeMinor: investmentTrades.feeMinor,
  taxMinor: investmentTrades.taxMinor,
  fxRate: investmentTrades.fxRate,
  dividendMode: investmentTrades.dividendMode,
  proceedsAccountId: investmentTrades.proceedsAccountId,
  transactionId: investmentTrades.transactionId,
  transferTransactionId: investmentTrades.transferTransactionId,
  reducedGoalId: investmentTrades.reducedGoalId,
  description: investmentTrades.description,
  realizedMinor: investmentTrades.realizedMinor,
  realizedBaseMinor: investmentTrades.realizedBaseMinor,
  dividendMinor: investmentTrades.dividendMinor,
};

interface TradeRow extends Omit<TradeView, 'units' | 'price'> {
  readonly units: string;
  readonly price: string | null;
}

const tradeRowsIn = (tx: Transaction, where: SQL | undefined): Promise<TradeRow[]> =>
  tx
    .select(TRADE_VIEW)
    .from(investmentTrades)
    .where(where)
    .orderBy(asc(investmentTrades.occurredAt), asc(investmentTrades.createdAt), asc(investmentTrades.id));

const tradeView = (row: TradeRow): TradeView => ({
  ...row,
  fxRate: formatRate(parseRate(row.fxRate)),
  units: formatDecimal(parseDecimal(row.units)),
  price: row.price === null ? null : formatDecimal(parseDecimal(row.price)),
});

async function tradeViewIn(tx: Transaction, id: string): Promise<TradeView> {
  const [row] = await tradeRowsIn(tx, eq(investmentTrades.id, id));
  if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such trade');
  return tradeView(row);
}

/** The investment account `id`, active. */
async function platformIn(tx: Transaction, id: string): Promise<LedgerAccount> {
  const [row] = await tx
    .select({ id: accounts.id, currency: accounts.currency, status: accounts.status, type: accounts.type })
    .from(accounts)
    .where(eq(accounts.id, id));
  if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such account');
  if (row.status === 'archived') throw new LedgerError('ACCOUNT_ARCHIVED');
  if (row.type !== 'investment') throw invalidAsset('The platform must be an investment account');
  return row;
}

async function lockedAssetIn(tx: Transaction, id: string): Promise<AssetRow> {
  const [row] = await tx.select().from(assets).where(eq(assets.id, id)).for('update');
  if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such asset');
  return row;
}

/** The input `row` was made from (to apply a patch onto). */
const inputOf = (row: AssetRow): AssetInput => ({
  accountId: row.accountId,
  symbol: row.symbol,
  name: row.name,
  assetClass: row.assetClass,
  market: row.market,
  categoryId: row.categoryId,
  priceMode: row.priceMode,
  manualPrice: row.manualPrice,
  manualPriceAt: row.manualPriceAt,
  premiumBps: row.premiumBps,
  meta: row.meta,
});

/** Validated columns of `input` (all but the platform's; `quoteCurrency` is the platform's currency). */
async function assetValuesOf(
  tx: Transaction,
  input: AssetInput,
): Promise<Omit<typeof assets.$inferInsert, 'userId' | 'accountId' | 'quoteCurrency'>> {
  const symbol = input.symbol.trim().toUpperCase();
  if (symbol.length === 0 || symbol.length > SYMBOL_MAX) throw invalidAsset('Invalid symbol');
  const name = input.name.trim();
  if (name.length === 0 || name.length > NAME_MAX) throw invalidAsset('Invalid name');
  if (!ASSET_CLASSES.includes(input.assetClass)) throw invalidAsset('Invalid asset class');
  if (!MARKETS.includes(input.market)) throw invalidAsset('Invalid market');
  const categoryId = input.categoryId ?? null;
  if (categoryId !== null) {
    const [category] = await tx
      .select({ id: assetCategories.id })
      .from(assetCategories)
      .where(eq(assetCategories.id, categoryId));
    if (category === undefined) throw new LedgerError('NOT_FOUND', 'No such category');
  }
  const manualPrice = input.manualPrice == null ? null : decimalOf(input.manualPrice, invalidAsset);
  const manualPriceAt = input.manualPriceAt ?? null;
  if ((manualPrice === null) !== (manualPriceAt === null)) throw invalidAsset('A manual price needs its date');
  const priceMode = input.priceMode ?? (manualPrice === null ? 'server' : 'manual');
  if (!PRICE_MODES.includes(priceMode)) throw invalidAsset('Invalid price mode');
  if (priceMode === 'manual' && manualPrice === null) throw invalidAsset('Manual pricing needs a price');
  const premiumBps = input.premiumBps ?? null;
  if (premiumBps !== null && (!Number.isInteger(premiumBps) || premiumBps <= -10_000)) {
    throw invalidAsset('Invalid premium');
  }
  return {
    symbol,
    name,
    assetClass: input.assetClass,
    market: input.market,
    categoryId,
    priceMode,
    manualPrice,
    manualPriceAt,
    premiumBps,
    meta: input.meta ?? {},
  };
}

/** Writes an `investment`/`dividend` cash transaction with its postings. */
async function insertCashLegIn(
  tx: Transaction,
  userId: string,
  header: {
    readonly type: Extract<TransactionType, 'investment' | 'dividend'>;
    readonly clientId: string;
    readonly occurredAt: Date;
    readonly localDate: LocalDate;
    readonly description: string;
  },
  lines: readonly PostingDraft[],
  now: Date,
): Promise<string> {
  const row = firstRow(
    await tx
      .insert(transactions)
      .values({ ...header, userId, confirmedByUserAt: now })
      .returning({ id: transactions.id }),
    'transactions',
  );
  await tx.insert(postings).values(lines.map((line) => ({ ...line, userId, transactionId: row.id })));
  await logActivity(tx, userId, 'transaction', [row.id], 'created', { source: 'manual' });
  return row.id;
}

/**
 * Postings on `account`: the principal (signed) and fee / tax as fee postings in their built-in categories.
 */
async function cashLinesIn(
  tx: Transaction,
  userId: string,
  account: LedgerAccount,
  localDate: LocalDate,
  principalMinor: bigint,
  feeMinor: bigint,
  taxMinor: bigint,
): Promise<PostingDraft[]> {
  const { baseCurrency } = await userContextIn(tx, userId);
  const valuation = await valuationIn(tx, baseCurrency, [account.currency], localDate);
  const lines =
    principalMinor < 0n
      ? expensePostings({ ...valuation, account, amountMinor: -principalMinor })
      : incomePostings({ ...valuation, account, amountMinor: principalMinor });
  for (const [amount, key] of [
    [feeMinor, FEE_CATEGORY],
    [taxMinor, TAX_CATEGORY],
  ] as const) {
    if (amount === 0n) continue;
    const [line] = expensePostings({ ...valuation, account, amountMinor: amount });
    lines.push({ ...(line as PostingDraft), role: 'fee', categoryId: await builtInCategoryIn(tx, userId, key) });
  }
  return lines;
}

const tradeInputOf = (row: typeof investmentTrades.$inferSelect): TradeInput => ({
  kind: row.kind,
  status: row.status,
  units: formatDecimal(parseDecimal(row.units)),
  amountMinor: row.amountMinor,
  feeMinor: row.feeMinor,
  taxMinor: row.taxMinor,
  fxRate: row.fxRate,
  dividendMode: row.dividendMode,
});

/** Replays the asset's trades in order, storing each trade's effect; refuses an invalid sequence. */
async function replayIn(tx: Transaction, asset: AssetRow, baseCurrency: string): Promise<Holding> {
  const currencies: Currencies = { quote: asset.quoteCurrency, base: baseCurrency };
  const rows = await tx
    .select()
    .from(investmentTrades)
    .where(eq(investmentTrades.assetId, asset.id))
    .orderBy(asc(investmentTrades.occurredAt), asc(investmentTrades.createdAt), asc(investmentTrades.id));
  let holding = EMPTY_HOLDING;
  for (const row of rows) {
    let effect;
    try {
      effect = tradeEffect(holding, tradeInputOf(row), currencies);
    } catch (error) {
      if (error instanceof InvalidTradeError) throw invalidTrade(error.message);
      throw error;
    }
    holding = applyEffect(holding, effect);
    await tx
      .update(investmentTrades)
      .set({
        unitsDelta: effect.unitsDelta,
        costDeltaMinor: effect.costMinor,
        costBaseDeltaMinor: effect.costBaseMinor,
        realizedMinor: effect.realizedMinor,
        realizedBaseMinor: effect.realizedBaseMinor,
        dividendMinor: effect.dividendMinor,
        dividendBaseMinor: effect.dividendBaseMinor,
      })
      .where(eq(investmentTrades.id, row.id));
  }
  return holding;
}

/** A goal source of an asset. */
interface AssetSourceRow {
  readonly id: string;
  readonly goalId: string;
  readonly goalName: string;
  readonly mode: 'whole' | 'fixed' | 'percent';
  readonly pctBps: number | null;
}

/** The goal sources of an asset, in order. */
async function assetSourcesIn(tx: Transaction, assetId: string): Promise<AssetSourceRow[]> {
  return tx
    .select({
      id: goalFundingSources.id,
      goalId: goalFundingSources.goalId,
      goalName: goals.name,
      mode: goalFundingSources.mode,
      pctBps: goalFundingSources.pctBps,
    })
    .from(goalFundingSources)
    .innerJoin(goals, eq(goals.id, goalFundingSources.goalId))
    .where(eq(goalFundingSources.assetId, assetId))
    .orderBy(asc(goalFundingSources.sortOrder), asc(goalFundingSources.createdAt), asc(goalFundingSources.id));
}

const domainSource = (row: { goalId: string; mode: string; pctBps: number | null }): GoalAssetSource => ({
  goalId: row.goalId,
  mode: row.mode === 'whole' ? 'whole' : 'percent',
  bps: row.pctBps ?? 10_000,
});

/**
 * FR-G5: `soldUnits` leave the holding `units`; the goals holding the asset are re-split so the others keep their
 * units (free units go first, then `reduceGoalId`'s).
 */
async function reallocateGoalsIn(
  tx: Transaction,
  assetId: string,
  units: string,
  soldUnits: string,
  reduceGoalId: string | null,
): Promise<void> {
  const rows = await assetSourcesIn(tx, assetId);
  if (rows.length === 0) return;
  const sources = rows.map(domainSource);
  if (reduceGoalId === null && needsGoalChoice(units, sources, soldUnits)) {
    throw invalidTrade('Choose the goal the sale reduces');
  }
  if (reduceGoalId !== null && !rows.some((row) => row.goalId === reduceGoalId)) {
    throw invalidTrade('The goal does not hold this asset');
  }
  if (parseDecimal(soldUnits) > parseDecimal(units)) throw invalidTrade('More units than held');
  const next = sellAllocation({ units, sources, soldUnits, reduceGoalId }).sources;
  const changes = rows.map((row) => {
    const after = next.find((source) => source.goalId === row.goalId);
    return {
      row,
      bps: after === undefined ? null : after.mode === 'whole' ? null : after.bps,
      dropped: after === undefined,
    };
  });
  for (const change of changes.filter((entry) => entry.dropped)) {
    await tx.delete(goalFundingSources).where(eq(goalFundingSources.id, change.row.id));
  }
  // Shrinking ones first, so the Σ ≤ 100% trigger never sees a transient excess.
  const updates = changes
    .filter((entry) => !entry.dropped && entry.row.mode !== 'whole' && entry.bps !== entry.row.pctBps)
    .sort((a, b) => (a.bps as number) - (a.row.pctBps as number) - ((b.bps as number) - (b.row.pctBps as number)));
  for (const update of updates) {
    await tx.update(goalFundingSources).set({ pctBps: update.bps }).where(eq(goalFundingSources.id, update.row.id));
  }
}

/** The trade-date rate: given, `1` in the base currency, else the reference rate then (or the nearest known). */
async function tradeRateIn(
  tx: Transaction,
  given: string | undefined,
  currency: string,
  baseCurrency: string,
  localDate: LocalDate,
): Promise<string> {
  if (given !== undefined) return rateOf(given);
  if (currency === baseCurrency) return '1';
  const rate =
    (await referenceRateIn(tx, currency, baseCurrency, localDate)) ??
    (await referenceRateIn(tx, currency, baseCurrency));
  if (rate === null) throw new LedgerError('FX_RATE_MISSING', `No rate for ${currency}`);
  return rate.rate;
}

interface TradeRowInput {
  readonly asset: AssetRow | null;
  readonly accountId: string;
  readonly kind: TradeView['kind'];
  readonly status?: 'settled' | 'pending';
  readonly clientId: string;
  readonly occurredAt: Date;
  readonly localDate: LocalDate;
  readonly units: string;
  readonly price?: string | null;
  readonly amountMinor: bigint;
  readonly feeMinor?: bigint;
  readonly taxMinor?: bigint;
  readonly fxRate: string;
  readonly dividendMode?: DividendMode | null;
  readonly proceedsAccountId?: string | null;
  readonly transactionId?: string | null;
  readonly transferTransactionId?: string | null;
  readonly reducedGoalId?: string | null;
  readonly description?: string | null;
}

async function insertTradeIn(tx: Transaction, userId: string, input: TradeRowInput): Promise<string> {
  const { asset, ...rest } = input;
  const row = firstRow(
    await tx
      .insert(investmentTrades)
      .values({
        ...rest,
        userId,
        assetId: asset?.id ?? null,
        description: input.description?.trim() || null,
        unitsDelta: '0',
        costDeltaMinor: 0n,
        costBaseDeltaMinor: 0n,
        realizedMinor: 0n,
        realizedBaseMinor: 0n,
        dividendMinor: 0n,
        dividendBaseMinor: 0n,
      })
      .returning({ id: investmentTrades.id }),
    'investment_trades',
  );
  return row.id;
}

async function existingTradeIn(tx: Transaction, clientId: string): Promise<TradeView | null> {
  const [row] = await tradeRowsIn(tx, eq(investmentTrades.clientId, clientId));
  return row === undefined ? null : tradeView(row);
}

function assetView(valuation: AssetValuation, platformName: string, sources: readonly AssetSourceRow[]): AssetView {
  const { asset, holding } = valuation;
  const domain = sources.map(domainSource);
  const shares = goalShares((valuation.value?.valueBaseMinor ?? 0n) + valuation.pendingBaseMinor, domain);
  const units = splitUnits(holding.units, domain);
  const freeBps = 10_000 - domain.reduce((sum, source) => sum + (source.mode === 'whole' ? 10_000 : source.bps), 0);
  return {
    id: asset.id,
    accountId: asset.accountId,
    platformName,
    symbol: asset.symbol,
    name: asset.name,
    quoteCurrency: asset.quoteCurrency,
    assetClass: asset.assetClass,
    market: asset.market,
    categoryId: asset.categoryId,
    priceMode: asset.priceMode,
    manualPrice: asset.manualPrice === null ? null : formatDecimal(parseDecimal(asset.manualPrice)),
    manualPriceAt: asset.manualPriceAt,
    premiumBps: asset.premiumBps,
    meta: asset.meta,
    holding,
    pendingMinor: valuation.pendingMinor,
    pendingBaseMinor: valuation.pendingBaseMinor,
    averagePrice: averagePrice(holding, asset.quoteCurrency),
    quote: valuation.quote,
    value: valuation.value,
    goals: sources.map((source, index) => ({
      sourceId: source.id,
      goalId: source.goalId,
      goalName: source.goalName,
      mode: domain[index]?.mode as 'whole' | 'percent',
      bps: domain[index]?.bps as number,
      units: units.goals[index]?.value as string,
      valueBaseMinor: shares.goals[index]?.value as bigint,
    })),
    freeBps,
  };
}

/** A cash amount in its currency's major units, as position units (`'51.99'` for 5 199 cents). */
const cashUnits = (minor: bigint, currency: string): string =>
  formatDecimal((minor * parseDecimal('1')) / 10n ** BigInt(currencyInfo(currency).minorDigits));

async function portfolioIn(tx: Transaction, userId: string, now: Date): Promise<PortfolioView> {
  const { timezone } = await userContextIn(tx, userId);
  const today = localDateOf(now, timezone);
  const values = await assetValuesIn(tx, userId, now);
  const { baseCurrency } = values;
  const { views } = await accountViewsIn(tx, userId, eq(accounts.type, 'investment'));
  const sources = await tx
    .select({
      id: goalFundingSources.id,
      assetId: goalFundingSources.assetId,
      goalId: goalFundingSources.goalId,
      goalName: goals.name,
      mode: goalFundingSources.mode,
      pctBps: goalFundingSources.pctBps,
    })
    .from(goalFundingSources)
    .innerJoin(goals, eq(goals.id, goalFundingSources.goalId))
    .where(isNotNull(goalFundingSources.assetId))
    .orderBy(asc(goalFundingSources.sortOrder), asc(goalFundingSources.createdAt), asc(goalFundingSources.id));
  const names = new Map(views.map((view) => [view.id, view.displayName]));
  const assetViews = values.assets.map((valuation) =>
    assetView(
      valuation,
      names.get(valuation.asset.accountId) as string,
      sources.filter((source) => source.assetId === valuation.asset.id),
    ),
  );
  const missing = new Set(values.missingRates);
  const platforms = views
    .filter((view) => view.status === 'active' || assetViews.some((asset) => asset.accountId === view.id))
    .map((view): PlatformView => {
      const own = assetViews.filter((asset) => asset.accountId === view.id);
      const holdingsValue = own.some((asset) => asset.value === null)
        ? null
        : own.reduce((sum, asset) => sum + (asset.value as PositionValue).valueBaseMinor, 0n);
      if (view.balanceBaseMinor === null) missing.add(view.currency);
      return {
        accountId: view.id,
        name: view.displayName,
        currency: view.currency,
        cashMinor: view.balanceMinor,
        cashBaseMinor: view.balanceBaseMinor,
        holdingsValueBaseMinor: holdingsValue,
        valueBaseMinor:
          holdingsValue === null || view.balanceBaseMinor === null ? null : holdingsValue + view.balanceBaseMinor,
        assetCount: own.length,
      };
    });
  const positions = [
    ...values.assets.flatMap((valuation) =>
      valuation.fxRate === null || (valuation.holding.units === '0' && valuation.holding.costBaseMinor === 0n)
        ? []
        : [
            {
              key: valuation.asset.id,
              assetClass: valuation.asset.assetClass,
              currency: valuation.asset.quoteCurrency,
              units: valuation.holding.units,
              price: valuation.quote?.price ?? null,
              prevClose: valuation.quote?.prevClose ?? null,
              fxRate: valuation.fxRate,
              prevFxRate: null,
              costMinor: valuation.holding.costMinor,
              costBaseMinor: valuation.holding.costBaseMinor,
            },
          ],
    ),
    ...(await Promise.all(
      platforms
        .filter((platform) => platform.cashMinor !== 0n && platform.cashBaseMinor !== null)
        .map(async (platform) => ({
          key: `cash:${platform.accountId}`,
          assetClass: 'cash' as const,
          currency: platform.currency,
          units: cashUnits(platform.cashMinor, platform.currency),
          price: '1',
          prevClose: '1',
          fxRate: (await currentRateIn(tx, platform.currency, baseCurrency)) as string,
          prevFxRate: null,
          costMinor: platform.cashMinor,
          costBaseMinor: platform.cashBaseMinor as bigint,
        })),
    )),
  ];
  const dividendRows = await tx
    .select({ on: investmentTrades.localDate, netBaseMinor: investmentTrades.dividendBaseMinor })
    .from(investmentTrades)
    .where(eq(investmentTrades.kind, 'dividend'));
  const dividends = trailingDividends(dividendRows, today);
  const summary = portfolioSummary(positions, { base: baseCurrency, dividends12mBaseMinor: dividends.totalMinor });
  const targetRows = await tx
    .select({ assetClass: allocationTargets.assetClass, targetBps: allocationTargets.targetBps })
    .from(allocationTargets);
  const targets = Object.fromEntries(
    ASSET_CLASSES.flatMap((assetClass) => {
      const row = targetRows.find((candidate) => candidate.assetClass === assetClass);
      return row === undefined ? [] : [[assetClass, row.targetBps]];
    }),
  ) as Partial<Record<AssetClass, number>>;
  const categories = await categoriesIn(tx);
  return {
    baseCurrency,
    today,
    assets: assetViews,
    platforms,
    categories,
    targets,
    summary,
    allocation:
      targetRows.length === 0 || summary.valueBaseMinor <= 0n
        ? null
        : allocationOf(classItems(summary.positions), targets),
    dividends,
    missingRates: [...missing].sort(),
  };
}

async function categoriesIn(tx: Transaction, where?: SQL): Promise<CategoryView[]> {
  const rows = await tx
    .select()
    .from(assetCategories)
    .where(where)
    .orderBy(asc(assetCategories.sortOrder), asc(assetCategories.createdAt), asc(assetCategories.id));
  const members = await tx
    .select({ id: assets.id, categoryId: assets.categoryId })
    .from(assets)
    .where(isNotNull(assets.categoryId))
    .orderBy(asc(assets.sortOrder), asc(assets.createdAt), asc(assets.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    assetClass: row.assetClass,
    sortOrder: row.sortOrder,
    assetIds: members.filter((member) => member.categoryId === row.id).map((member) => member.id),
  }));
}

async function categoryIn(tx: Transaction, id: string): Promise<CategoryView> {
  const [view] = await categoriesIn(tx, eq(assetCategories.id, id));
  if (view === undefined) throw new LedgerError('NOT_FOUND', 'No such category');
  return view;
}

function categoryName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > CATEGORY_NAME_MAX) throw invalidAsset('Invalid category name');
  return trimmed;
}

export function createInvestments(db: Database, options: { readonly now?: () => Date } = {}): InvestmentsRepository {
  const now = options.now ?? (() => new Date());

  const assetIn = async (tx: Transaction, userId: string, id: string): Promise<AssetView> => {
    const portfolio = await portfolioIn(tx, userId, now());
    const view = portfolio.assets.find((asset) => asset.id === id);
    if (view === undefined) throw new LedgerError('NOT_FOUND', 'No such asset');
    return view;
  };

  /** Shared start of a trade on an asset: the locked asset, its platform, the date, and the rate. */
  const tradeContextIn = async (
    tx: Transaction,
    userId: string,
    assetId: string,
    occurredAt: Date,
    fxRate: string | undefined,
  ) => {
    const asset = await lockedAssetIn(tx, assetId);
    const platform = await platformIn(tx, asset.accountId);
    const { baseCurrency, timezone } = await userContextIn(tx, userId);
    const localDate = localDateOf(occurredAt, timezone);
    await assertOpenDatesIn(tx, [localDate]);
    const rate = await tradeRateIn(tx, fxRate, asset.quoteCurrency, baseCurrency, localDate);
    return { asset, platform, baseCurrency, localDate, rate };
  };

  const amounts = (input: { amountMinor: bigint; feeMinor?: bigint; taxMinor?: bigint }) => {
    const fee = input.feeMinor ?? 0n;
    const tax = input.taxMinor ?? 0n;
    if (fee < 0n || tax < 0n) throw invalidTrade('Fee and tax must not be negative');
    return { amount: input.amountMinor, fee, tax };
  };

  return {
    portfolio: (userId) => withUser(db, userId, (tx) => portfolioIn(tx, userId, now())),

    snapshots: (userId) =>
      withUser(db, userId, async (tx) =>
        (await tx.select().from(portfolioSnapshots).orderBy(asc(portfolioSnapshots.snapshotDate))).map((row) => ({
          date: row.snapshotDate,
          valueBaseMinor: row.valueBaseMinor,
          costBaseMinor: row.costBaseMinor,
          contributionsBaseMinor: row.contributionsBaseMinor,
          breakdown: row.breakdown,
        })),
      ),

    recordSnapshot: (userId, input) =>
      withUser(db, userId, async (tx) => {
        const values = {
          valueBaseMinor: input.valueBaseMinor,
          costBaseMinor: input.costBaseMinor,
          contributionsBaseMinor: input.contributionsBaseMinor,
          breakdown: input.breakdown ?? {},
        };
        await tx
          .insert(portfolioSnapshots)
          .values({ ...values, userId, snapshotDate: input.date })
          .onConflictDoUpdate({ target: [portfolioSnapshots.userId, portfolioSnapshots.snapshotDate], set: values });
      }),

    asset: (userId, id) => withUser(db, userId, (tx) => assetIn(tx, userId, id)),

    trades: (userId, filter) =>
      withUser(db, userId, async (tx) => {
        const conditions = [
          filter.assetId === undefined ? undefined : eq(investmentTrades.assetId, filter.assetId),
          filter.accountId === undefined ? undefined : eq(investmentTrades.accountId, filter.accountId),
        ];
        return (await tradeRowsIn(tx, and(...conditions))).map(tradeView);
      }),

    createAsset: (userId, input) =>
      withUser(db, userId, async (tx) => {
        const platform = await platformIn(tx, input.accountId);
        const values = {
          ...(await assetValuesOf(tx, input)),
          accountId: platform.id,
          quoteCurrency: platform.currency,
        };
        const [duplicate] = await tx
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.accountId, values.accountId), eq(assets.symbol, values.symbol)));
        if (duplicate !== undefined) throw invalidAsset('The platform already has this symbol');
        const sortOrder = firstRow(
          await tx.select({ next: sql<number>`coalesce(max(${assets.sortOrder}) + 1, 0)::int` }).from(assets),
          'assets',
        ).next;
        const row = firstRow(
          await tx
            .insert(assets)
            .values({ ...values, userId, sortOrder })
            .returning({ id: assets.id }),
          'assets',
        );
        return assetIn(tx, userId, row.id);
      }),

    updateAsset: (userId, id, patch) =>
      withUser(db, userId, async (tx) => {
        const current = await lockedAssetIn(tx, id);
        const values = await assetValuesOf(tx, { ...inputOf(current), ...patch });
        const [duplicate] = await tx
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.accountId, current.accountId), eq(assets.symbol, values.symbol), ne(assets.id, id)));
        if (duplicate !== undefined) throw invalidAsset('The platform already has this symbol');
        await tx
          .update(assets)
          .set({ ...values, updatedAt: now() })
          .where(eq(assets.id, id));
        return assetIn(tx, userId, id);
      }),

    removeAsset: (userId, id) =>
      withUser(db, userId, async (tx) => {
        await lockedAssetIn(tx, id);
        await tx.delete(assets).where(eq(assets.id, id));
      }),

    createCategory: (userId, input) =>
      withUser(db, userId, async (tx) => {
        if (!ASSET_CLASSES.includes(input.assetClass)) throw invalidAsset('Invalid asset class');
        const sortOrder = firstRow(
          await tx
            .select({ next: sql<number>`coalesce(max(${assetCategories.sortOrder}) + 1, 0)::int` })
            .from(assetCategories),
          'asset_categories',
        ).next;
        const row = firstRow(
          await tx
            .insert(assetCategories)
            .values({ userId, name: categoryName(input.name), assetClass: input.assetClass, sortOrder })
            .returning({ id: assetCategories.id }),
          'asset_categories',
        );
        return categoryIn(tx, row.id);
      }),

    updateCategory: (userId, id, patch) =>
      withUser(db, userId, async (tx) => {
        await categoryIn(tx, id);
        if (patch.assetClass !== undefined && !ASSET_CLASSES.includes(patch.assetClass)) {
          throw invalidAsset('Invalid asset class');
        }
        await tx
          .update(assetCategories)
          .set({
            ...(patch.name === undefined ? {} : { name: categoryName(patch.name) }),
            ...(patch.assetClass === undefined ? {} : { assetClass: patch.assetClass }),
            updatedAt: now(),
          })
          .where(eq(assetCategories.id, id));
        if (patch.assetIds !== undefined) {
          const ids = [...new Set(patch.assetIds)];
          const found =
            ids.length === 0 ? [] : await tx.select({ id: assets.id }).from(assets).where(inArray(assets.id, ids));
          if (found.length !== ids.length) throw new LedgerError('NOT_FOUND', 'No such asset');
          await tx.update(assets).set({ categoryId: null }).where(eq(assets.categoryId, id));
          if (ids.length > 0) await tx.update(assets).set({ categoryId: id }).where(inArray(assets.id, ids));
        }
        return categoryIn(tx, id);
      }),

    removeCategory: (userId, id) =>
      withUser(db, userId, async (tx) => {
        await categoryIn(tx, id);
        await tx.update(assets).set({ categoryId: null }).where(eq(assets.categoryId, id));
        await tx.delete(assetCategories).where(eq(assetCategories.id, id));
      }),

    moveAsset: (userId, assetId, categoryId) =>
      withUser(db, userId, async (tx) => {
        await lockedAssetIn(tx, assetId);
        if (categoryId !== null) await categoryIn(tx, categoryId);
        await tx.update(assets).set({ categoryId, updatedAt: now() }).where(eq(assets.id, assetId));
      }),

    setTargets: (userId, targets) =>
      withUser(db, userId, async (tx) => {
        const entries = Object.entries(targets) as [AssetClass, number][];
        if (entries.some(([assetClass]) => !ASSET_CLASSES.includes(assetClass)))
          throw invalidAsset('Invalid asset class');
        let valid: boolean;
        try {
          valid = checkTargets(Object.fromEntries(entries)).valid;
        } catch {
          valid = false;
        }
        if (!valid) throw invalidAsset('Targets must total 100%');
        await tx.delete(allocationTargets);
        await tx
          .insert(allocationTargets)
          .values(entries.map(([assetClass, targetBps]) => ({ userId, assetClass, targetBps })));
      }),

    recordTrade: (userId, input) =>
      withUser(db, userId, async (tx) => {
        const replay = await existingTradeIn(tx, input.clientId);
        if (replay !== null) return replay;
        const at = now();
        const description = input.description ?? null;

        if (input.kind === 'cash_topup') {
          const platform = await platformIn(tx, input.accountId);
          const { timezone } = await userContextIn(tx, userId);
          const localDate = localDateOf(input.occurredAt, timezone);
          const transfer = await recordTransactionIn(
            tx,
            userId,
            {
              type: 'transfer',
              clientId: input.clientId,
              occurredAt: input.occurredAt,
              fromAccountId: input.fromAccountId,
              toAccountId: platform.id,
              sentMinor: input.sentMinor,
              receivedMinor: input.receivedMinor ?? input.sentMinor,
              description,
            },
            null,
            at,
          );
          const id = await insertTradeIn(tx, userId, {
            asset: null,
            accountId: platform.id,
            kind: 'cash_topup',
            clientId: input.clientId,
            occurredAt: input.occurredAt,
            localDate,
            units: '0',
            amountMinor: input.receivedMinor ?? input.sentMinor,
            fxRate: '1',
            transactionId: transfer.id,
            description,
          });
          return tradeViewIn(tx, id);
        }

        const context = await tradeContextIn(tx, userId, input.assetId, input.occurredAt, input.fxRate);
        const { asset, platform, baseCurrency, localDate, rate } = context;
        const { amount, fee, tax } = amounts(input);
        const header = { clientId: input.clientId, occurredAt: input.occurredAt, localDate, description: asset.symbol };
        const base = {
          asset,
          accountId: platform.id,
          clientId: input.clientId,
          occurredAt: input.occurredAt,
          localDate,
          fxRate: rate,
          feeMinor: fee,
          taxMinor: tax,
          description,
        };
        let id: string;
        if (input.kind === 'buy') {
          const units = decimalOf(input.units, invalidTrade);
          if (amount <= 0n) throw invalidTrade('The amount must be positive');
          const transactionId = await insertCashLegIn(
            tx,
            userId,
            { ...header, type: 'investment' },
            await cashLinesIn(tx, userId, platform, localDate, -amount, fee, tax),
            at,
          );
          id = await insertTradeIn(tx, userId, {
            ...base,
            kind: 'buy',
            status: input.pending === true ? 'pending' : 'settled',
            units,
            price: input.price == null ? null : decimalOf(input.price, invalidTrade),
            amountMinor: amount,
            transactionId,
          });
        } else if (input.kind === 'sell') {
          const units = decimalOf(input.units, invalidTrade);
          if (amount < 0n) throw invalidTrade('The proceeds must not be negative');
          if (fee + tax > amount) throw invalidTrade('Fee and tax exceed the proceeds');
          const held = (await replayIn(tx, asset, baseCurrency)).units;
          await reallocateGoalsIn(tx, asset.id, held, units, input.reduceGoalId ?? null);
          // Worthless units sold for nothing move no cash.
          const transactionId =
            amount === 0n
              ? null
              : await insertCashLegIn(
                  tx,
                  userId,
                  { ...header, type: 'investment' },
                  await cashLinesIn(tx, userId, platform, localDate, amount, fee, tax),
                  at,
                );
          let transferTransactionId: string | null = null;
          const net = amount - fee - tax;
          if (input.proceedsAccountId != null && net > 0n) {
            const target = (await accountsIn(tx, [input.proceedsAccountId])).get(
              input.proceedsAccountId,
            ) as LedgerAccount;
            if (target.currency !== platform.currency)
              throw invalidTrade('Withdraw to an account in the same currency');
            transferTransactionId = (
              await recordTransactionIn(
                tx,
                userId,
                {
                  type: 'transfer',
                  clientId: randomUUID(),
                  occurredAt: input.occurredAt,
                  fromAccountId: platform.id,
                  toAccountId: target.id,
                  sentMinor: net,
                  receivedMinor: net,
                  description: asset.symbol,
                },
                null,
                at,
              )
            ).id;
          }
          id = await insertTradeIn(tx, userId, {
            ...base,
            kind: 'sell',
            units,
            price: input.price == null ? null : decimalOf(input.price, invalidTrade),
            amountMinor: amount,
            proceedsAccountId: input.proceedsAccountId ?? null,
            transactionId,
            transferTransactionId,
            reducedGoalId: input.reduceGoalId ?? null,
          });
        } else {
          if (amount <= 0n) throw invalidTrade('The dividend must be positive');
          if (fee + tax > amount) throw invalidTrade('Fee and tax exceed the dividend');
          const units = input.mode === 'reinvest' ? decimalOf(input.units ?? '', invalidTrade) : '0';
          let transactionId: string | null = null;
          if (input.mode !== 'reinvest') {
            if (input.mode === 'account' && input.accountId == null) throw invalidTrade('Choose the account paid into');
            const account =
              input.mode === 'cash'
                ? platform
                : ((await accountsIn(tx, [input.accountId as string])).get(input.accountId as string) as LedgerAccount);
            if (account.currency !== platform.currency) throw invalidTrade('Pay into an account in the same currency');
            transactionId = await insertCashLegIn(
              tx,
              userId,
              { ...header, type: 'dividend' },
              await cashLinesIn(tx, userId, account, localDate, amount, fee, tax),
              at,
            );
          }
          id = await insertTradeIn(tx, userId, {
            ...base,
            kind: 'dividend',
            units,
            amountMinor: amount,
            dividendMode: input.mode,
            proceedsAccountId: input.mode === 'account' ? (input.accountId as string) : null,
            transactionId,
          });
        }
        await replayIn(tx, asset, baseCurrency);
        return tradeViewIn(tx, id);
      }),

    adjustHoldings: (userId, input) =>
      withUser(db, userId, async (tx) => {
        const replay = await existingTradeIn(tx, input.clientId);
        if (replay !== null) return replay;
        const context = await tradeContextIn(tx, userId, input.assetId, input.occurredAt, input.fxRate);
        const { asset, platform, baseCurrency, localDate, rate } = context;
        const held = (await replayIn(tx, asset, baseCurrency)).units;
        let target: bigint;
        try {
          target = parseDecimal(input.units);
        } catch {
          throw invalidTrade('Not a decimal');
        }
        if (target < 0n) throw invalidTrade('Units must not be negative');
        const delta = target - parseDecimal(held);
        if (delta === 0n) throw invalidTrade('The units already match');
        const price = input.price == null ? null : decimalOf(input.price, invalidTrade);
        const base = {
          asset,
          accountId: platform.id,
          clientId: input.clientId,
          occurredAt: input.occurredAt,
          localDate,
          fxRate: rate,
          price,
        };
        let id: string;
        if (delta < 0n) {
          if (input.reason !== 'correction') throw invalidTrade('Fewer units are a sale or a correction');
          await reallocateGoalsIn(tx, asset.id, held, formatDecimal(-delta), input.reduceGoalId ?? null);
          id = await insertTradeIn(tx, userId, {
            ...base,
            kind: 'adjust',
            units: formatDecimal(delta),
            amountMinor: 0n,
            reducedGoalId: input.reduceGoalId ?? null,
          });
        } else if (input.reason === 'correction') {
          id = await insertTradeIn(tx, userId, {
            ...base,
            kind: 'adjust',
            units: formatDecimal(delta),
            amountMinor: 0n,
          });
        } else {
          const amount =
            input.amountMinor ??
            (price === null ? 0n : marketValueMinor(formatDecimal(delta), price, asset.quoteCurrency));
          if (amount <= 0n) throw invalidTrade('The amount must be positive');
          id = await insertTradeIn(tx, userId, {
            ...base,
            kind: input.reason === 'drip' ? 'dividend' : 'buy',
            units: formatDecimal(delta),
            amountMinor: amount,
            dividendMode: input.reason === 'drip' ? 'reinvest' : null,
          });
        }
        await replayIn(tx, asset, baseCurrency);
        return tradeViewIn(tx, id);
      }),

    settleTrade: (userId, tradeId, input) =>
      withUser(db, userId, async (tx) => {
        const trade = await tradeViewIn(tx, tradeId);
        if (trade.status !== 'pending' || trade.assetId === null) throw invalidTrade('Only a pending buy settles');
        const asset = await lockedAssetIn(tx, trade.assetId);
        const { baseCurrency } = await userContextIn(tx, userId);
        await tx
          .update(investmentTrades)
          .set({
            status: 'settled',
            units: decimalOf(input.units, invalidTrade),
            price: input.price == null ? trade.price : decimalOf(input.price, invalidTrade),
            updatedAt: now(),
          })
          .where(eq(investmentTrades.id, tradeId));
        await replayIn(tx, asset, baseCurrency);
        return tradeViewIn(tx, tradeId);
      }),

    removeTrade: (userId, tradeId) =>
      withUser(db, userId, async (tx) => {
        const trade = await tradeViewIn(tx, tradeId);
        const asset = trade.assetId === null ? null : await lockedAssetIn(tx, trade.assetId);
        const linked = [trade.transactionId, trade.transferTransactionId].filter((id): id is string => id !== null);
        await assertOpenDatesIn(tx, [trade.localDate]);
        await assertOpenTransactionsIn(tx, linked);
        if (linked.length > 0) {
          await tx
            .update(transactions)
            .set({ deletedAt: now(), updatedAt: now() })
            .where(inArray(transactions.id, linked));
          await logActivity(tx, userId, 'transaction', linked, 'deleted', { source: 'manual' });
        }
        await tx.delete(investmentTrades).where(eq(investmentTrades.id, tradeId));
        if (asset !== null) await replayIn(tx, asset, (await userContextIn(tx, userId)).baseCurrency);
      }),
  };
}
