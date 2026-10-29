// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Kepemilikan" (FR-I4, design 09 `bgmSP`, search `T9yDX`, groups `n6Wcnt` / `p9ExJx`, menu `zxtp9`): the held assets
 * and platform cash with value (quote currency and ≈ base), share of the portfolio (and the class target in group
 * headings), unrealized and realized gain; search by ticker, name, or category; grouped by "Daftar saya", class, or
 * platform; each asset's ⋮ menu; the portfolio total at the bottom.
 */
import type { AssetView, PortfolioView } from '@wf/db/investments';
import { ratioBps } from '@wf/domain/budget';
import { getCatalogRecord } from '@wf/domain/catalog';
import type { AssetClass } from '@wf/domain/investments';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@wf/ui/dropdown-menu';
import { Percent } from '@wf/ui/percent';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
  Coins,
  Ellipsis,
  FolderInput,
  PanelRight,
  Pencil,
  PiggyBank,
  Plus,
  Scale,
  Search,
  SlidersHorizontal,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '../form.tsx';
import { ApproxBase, DisplayMoney, type AmountDisplay } from './display-money.tsx';
import { AssetLogo } from './asset-logo.tsx';
import {
  CLASS_TONE,
  classLabel,
  holdingGroups,
  isClosed,
  toUsd,
  type DisplayCurrency,
  type HoldingGroup,
  type HoldingItem,
  type HoldingsGrouping,
  type HoldingsView,
} from './investments-model.ts';

export type AssetAction =
  'detail' | 'buy' | 'sell' | 'dividend' | 'adjust' | 'targets' | 'move' | 'goals' | 'edit' | 'remove';

export interface HoldingsTableProps {
  readonly portfolio: PortfolioView;
  readonly display: DisplayCurrency;
  readonly usdRate: string | null;
  readonly locale: Locale;
  readonly onAction: (action: AssetAction, asset: AssetView) => void;
  readonly onTopUp: (accountId: string) => void;
  readonly onAddAsset: () => void;
}

const GROUPINGS: readonly { readonly value: HoldingsGrouping; readonly label: () => string }[] = [
  { value: 'list', label: m.invest_holdings_group_list },
  { value: 'class', label: m.invest_holdings_group_class },
  { value: 'platform', label: m.invest_holdings_group_platform },
];

const CELL = 'px-3 py-2.5 align-middle';

/**
 * A gain in the display currency with its percentage below. The percentage is taken in the same currency as the
 * amount (the quote when the row shows one, USD in the USD mode, else the base), so a loss never shows a plus.
 */
function Gain({
  baseMinor,
  quoteMinor,
  quoteCurrency,
  costBaseMinor,
  costMinor,
  display,
  percent = true,
}: {
  readonly baseMinor: bigint;
  readonly quoteMinor?: bigint | undefined;
  readonly quoteCurrency?: string | undefined;
  /** The cost behind `baseMinor` and `quoteMinor`: `ratioBps` needs it for the percentage. */
  readonly costBaseMinor: bigint;
  readonly costMinor?: bigint | undefined;
  readonly display: AmountDisplay;
  readonly percent?: boolean;
}) {
  const { base, usdRate } = display;
  const quoted = quoteMinor !== undefined && quoteCurrency !== undefined && quoteCurrency !== base;
  const inUsd = usdRate !== null;
  const shownMinor = inUsd
    ? quoteCurrency === 'USD' && quoteMinor !== undefined
      ? quoteMinor
      : toUsd(baseMinor, base, usdRate)
    : quoted
      ? quoteMinor
      : baseMinor;
  const shownCost = inUsd
    ? quoteCurrency === 'USD' && costMinor !== undefined
      ? costMinor
      : toUsd(costBaseMinor, base, usdRate)
    : quoted
      ? (costMinor ?? costBaseMinor)
      : costBaseMinor;
  const bps = percent ? ratioBps(shownMinor, shownCost) : null;
  return (
    <span className="flex flex-col items-end">
      <DisplayMoney
        baseMinor={baseMinor}
        quoteMinor={quoteMinor}
        quoteCurrency={quoteCurrency}
        display={display}
        context="signed"
        className="text-[13px]"
      />
      {bps === null ? null : (
        <Percent
          value={bps / 10_000}
          signed
          locale={display.locale}
          className={`text-[11px] ${bps < 0 ? 'text-red-fg' : 'text-green-fg'}`}
        />
      )}
    </span>
  );
}

/** Value with "≈ base" below when the row is priced in another currency. */
function ValueCell({
  baseMinor,
  quoteMinor,
  quoteCurrency,
  display,
  strong = false,
}: {
  readonly baseMinor: bigint;
  readonly quoteMinor?: bigint | undefined;
  readonly quoteCurrency: string | null;
  readonly display: AmountDisplay;
  readonly strong?: boolean;
}) {
  return (
    <span className="flex flex-col items-end">
      <DisplayMoney
        baseMinor={baseMinor}
        quoteMinor={quoteMinor}
        quoteCurrency={quoteCurrency ?? undefined}
        display={display}
        className={`text-[13px] text-fg ${strong ? 'font-semibold' : 'font-medium'}`}
      />
      <ApproxBase baseMinor={baseMinor} currency={quoteCurrency} display={display} />
    </span>
  );
}

function CashRow({
  item,
  nested,
  shareBps,
  display,
  onTopUp,
}: {
  readonly item: Extract<HoldingItem, { kind: 'cash' }>;
  readonly nested: boolean;
  readonly shareBps: number | null;
  readonly display: AmountDisplay;
  readonly onTopUp: (accountId: string) => void;
}) {
  return (
    <tr className="border-t border-border">
      <td className={`${CELL} ${nested ? 'pl-12' : ''}`}>
        <span className="flex items-center gap-3">
          <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-[8px] bg-surface-2">
            <Coins className="size-4 text-muted-fg" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="font-mono text-[13px] font-medium text-fg">
              {m.invest_cash_name({ platform: item.platformName })}
            </span>
            <span className="text-[11.5px] text-subtle">{m.invest_cash_sub({ currency: item.currency })}</span>
          </span>
        </span>
      </td>
      <td className={`${CELL} max-xl:hidden`}>
        <ClassTag assetClass="cash" />
      </td>
      <td className={`${CELL} text-[12.5px] text-muted-fg max-lg:hidden`}>{item.platformName}</td>
      <td className={`${CELL} text-right`}>
        <ValueCell
          baseMinor={item.position.valueBaseMinor}
          quoteMinor={item.cashMinor}
          quoteCurrency={item.currency}
          display={display}
        />
      </td>
      <td className={CELL}>
        <ShareBar shareBps={shareBps} target={null} locale={display.locale} />
      </td>
      <td className={`${CELL} text-right`}>
        <Gain baseMinor={item.position.gainBaseMinor} costBaseMinor={0n} display={display} percent={false} />
      </td>
      <td className={`${CELL} text-right text-subtle max-lg:hidden`}>—</td>
      <td className={`${CELL} w-10`}>
        <button
          type="button"
          aria-label={m.invest_cash_topup({ platform: item.platformName })}
          onClick={() => {
            onTopUp(item.accountId);
          }}
          className="flex size-[26px] items-center justify-center rounded-[6px] text-subtle hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Plus aria-hidden="true" className="size-4" />
        </button>
      </td>
    </tr>
  );
}

function AssetRow({
  asset,
  nested,
  shareBps,
  targetBps,
  display,
  onAction,
}: {
  readonly asset: AssetView;
  readonly nested: boolean;
  readonly shareBps: number | null;
  readonly targetBps: number | null;
  readonly display: AmountDisplay;
  readonly onAction: (action: AssetAction, asset: AssetView) => void;
}) {
  const { value, holding } = asset;
  // Realized profit: what the sales left plus the dividends that went out in cash.
  const realizedMinor = holding.realizedMinor + asset.dividendCashMinor;
  const realized =
    realizedMinor === 0n
      ? null
      : { minor: realizedMinor, baseMinor: holding.realizedBaseMinor + asset.dividendCashBaseMinor };
  const reference = getCatalogRecord(asset.catalogId);
  const goals = asset.goals.map((goal) =>
    goal.mode === 'whole' ? goal.goalName : `${goal.goalName} ${formatShare(goal.bps, display.locale)}`,
  );
  return (
    <tr className="border-t border-border">
      <td className={`${CELL} ${nested ? 'pl-12' : ''}`}>
        <span className="flex items-center gap-3">
          <AssetLogo asset={asset} />
          <span className="flex min-w-0 flex-col">
            <button
              type="button"
              onClick={() => {
                onAction('detail', asset);
              }}
              className="w-fit font-mono text-[13px] font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {asset.symbol}
            </button>
            {/* Below 1024 px the Platform column is hidden, so the platform joins the subtitle. */}
            <span className="truncate text-[11.5px] text-subtle">
              {asset.name}
              {reference?.venue == null ? null : ` · ${reference.venue}`}
              <span className="lg:hidden">
                {' · '}
                {asset.platformName}
              </span>
              {goals.map((goal) => ` · ${goal}`).join('')}
            </span>
          </span>
          {asset.pendingMinor > 0n ? <Tag tone="blue">{m.invest_pending()}</Tag> : null}
          {asset.quote === null && holding.units !== '0' ? <Tag tone="amber">{m.invest_at_cost()}</Tag> : null}
        </span>
      </td>
      <td className={`${CELL} max-xl:hidden`}>
        <ClassTag assetClass={asset.assetClass} />
      </td>
      <td className={`${CELL} text-[12.5px] text-muted-fg max-lg:hidden`}>{asset.platformName}</td>
      <td className={`${CELL} text-right`}>
        {value === null ? (
          <span className="text-subtle">—</span>
        ) : (
          <ValueCell
            baseMinor={value.valueBaseMinor}
            quoteMinor={value.valueMinor}
            quoteCurrency={asset.quoteCurrency}
            display={display}
          />
        )}
      </td>
      <td className={CELL}>
        <ShareBar shareBps={shareBps} target={null} locale={display.locale} />
      </td>
      <td className={`${CELL} text-right`}>
        {value === null ? (
          <span className="text-subtle">—</span>
        ) : (
          <Gain
            baseMinor={value.gainBaseMinor}
            quoteMinor={value.gainMinor}
            quoteCurrency={asset.quoteCurrency}
            costBaseMinor={value.valueBaseMinor - value.gainBaseMinor}
            costMinor={value.valueMinor - value.gainMinor}
            display={display}
          />
        )}
      </td>
      <td className={`${CELL} text-right max-lg:hidden`}>
        {realized === null ? (
          <span className="text-subtle">—</span>
        ) : (
          <Gain
            baseMinor={realized.baseMinor}
            quoteMinor={realized.minor}
            quoteCurrency={asset.quoteCurrency}
            costBaseMinor={0n}
            display={display}
            percent={false}
          />
        )}
      </td>
      <td className={`${CELL} w-10`}>
        <AssetMenu asset={asset} targetBps={targetBps} locale={display.locale} onAction={onAction} />
      </td>
    </tr>
  );
}

function GroupRow({
  entry,
  open,
  display,
  onToggle,
}: {
  readonly entry: HoldingGroup;
  readonly open: boolean;
  readonly display: AmountDisplay;
  readonly onToggle: () => void;
}) {
  const symbols = entry.items.map((item) => (item.kind === 'cash' ? item.currency : item.asset.symbol));
  const platforms = [
    ...new Set(entry.items.map((item) => (item.kind === 'cash' ? item.platformName : item.asset.platformName))),
  ];
  return (
    <tr className="border-t border-border bg-surface-2">
      <td className={CELL}>
        <span className="flex items-center gap-2">
          <button
            type="button"
            aria-expanded={open}
            aria-label={
              open ? m.invest_holdings_collapse({ name: entry.title }) : m.invest_holdings_expand({ name: entry.title })
            }
            onClick={onToggle}
            className="flex size-6 items-center justify-center rounded-[6px] text-subtle hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
          >
            {open ? (
              <ChevronDown aria-hidden="true" className="size-4" />
            ) : (
              <ChevronRight aria-hidden="true" className="size-4" />
            )}
          </button>
          <span className="flex min-w-0 flex-col">
            {/* Wraps: in a narrow column the count drops under the title instead of running into the next one. */}
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[13px] font-semibold text-fg">{entry.title}</span>
              <Tag tone="neutral">
                {entry.kind === 'category'
                  ? m.invest_holdings_category_count({ count: entry.items.length })
                  : m.invest_holdings_position_count({ count: entry.items.length })}
              </Tag>
            </span>
            <span className="truncate text-[11.5px] text-subtle">
              {symbols.length <= 5
                ? symbols.join(', ')
                : `${symbols.slice(0, 3).join(', ')} +${String(symbols.length - 3)}`}
            </span>
          </span>
        </span>
      </td>
      <td className={`${CELL} max-xl:hidden`}>
        {entry.assetClass === null ? null : <ClassTag assetClass={entry.assetClass} />}
      </td>
      <td className={`${CELL} text-[12.5px] text-muted-fg max-lg:hidden`}>
        {entry.kind === 'platform' ? null : platforms.join(' · ')}
      </td>
      <td className={`${CELL} text-right`}>
        <ValueCell
          baseMinor={entry.valueBaseMinor}
          quoteMinor={entry.valueMinor ?? undefined}
          quoteCurrency={entry.currency}
          display={display}
          strong
        />
      </td>
      <td className={CELL}>
        <ShareBar shareBps={entry.shareBps} target={entry.targetBps} locale={display.locale} />
      </td>
      <td className={`${CELL} text-right`}>
        <Gain
          baseMinor={entry.gainBaseMinor}
          quoteMinor={entry.valueMinor ?? undefined}
          quoteCurrency={entry.currency ?? undefined}
          costBaseMinor={entry.costBaseMinor}
          costMinor={entry.costMinor ?? undefined}
          display={display}
        />
      </td>
      <td className={`${CELL} text-right max-lg:hidden`}>
        {entry.realizedBaseMinor === 0n ? (
          <span className="text-subtle">—</span>
        ) : (
          <Gain baseMinor={entry.realizedBaseMinor} costBaseMinor={0n} display={display} percent={false} />
        )}
      </td>
      <td className={CELL} />
    </tr>
  );
}

export function HoldingsTable({
  portfolio,
  display: mode,
  usdRate,
  locale,
  onAction,
  onTopUp,
  onAddAsset,
}: HoldingsTableProps) {
  const [view, setView] = useState<HoldingsView>('open');
  const [grouping, setGrouping] = useState<HoldingsGrouping>('list');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const groups = holdingGroups(portfolio, grouping, query, view);
  const display: AmountDisplay = { base: portfolio.baseCurrency, usdRate: mode === 'usd' ? usdRate : null, locale };
  const searching = query.trim() !== '';
  const closed = view === 'closed';
  const closedCount = portfolio.assets.filter(isClosed).length;
  // The footer sums the rows shown when they are not the whole open portfolio (a search, or the closed tab).
  const partial = searching || closed;
  const matched = groups.flatMap((entry) => entry.items);
  const total = portfolio.summary;
  const shownValue = groups.reduce((sum, entry) => sum + entry.valueBaseMinor, 0n);
  const shownGain = groups.reduce((sum, entry) => sum + entry.gainBaseMinor, 0n);
  const shownRealized = groups.reduce((sum, entry) => sum + entry.realizedBaseMinor, 0n);
  const shownCost = groups.reduce((sum, entry) => sum + entry.costBaseMinor, 0n);
  const shownShare = ratioBps(shownValue, total.valueBaseMinor);

  const row = (item: HoldingItem, nested: boolean) => {
    const share = ratioBps(
      item.kind === 'cash' ? item.position.valueBaseMinor : (item.asset.value?.valueBaseMinor ?? 0n),
      total.valueBaseMinor,
    );
    return item.kind === 'cash' ? (
      <CashRow key={item.key} item={item} nested={nested} shareBps={share} display={display} onTopUp={onTopUp} />
    ) : (
      <AssetRow
        key={item.asset.id}
        asset={item.asset}
        nested={nested}
        shareBps={share}
        targetBps={portfolio.targets[item.asset.assetClass] ?? null}
        display={display}
        onAction={onAction}
      />
    );
  };

  const singles = groups.filter((entry) => entry.kind === 'single').length;
  const grouped = groups.filter((entry) => entry.kind === 'category');
  return (
    <section
      aria-labelledby="invest-holdings"
      className="flex min-w-0 flex-col rounded-[12px] border border-border bg-card"
    >
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        {/* Below 1280 px the title and summary take their own row, the controls the next one. */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 max-xl:basis-full">
          <h2 id="invest-holdings" className="text-[15px] font-semibold text-fg">
            {m.invest_holdings_title()}
          </h2>
          <p aria-live="polite" className="text-[12.5px] text-muted-fg">
            {searching
              ? m.invest_holdings_results({ count: matched.length, query: query.trim() })
              : grouping === 'list' && !closed
                ? m.invest_holdings_summary_list({
                    singles,
                    categories: grouped.length,
                    assets: grouped.reduce((sum, entry) => sum + entry.items.length, 0),
                  })
                : m.invest_holdings_summary({ count: matched.length })}
          </p>
        </div>
        <div
          role="group"
          aria-label={m.invest_holdings_view()}
          className="flex items-center gap-0.5 rounded-[8px] border border-border p-0.5"
        >
          {(['open', 'closed'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => {
                setView(option);
              }}
              className="h-7 rounded-[6px] px-2.5 text-[12px] text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-muted aria-pressed:text-fg"
            >
              {option === 'open'
                ? m.invest_holdings_view_open()
                : m.invest_holdings_view_closed({ count: closedCount })}
            </button>
          ))}
        </div>
        <label className="flex h-8 w-[240px] items-center gap-2 rounded-[8px] border border-border-input bg-input px-2.5 focus-within:outline-2 focus-within:outline-ring max-md:w-full">
          <Search aria-hidden="true" className="size-3.5 text-subtle" />
          <input
            type="search"
            aria-label={m.invest_holdings_search()}
            placeholder={m.invest_holdings_search()}
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-fg outline-none placeholder:text-subtle"
          />
        </label>
        <div
          role="group"
          aria-label={m.invest_holdings_group()}
          className="flex items-center gap-0.5 rounded-[8px] border border-border p-0.5"
        >
          {GROUPINGS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={grouping === option.value}
              onClick={() => {
                setGrouping(option.value);
              }}
              className="h-7 rounded-[6px] px-2.5 text-[12px] text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-muted aria-pressed:text-fg"
            >
              {option.label()}
            </button>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={onAddAsset}>
          <Plus aria-hidden="true" className="size-3.5" />
          {m.invest_add_asset()}
        </Button>
      </div>
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col />
          <col className="w-[130px] max-xl:hidden" />
          <col className="w-[120px] max-lg:hidden" />
          <col className="w-[150px]" />
          <col className="w-[160px]" />
          <col className="w-[130px]" />
          <col className="w-[110px] max-lg:hidden" />
          <col className="w-10" />
        </colgroup>
        <thead>
          <tr className="text-left text-[11.5px] text-subtle">
            <th scope="col" className={`${CELL} font-normal`}>
              {m.invest_holdings_col_asset()}
            </th>
            <th scope="col" className={`${CELL} font-normal max-xl:hidden`}>
              {m.invest_holdings_col_class()}
            </th>
            <th scope="col" className={`${CELL} font-normal max-lg:hidden`}>
              {m.invest_holdings_col_platform()}
            </th>
            <th scope="col" className={`${CELL} text-right font-normal`}>
              {m.invest_holdings_col_value()}
            </th>
            <th scope="col" className={`${CELL} font-normal`}>
              {m.invest_holdings_col_share()}
            </th>
            <th scope="col" className={`${CELL} text-right font-normal`}>
              {m.invest_holdings_col_unrealized()}
            </th>
            <th scope="col" className={`${CELL} text-right font-normal max-lg:hidden`}>
              {m.invest_holdings_col_realized()}
            </th>
            <th scope="col" className={CELL}>
              <span className="sr-only">{m.invest_holdings_col_actions()}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.length === 0 ? (
            <tr className="border-t border-border">
              <td colSpan={8} className="px-5 py-8 text-center text-[12.5px] text-muted-fg">
                {searching
                  ? m.invest_holdings_no_results({ query: query.trim() })
                  : closed
                    ? m.invest_holdings_closed_empty()
                    : m.invest_holdings_empty()}
              </td>
            </tr>
          ) : (
            groups.flatMap((entry) =>
              entry.kind === 'single'
                ? [row(entry.items[0] as HoldingItem, false)]
                : [
                    <GroupRow
                      key={`group-${entry.key}`}
                      entry={entry}
                      open={!collapsed.has(entry.key)}
                      display={display}
                      onToggle={() => {
                        setCollapsed((previous) => {
                          const next = new Set(previous);
                          if (next.has(entry.key)) next.delete(entry.key);
                          else next.add(entry.key);
                          return next;
                        });
                      }}
                    />,
                    ...(collapsed.has(entry.key) ? [] : entry.items.map((item) => row(item, true))),
                  ],
            )
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-border-strong">
            <th scope="row" className={`${CELL} text-left text-[13px] font-semibold text-fg`}>
              {searching
                ? m.invest_holdings_total_results()
                : closed
                  ? m.invest_holdings_closed_total()
                  : m.invest_holdings_total()}
            </th>
            <td className={`${CELL} max-xl:hidden`} />
            <td className={`${CELL} max-lg:hidden`} />
            <td className={`${CELL} text-right`}>
              <ValueCell
                baseMinor={partial ? shownValue : total.valueBaseMinor}
                quoteCurrency={null}
                display={display}
                strong
              />
            </td>
            <td className={`${CELL} text-[11.5px] text-subtle`}>
              <Percent value={partial ? (shownShare ?? 0) / 10_000 : 1} locale={locale} />
            </td>
            <td className={`${CELL} text-right`}>
              <Gain
                baseMinor={partial ? shownGain : total.gainBaseMinor}
                costBaseMinor={partial ? shownCost : total.costBaseMinor}
                display={display}
                percent={!partial}
              />
            </td>
            <td className={`${CELL} text-right max-lg:hidden`}>
              {closed && shownRealized !== 0n ? (
                <Gain baseMinor={shownRealized} costBaseMinor={0n} display={display} percent={false} />
              ) : null}
            </td>
            <td className={CELL} />
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

/** "60%" of a goal's share. */
function formatShare(bps: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(bps / 10_000);
}

const TAG_TONES = {
  neutral: 'border-border text-subtle',
  blue: 'border-blue-tint-3 text-blue-fg',
  amber: 'border-amber-tint-3 text-amber-fg',
} as const;

function Tag({ tone, children }: { readonly tone: keyof typeof TAG_TONES; readonly children: ReactNode }) {
  return (
    <span className={`shrink-0 rounded-[5px] border px-1.5 py-px text-[10.5px] ${TAG_TONES[tone]}`}>{children}</span>
  );
}

function ClassTag({ assetClass }: { readonly assetClass: AssetClass }) {
  return (
    <span className="flex items-center gap-1.5 text-[12.5px] text-muted-fg">
      <span aria-hidden="true" className={`size-1.5 rounded-full ${CLASS_TONE[assetClass].dot}`} />
      {classLabel(assetClass)}
    </span>
  );
}

/** The bar spans 0–40% of the portfolio (design "0–40% skala"); larger shares fill it. */
const SHARE_SCALE = 4000;

/** Share of the portfolio as a bar with the target as a tick. */
function ShareBar({
  shareBps,
  target,
  locale,
}: {
  readonly shareBps: number | null;
  readonly target: number | null;
  readonly locale: Locale;
}) {
  const width = (Math.min(shareBps ?? 0, SHARE_SCALE) / SHARE_SCALE) * 100;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <svg aria-hidden="true" viewBox="0 0 100 6" preserveAspectRatio="none" className="h-1.5 w-16 max-w-full">
        <rect width="100" height="6" rx="3" className="fill-surface-3" />
        <rect width={width} height="6" rx="3" className="fill-blue" />
        {target === null ? null : (
          <rect x={(Math.min(target, SHARE_SCALE) / SHARE_SCALE) * 100 - 1} width="2" height="6" className="fill-fg" />
        )}
      </svg>
      {/* "11,1% · target 12%" on one line (design `bgmSP`); it wraps under the bar as a whole when narrow. */}
      <span className="font-mono text-[11.5px] whitespace-nowrap text-muted-fg">
        {shareBps === null ? '—' : <Percent value={shareBps / 10_000} locale={locale} />}
        {target === null ? null : (
          <span className="text-[10.5px] text-subtle">
            {' · '}
            {m.invest_holdings_target()} <Percent value={target / 10_000} locale={locale} />
          </span>
        )}
      </span>
    </span>
  );
}

function AssetMenu({
  asset,
  targetBps,
  locale,
  onAction,
}: {
  readonly asset: AssetView;
  readonly targetBps: number | null;
  readonly locale: Locale;
  readonly onAction: (action: AssetAction, asset: AssetView) => void;
}) {
  const held = asset.holding.units !== '0';
  const item = (action: AssetAction, icon: LucideIcon, label: ReactNode, disabled = false) => (
    <DropdownMenuItem
      icon={icon}
      disabled={disabled}
      onSelect={() => {
        onAction(action, asset);
      }}
    >
      {label}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={m.invest_menu_open({ symbol: asset.symbol })}
        className="flex size-[26px] items-center justify-center rounded-[6px] text-subtle hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-muted"
      >
        <Ellipsis aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[248px]">
        <DropdownMenuGroup>
          {item('buy', ArrowDownToLine, m.invest_menu_buy())}
          {item('sell', ArrowUpFromLine, m.invest_menu_sell(), !held)}
          {item('dividend', Coins, m.invest_menu_dividend(), !held)}
          {item('adjust', Scale, m.invest_menu_adjust())}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {item(
            'targets',
            SlidersHorizontal,
            <span className="flex flex-1 items-center justify-between gap-2">
              {m.invest_menu_targets()}
              {targetBps === null ? null : (
                <Percent value={targetBps / 10_000} locale={locale} className="text-subtle" />
              )}
            </span>,
          )}
          {item('move', FolderInput, m.invest_menu_move())}
          {item('goals', PiggyBank, m.invest_menu_goals())}
          {item('edit', Pencil, m.invest_menu_edit())}
          {item('detail', PanelRight, m.invest_menu_detail())}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            icon={Trash2}
            variant="destructive"
            onSelect={() => {
              onAction('remove', asset);
            }}
          >
            {m.invest_menu_remove()}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
