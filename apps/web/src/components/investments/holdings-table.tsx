// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Kepemilikan" (FR-I4, design 09 `bgmSP`, search `T9yDX`, groups `n6Wcnt` / `p9ExJx`, menu `zxtp9`): the held assets
 * and platform cash with value (quote currency and ≈ base), share of the portfolio (and the class target in group
 * headings), unrealized and realized gain; search by ticker, name, or category; grouped by "Daftar saya", class, or
 * platform; each asset's ⋮ menu; the portfolio total at the bottom.
 */
import type { AssetView, PortfolioView } from '@wf/db/investments';
import { ratioBps } from '@wf/domain/budget';
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
import { Money } from '@wf/ui/money';
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
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '../form.tsx';
import {
  CLASS_TONE,
  classLabel,
  holdingGroups,
  toUsd,
  type DisplayCurrency,
  type HoldingGroup,
  type HoldingItem,
  type HoldingsGrouping,
} from './investments-model.ts';

export type AssetAction =
  | 'detail'
  | 'buy'
  | 'sell'
  | 'dividend'
  | 'adjust'
  | 'targets'
  | 'move'
  | 'goals'
  | 'edit'
  | 'remove';

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

export function HoldingsTable({ portfolio, display, usdRate, locale, onAction, onTopUp, onAddAsset }: HoldingsTableProps) {
  const [grouping, setGrouping] = useState<HoldingsGrouping>('list');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const groups = holdingGroups(portfolio, grouping, query);
  const base = portfolio.baseCurrency;
  const usd = display === 'usd' && usdRate !== null;
  const searching = query.trim() !== '';
  const matched = groups.flatMap((entry) => entry.items);
  const total = portfolio.summary;

  /** A value in the display currency: the quote currency when it is USD in USD mode, else converted. */
  const value = (baseMinor: bigint, quote: { currency: string; minor: bigint } | null, className = '') => {
    if (usd) {
      const minor = quote?.currency === 'USD' ? quote.minor : toUsd(baseMinor, base, usdRate);
      return <Money minor={minor} currency="USD" context="amount" locale={locale} className={className} />;
    }
    if (quote === null || quote.currency === base) {
      return <Money minor={baseMinor} currency={base} context="amount" locale={locale} className={className} />;
    }
    return <Money minor={quote.minor} currency={quote.currency} context="amount" locale={locale} className={className} />;
  };
  const approx = (baseMinor: bigint, currency: string | null) =>
    usd || currency === null || currency === base ? null : (
      <span className="text-[11px] text-subtle">
        ≈ <Money minor={baseMinor} currency={base} context="amount" locale={locale} />
      </span>
    );
  const gain = (baseMinor: bigint, quote: { currency: string; minor: bigint } | null, bps: number | null) => (
    <span className="flex flex-col items-end">
      {usd ? (
        <Money
          minor={quote?.currency === 'USD' ? quote.minor : toUsd(baseMinor, base, usdRate)}
          currency="USD"
          context="delta"
          locale={locale}
        />
      ) : quote === null || quote.currency === base ? (
        <Money minor={baseMinor} currency={base} context="delta" locale={locale} />
      ) : (
        <Money minor={quote.minor} currency={quote.currency} context="delta" locale={locale} />
      )}
      {bps === null ? null : (
        <Percent
          value={bps / 10_000}
          signed
          locale={locale}
          className={`text-[11px] ${bps < 0 ? 'text-red-fg' : 'text-green-fg'}`}
        />
      )}
    </span>
  );

  const assetRow = (item: HoldingItem, nested: boolean) => {
    if (item.kind === 'cash') {
      return (
        <tr key={item.key} className="border-t border-border">
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
            <span className="flex flex-col items-end">
              {value(item.position.valueBaseMinor, { currency: item.currency, minor: item.cashMinor }, 'text-[13px] font-medium text-fg')}
              {approx(item.position.valueBaseMinor, item.currency)}
            </span>
          </td>
          <td className={CELL}>
            <ShareBar shareBps={ratioBps(item.position.valueBaseMinor, total.valueBaseMinor)} target={null} locale={locale} />
          </td>
          <td className={`${CELL} text-right`}>{gain(item.position.gainBaseMinor, null, null)}</td>
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
    const { asset } = item;
    const positionValue = asset.value;
    const goals = asset.goals.map((goal) =>
      goal.mode === 'whole' ? goal.goalName : `${goal.goalName} ${formatShare(goal.bps, locale)}`,
    );
    return (
      <tr key={asset.id} className="border-t border-border">
        <td className={`${CELL} ${nested ? 'pl-12' : ''}`}>
          <span className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-surface-2 font-mono text-[9.5px] text-muted-fg"
            >
              {asset.symbol.slice(0, 4)}
            </span>
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
              <span className="truncate text-[11.5px] text-subtle">{[asset.name, ...goals].join(' · ')}</span>
            </span>
            {asset.pendingMinor > 0n ? <Tag tone="blue">{m.invest_pending()}</Tag> : null}
            {asset.quote === null && asset.holding.units !== '0' ? <Tag tone="amber">{m.invest_at_cost()}</Tag> : null}
          </span>
        </td>
        <td className={`${CELL} max-xl:hidden`}>
          <ClassTag assetClass={asset.assetClass} />
        </td>
        <td className={`${CELL} text-[12.5px] text-muted-fg max-lg:hidden`}>{asset.platformName}</td>
        <td className={`${CELL} text-right`}>
          <span className="flex flex-col items-end">
            {value(
              positionValue?.valueBaseMinor ?? 0n,
              positionValue === null ? null : { currency: asset.quoteCurrency, minor: positionValue.valueMinor },
              'text-[13px] font-medium text-fg',
            )}
            {approx(positionValue?.valueBaseMinor ?? 0n, asset.quoteCurrency)}
          </span>
        </td>
        <td className={CELL}>
          <ShareBar
            shareBps={ratioBps(positionValue?.valueBaseMinor ?? 0n, total.valueBaseMinor)}
            target={null}
            locale={locale}
          />
        </td>
        <td className={`${CELL} text-right`}>
          {positionValue === null ? (
            <span className="text-subtle">—</span>
          ) : (
            gain(positionValue.gainBaseMinor, { currency: asset.quoteCurrency, minor: positionValue.gainMinor }, positionValue.gainBps)
          )}
        </td>
        <td className={`${CELL} text-right max-lg:hidden`}>
          {asset.holding.realizedMinor === 0n ? (
            <span className="text-subtle">—</span>
          ) : (
            gain(
              asset.holding.realizedBaseMinor,
              { currency: asset.quoteCurrency, minor: asset.holding.realizedMinor },
              null,
            )
          )}
        </td>
        <td className={`${CELL} w-10`}>
          <AssetMenu asset={asset} targetBps={portfolio.targets[asset.assetClass] ?? null} locale={locale} onAction={onAction} />
        </td>
      </tr>
    );
  };

  const groupRow = (entry: HoldingGroup) => {
    const open = !collapsed.has(entry.key);
    const symbols = entry.items.map((item) => (item.kind === 'cash' ? item.currency : item.asset.symbol));
    return (
      <tr key={`group-${entry.key}`} className="border-t border-border bg-surface-2">
        <td className={CELL}>
          <span className="flex items-center gap-2">
            <button
              type="button"
              aria-expanded={open}
              aria-label={open ? m.invest_holdings_collapse({ name: entry.title }) : m.invest_holdings_expand({ name: entry.title })}
              onClick={() => {
                setCollapsed((previous) => {
                  const next = new Set(previous);
                  if (open) next.add(entry.key);
                  else next.delete(entry.key);
                  return next;
                });
              }}
              className="flex size-6 items-center justify-center rounded-[6px] text-subtle hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
            >
              {open ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}
            </button>
            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-fg">{entry.title}</span>
                <Tag tone="neutral">
                  {entry.kind === 'category'
                    ? m.invest_holdings_category_count({ count: entry.items.length })
                    : m.invest_holdings_position_count({ count: entry.items.length })}
                </Tag>
              </span>
              <span className="truncate text-[11.5px] text-subtle">
                {symbols.length <= 5 ? symbols.join(', ') : `${symbols.slice(0, 3).join(', ')} +${String(symbols.length - 3)}`}
              </span>
            </span>
          </span>
        </td>
        <td className={`${CELL} max-xl:hidden`}>{entry.assetClass === null ? null : <ClassTag assetClass={entry.assetClass} />}</td>
        <td className={`${CELL} text-[12.5px] text-muted-fg max-lg:hidden`}>
          {entry.kind === 'platform'
            ? null
            : [...new Set(entry.items.map((item) => (item.kind === 'cash' ? item.platformName : item.asset.platformName)))].join(' · ')}
        </td>
        <td className={`${CELL} text-right`}>
          <span className="flex flex-col items-end">
            {value(
              entry.valueBaseMinor,
              entry.currency === null || entry.valueMinor === null ? null : { currency: entry.currency, minor: entry.valueMinor },
              'text-[13px] font-semibold text-fg',
            )}
            {approx(entry.valueBaseMinor, entry.currency)}
          </span>
        </td>
        <td className={CELL}>
          <ShareBar shareBps={entry.shareBps} target={entry.targetBps} locale={locale} />
        </td>
        <td className={`${CELL} text-right`}>
          {gain(entry.gainBaseMinor, null, ratioBps(entry.gainBaseMinor, entry.costBaseMinor))}
        </td>
        <td className={`${CELL} text-right max-lg:hidden`}>
          {entry.realizedBaseMinor === 0n ? <span className="text-subtle">—</span> : gain(entry.realizedBaseMinor, null, null)}
        </td>
        <td className={CELL} />
      </tr>
    );
  };

  const singles = groups.filter((entry) => entry.kind === 'single').length;
  const grouped = groups.filter((entry) => entry.kind === 'category');
  return (
    <section aria-labelledby="invest-holdings" className="flex min-w-0 flex-col rounded-[12px] border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id="invest-holdings" className="text-[15px] font-semibold text-fg">
            {m.invest_holdings_title()}
          </h2>
          <p aria-live="polite" className="text-[12.5px] text-muted-fg">
            {searching
              ? m.invest_holdings_results({ count: matched.length, query: query.trim() })
              : grouping === 'list'
                ? m.invest_holdings_summary_list({
                    singles,
                    categories: grouped.length,
                    assets: grouped.reduce((sum, entry) => sum + entry.items.length, 0),
                  })
                : m.invest_holdings_summary({ count: matched.length })}
          </p>
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
        <div role="group" aria-label={m.invest_holdings_group()} className="flex items-center gap-0.5 rounded-[8px] border border-border p-0.5">
          {GROUPINGS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={grouping === option.value}
              onClick={() => {
                setGrouping(option.value);
              }}
              className="h-7 rounded-[6px] px-2.5 text-[12px] text-muted-fg hover:text-fg aria-pressed:bg-muted aria-pressed:text-fg focus-visible:outline-2 focus-visible:outline-ring"
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
          <col className="w-[150px]" />
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
                {searching ? m.invest_holdings_no_results({ query: query.trim() }) : m.invest_holdings_empty()}
              </td>
            </tr>
          ) : (
            groups.flatMap((entry) =>
              entry.kind === 'single'
                ? [assetRow(entry.items[0] as HoldingItem, false)]
                : [groupRow(entry), ...(collapsed.has(entry.key) ? [] : entry.items.map((item) => assetRow(item, true)))],
            )
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-border-strong">
            <th scope="row" className={`${CELL} text-left text-[13px] font-semibold text-fg`}>
              {searching ? m.invest_holdings_total_results() : m.invest_holdings_total()}
            </th>
            <td className={`${CELL} max-xl:hidden`} />
            <td className={`${CELL} max-lg:hidden`} />
            <td className={`${CELL} text-right`}>
              {value(
                searching ? groups.reduce((sum, entry) => sum + entry.valueBaseMinor, 0n) : total.valueBaseMinor,
                null,
                'text-[13px] font-semibold text-fg',
              )}
            </td>
            <td className={`${CELL} text-[11.5px] text-subtle`}>
              {searching ? (
                <Percent
                  value={(ratioBps(groups.reduce((sum, entry) => sum + entry.valueBaseMinor, 0n), total.valueBaseMinor) ?? 0) / 10_000}
                  locale={locale}
                />
              ) : (
                <Percent value={1} locale={locale} />
              )}
            </td>
            <td className={`${CELL} text-right`}>
              {searching
                ? gain(groups.reduce((sum, entry) => sum + entry.gainBaseMinor, 0n), null, null)
                : gain(total.gainBaseMinor, null, total.gainBps)}
            </td>
            <td className={`${CELL} max-lg:hidden`} />
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

function Tag({ tone, children }: { readonly tone: 'neutral' | 'blue' | 'amber'; readonly children: ReactNode }) {
  const tones = { neutral: 'border-border text-subtle', blue: 'border-blue-tint-3 text-blue-fg', amber: 'border-amber-tint-3 text-amber-fg' };
  return <span className={`shrink-0 rounded-[5px] border px-1.5 py-px text-[10.5px] ${tones[tone]}`}>{children}</span>;
}

function ClassTag({ assetClass }: { readonly assetClass: HoldingGroup['assetClass'] & string }) {
  return (
    <span className="flex items-center gap-1.5 text-[12.5px] text-muted-fg">
      <span aria-hidden="true" className={`size-1.5 rounded-full ${CLASS_TONE[assetClass].dot}`} />
      {classLabel(assetClass)}
    </span>
  );
}

/** Share of the portfolio as a bar with the target as a tick. */
function ShareBar({ shareBps, target, locale }: { readonly shareBps: number | null; readonly target: number | null; readonly locale: Locale }) {
  // The bar spans 0–40% of the portfolio (design "0–40% skala"); larger shares fill it.
  const scale = 4000;
  const width = Math.min(shareBps ?? 0, scale) / scale;
  return (
    <span className="flex items-center gap-2">
      <svg aria-hidden="true" viewBox="0 0 100 6" preserveAspectRatio="none" className="h-1.5 w-full max-w-[80px]">
        <rect width="100" height="6" rx="3" className="fill-surface-3" />
        <rect width={width * 100} height="6" rx="3" className="fill-blue" />
        {target === null ? null : <rect x={(Math.min(target, scale) / scale) * 100 - 1} width="2" height="6" className="fill-fg" />}
      </svg>
      <span className="flex flex-col font-mono text-[11.5px] text-muted-fg">
        {shareBps === null ? '—' : <Percent value={shareBps / 10_000} locale={locale} />}
        {target === null ? null : (
          <span className="text-[10.5px] text-subtle">
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
  const item = (action: AssetAction, icon: typeof Plus, label: ReactNode, disabled = false) => (
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
  const held = asset.holding.units !== '0';
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
              {targetBps === null ? null : <Percent value={targetBps / 10_000} locale={locale} className="text-subtle" />}
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
