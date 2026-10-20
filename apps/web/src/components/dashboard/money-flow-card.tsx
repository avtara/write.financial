// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Arus Uang" (FR-D2, design `iUqiN`, `UOdxM`, `q1pusQ`, `fqzal`): income sources → Pemasukan → groups → categories
 * as a Sankey drawn in SVG (laid out by `money-flow-layout.ts`). The chips focus one group; the ⋯ menu opens the
 * transactions behind it, exports the drawing (PNG download or copy), switches Rupiah/percent labels, shows sources
 * below 1%, and counts transfers between accounts (Tabungan → the destination accounts). Below 1280 px (FR-TB2) only
 * two levels show: sources → groups; a group opens its categories.
 */
import { useNavigate } from '@tanstack/react-router';
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import type { Dashboard } from '@wf/db/dashboard';
import { moneyFlow, type MoneyFlowNode } from '@wf/domain/dashboard';
import type { CategoryGroup } from '@wf/domain/categories';
import { formatMoney, formatPercent } from '@wf/i18n/format';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate, formatTime, toLocalDate } from '@wf/ui/dates';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@wf/ui/dropdown-menu';
import { Money } from '@wf/ui/money';
import { usePrivacy } from '@wf/ui/privacy';
import { toast } from '@wf/ui/toast';
import { Copy, Ellipsis, ImageDown, ListFilter, X } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { transactionsDatesOf } from '../../lib/dashboard-search.ts';
import { categoryGroupLabel, categoryName } from '../../lib/ledger-labels.ts';
import { listParamOf, type TransactionsSearch } from '../../lib/transactions-search.ts';
import { useElementWidth } from '../../lib/use-element-width.ts';
import { useMediaQuery } from '../../lib/use-media-query.ts';
import { RichMessage } from '../rich-message.tsx';
import { shortRange } from './dashboard-format.ts';
import { download, flowPng } from './money-flow-export.ts';
import { flowGraph, layoutFlow, type FlowLevels, type LaidLink, type LaidNode } from './money-flow-layout.ts';

export interface MoneyFlowCardProps {
  readonly dashboard: Dashboard;
  readonly categories: readonly CategoryView[];
  readonly accounts: readonly AccountView[];
  readonly locale: Locale;
  readonly timeZone: string;
  /** When the dashboard was loaded ("Diperbarui 15 Okt 2026, 16.42"). */
  readonly loadedAt: Date;
}

/** Fill / stroke colour of a group and everything it feeds. */
const GROUP_TONE: Readonly<Record<string, { fill: string; stroke: string; dot: string }>> = {
  'group:needs': { fill: 'fill-blue', stroke: 'stroke-blue', dot: 'bg-blue' },
  'group:wants': { fill: 'fill-violet', stroke: 'stroke-violet', dot: 'bg-violet' },
  'group:financial': { fill: 'fill-amber', stroke: 'stroke-amber', dot: 'bg-amber' },
  'group:savings': { fill: 'fill-green', stroke: 'stroke-green', dot: 'bg-green' },
};
const NEUTRAL = { fill: 'fill-neutral-mid', stroke: 'stroke-neutral-mid', dot: 'bg-neutral-mid' };

const LEFT = 170;
const RIGHT = 230;
const ROW = 34;

type Shown = 'amount' | 'percent';

interface Hover {
  readonly node: LaidNode;
  readonly link: LaidLink | null;
}

const CHIP =
  'inline-flex h-7 items-center gap-1.5 rounded-[7px] border border-border px-2.5 text-[12px] text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-border-strong aria-pressed:bg-muted aria-pressed:text-fg';

export function MoneyFlowCard({ dashboard, categories, accounts, locale, timeZone, loadedAt }: MoneyFlowCardProps) {
  const { hidden } = usePrivacy();
  const navigate = useNavigate();
  const wide = useMediaQuery('(min-width: 1280px)', true);
  const [measure, width] = useElementWidth();
  const svgRef = useRef<SVGSVGElement>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown>('amount');
  const [showSmallSources, setShowSmallSources] = useState(false);
  const [countTransfers, setCountTransfers] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const currency = dashboard.baseCurrency;
  const flow = moneyFlow(dashboard.flow, { showSmallSources, countTransfers });
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const nodeById = new Map(flow.nodes.map((node) => [node.id, node]));
  const parentOf = new Map(flow.links.map((link) => [link.to, link.from]));
  const groups = flow.nodes.filter((node) => node.column === 2);
  const dates = transactionsDatesOf(dashboard);

  const name = (id: string): string => {
    const [kind, key = ''] = id.split(':');
    if (id === 'total') return m.overview_flow_income();
    if (id === 'unallocated') return m.overview_flow_unallocated();
    if (id === 'source:other') return m.overview_flow_other_sources();
    if (id === 'source:deficit') return m.overview_flow_deficit();
    if (id === 'group:savings') return m.overview_flow_savings();
    if (kind === 'group') return categoryGroupLabel(key as CategoryGroup);
    if (kind === 'account') return accountById.get(key)?.displayName ?? m.overview_flow_account();
    const category = categoryById.get(key);
    return category === undefined ? m.overview_flow_uncategorized() : categoryName(category);
  };
  const money = (minor: bigint, context: 'amount' | 'table' = 'amount') =>
    formatMoney(minor, currency, { locale, context, privacy: hidden });
  const share = (bps: number) =>
    bps > 0 && bps < 100 ? '<1%' : formatPercent(bps / 10_000, locale, { maximumFractionDigits: 0 });
  const toneOf = (id: string) => GROUP_TONE[id.startsWith('group:') ? id : (parentOf.get(id) ?? '')] ?? NEUTRAL;

  /** `/transactions` for a node: a category, every category of a group, transfers for savings, else all. */
  const searchOf = (id: string): TransactionsSearch => {
    const [kind, key = ''] = id.split(':');
    if (id === 'group:savings' || kind === 'account' || id === 'unallocated') return { ...dates, type: 'transfer' };
    if (key === 'uncategorized') return { ...dates, uncategorized: true };
    if (kind === 'group') {
      const ids = flow.links.filter((link) => link.from === id).map((link) => link.to.slice('category:'.length));
      return { ...dates, category: listParamOf(ids.filter((categoryId) => categoryId !== 'uncategorized')) };
    }
    // `total`, `source:other`, `source:deficit`: everything in the dates.
    return categoryById.has(key) ? { ...dates, category: key } : dates;
  };
  const openNode = (id: string) => void navigate({ to: '/transactions', search: searchOf(id) });

  const levels: FlowLevels = wide ? 'full' : focus === null ? 'groups' : { group: focus };
  const graph = flowGraph(flow, levels);
  const rows = Math.max(...[0, 1, 2, 3].map((column) => graph.nodes.filter((n) => n.column === column).length));
  const height = Math.min(Math.max(rows * ROW + 40, 280), 640);
  const firstColumn = Math.min(...graph.nodes.map((node) => node.column));
  const layout =
    width === null || graph.nodes.length === 0
      ? null
      : { width, ...layoutFlow(graph, { left: LEFT, top: 16, right: width - RIGHT, bottom: height - 16 }, 18) };
  // Each node's label texts (formatted with the privacy mode), accessible name, and label centre; the two-line labels
  // of the left column are pushed apart where small nodes sit close.
  const texts = new Map<string, { value: string; label: string; middle: number }>();
  let previousLeft = -Infinity;
  for (const node of layout?.nodes ?? []) {
    const amount = money(node.valueMinor);
    const percent = share(node.shareBps);
    let middle = (node.y0 + node.y1) / 2;
    if (node.column === firstColumn) {
      middle = Math.max(middle, previousLeft + 32);
      previousLeft = middle;
    }
    texts.set(node.id, {
      value: shown === 'amount' ? `${amount}  ${percent}` : percent,
      label: `${name(node.id)}, ${shown === 'amount' ? `${amount} ` : ''}${percent}`,
      middle,
    });
  }
  /** Dimmed when a group is focused and the node or band is not on its path. */
  const dimmed = (id: string) =>
    wide && focus !== null && id !== focus && id !== 'total' && !id.startsWith('source:') && parentOf.get(id) !== focus;

  // A focused group missing from newer data reads as no focus.
  const focusNode = focus === null ? undefined : nodeById.get(focus);
  const updated = `${formatDate(toLocalDate(loadedAt, timeZone), locale, 'date')}, ${formatTime(loadedAt, timeZone, locale)}`;
  const filename = `${m.overview_flow_title().toLowerCase().replace(/\s+/g, '-')}-${dashboard.ranges.current.from}-${dashboard.ranges.current.to}.png`;

  const exportPng = async (action: 'download' | 'copy') => {
    // The export items are enabled only while the diagram is drawn.
    const svg = svgRef.current as SVGSVGElement;
    try {
      const blob = await flowPng(svg, getComputedStyle(svg).getPropertyValue('--card'));
      if (action === 'download') {
        download(blob, filename);
      } else {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast({ title: m.overview_flow_copied(), tone: 'success' });
      }
    } catch {
      toast({ title: m.overview_flow_export_failed(), tone: 'error' });
    }
  };

  /** A group opens (focuses) first; a focused group, a source, or a category opens its transactions. */
  const activate = (node: LaidNode) => {
    if (node.column === 2 && node.id !== focus) setFocus(node.id);
    else openNode(node.id);
  };
  const onKey = (event: KeyboardEvent, node: LaidNode) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activate(node);
  };

  return (
    <section
      aria-labelledby="overview-flow"
      className="relative flex flex-col overflow-hidden rounded-[12px] border border-border bg-card"
    >
      <div className="flex flex-wrap items-start gap-3 border-b border-border px-6 py-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id="overview-flow" className="flex items-center gap-2 text-[15px] font-semibold text-fg">
            {m.overview_flow_title()}
            <span className="rounded-[5px] border border-border px-1.5 font-mono text-[11px] font-normal text-subtle">
              {shortRange(dashboard.ranges.current, locale, dashboard.today)}
            </span>
          </h2>
          <p className="text-[12.5px] text-muted-fg">
            {focusNode === undefined ? (
              flow.incomeMinor > 0n ? (
                <RichMessage
                  message={m.overview_flow_subtitle}
                  slots={{
                    amount: <Money minor={flow.incomeMinor} currency={currency} context="amount" locale={locale} />,
                    groups: (
                      <>
                        {new Intl.ListFormat(locale, { type: 'conjunction' }).format(
                          groups.map((group) => name(group.id)),
                        )}
                      </>
                    ),
                  }}
                />
              ) : (
                <RichMessage
                  message={m.overview_flow_subtitle_no_income}
                  slots={{
                    amount: <Money minor={flow.expenseMinor} currency={currency} context="amount" locale={locale} />,
                  }}
                />
              )
            ) : (
              <RichMessage
                message={m.overview_flow_focus}
                slots={{
                  group: <>{name(focusNode.id)}</>,
                  amount: <Money minor={focusNode.valueMinor} currency={currency} context="amount" locale={locale} />,
                  share: <>{share(focusNode.shareBps)}</>,
                }}
              />
            )}
          </p>
        </div>
        <div role="group" aria-label={m.overview_flow_filter()} className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-pressed={focus === null}
            className={CHIP}
            onClick={() => {
              setFocus(null);
            }}
          >
            {m.overview_flow_all()}
          </button>
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              aria-pressed={focus === group.id}
              className={CHIP}
              onClick={() => {
                setFocus(focus === group.id ? null : group.id);
              }}
            >
              <span aria-hidden="true" className={`size-1.5 rounded-full ${toneOf(group.id).dot}`} />
              {name(group.id)}
              {focus === group.id ? <X aria-hidden="true" className="size-3" /> : null}
            </button>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={m.overview_flow_menu()}
              className="inline-flex size-7 items-center justify-center rounded-[7px] border border-border text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Ellipsis aria-hidden="true" className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[248px]">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  icon={ListFilter}
                  onSelect={() => {
                    openNode(focus ?? 'total');
                  }}
                >
                  {m.overview_flow_open_transactions()}
                </DropdownMenuItem>
                <DropdownMenuItem
                  icon={ImageDown}
                  disabled={layout === null}
                  onSelect={() => {
                    void exportPng('download');
                  }}
                >
                  {m.overview_flow_download()}
                </DropdownMenuItem>
                <DropdownMenuItem
                  icon={Copy}
                  disabled={layout === null}
                  onSelect={() => {
                    void exportPng('copy');
                  }}
                >
                  {m.overview_flow_copy()}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>{m.overview_flow_values()}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={shown}
                  onValueChange={(value) => {
                    // The radio items below are `amount` and `percent`.
                    setShown(value as Shown);
                  }}
                >
                  <DropdownMenuRadioItem value="amount">{m.overview_flow_values_amount()}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="percent">{m.overview_flow_values_percent()}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuCheckboxItem
                  indicator="switch"
                  checked={showSmallSources}
                  onCheckedChange={setShowSmallSources}
                  onSelect={(event) => {
                    event.preventDefault();
                  }}
                >
                  {m.overview_flow_small_sources()}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  indicator="switch"
                  checked={countTransfers}
                  onCheckedChange={setCountTransfers}
                  onSelect={(event) => {
                    event.preventDefault();
                  }}
                >
                  {m.overview_flow_count_transfers()}
                </DropdownMenuCheckboxItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div ref={measure} className="relative px-0 py-4">
        {graph.nodes.length === 0 ? (
          <p className="flex h-[200px] items-center justify-center text-[13px] text-subtle">
            {m.overview_flow_empty()}
          </p>
        ) : layout === null ? (
          <div aria-hidden="true" className="h-[280px]" />
        ) : (
          <svg
            ref={svgRef}
            role="group"
            aria-label={m.overview_flow_chart()}
            width={layout.width}
            height={height}
            viewBox={`0 0 ${String(layout.width)} ${String(height)}`}
            className="block font-sans"
          >
            <g aria-hidden="true">
              {layout.links.map((link) => {
                const target = link.to;
                const tone = toneOf(link.to === 'total' ? link.from : target);
                const active = hover?.link === link || hover?.node.id === target;
                return (
                  <path
                    key={`${link.from}>${link.to}`}
                    d={link.path}
                    fill="none"
                    strokeWidth={link.width}
                    strokeOpacity={dimmed(target) ? 0.05 : active ? 0.55 : link.to === 'total' ? 0.3 : 0.22}
                    className={`${link.to === 'total' ? NEUTRAL.stroke : tone.stroke} cursor-pointer`}
                    onMouseEnter={() => {
                      setHover({ node: layout.nodes.find((node) => node.id === target) as LaidNode, link });
                    }}
                    onMouseLeave={() => {
                      setHover(null);
                    }}
                    onClick={() => {
                      activate(layout.nodes.find((node) => node.id === target) as LaidNode);
                    }}
                  />
                );
              })}
            </g>
            {layout.nodes.map((node) => {
              const left = node.column === firstColumn;
              const tone = node.id === 'total' ? { fill: 'fill-fg' } : toneOf(node.id);
              // Sources keep two lines (their labels sit left, where a long one would be cut); small nodes elsewhere
              // get one line.
              const inline = !left && (node.column === 3 || node.y1 - node.y0 < 26);
              const { value, label, middle } = texts.get(node.id) as { value: string; label: string; middle: number };
              const interactive = node.column !== 1;
              return (
                <g
                  key={node.id}
                  opacity={dimmed(node.id) ? 0.3 : 1}
                  {...(interactive
                    ? {
                        tabIndex: 0,
                        role: 'button',
                        'aria-label': label,
                        onKeyDown: (event: KeyboardEvent) => {
                          onKey(event, node);
                        },
                        onFocus: () => {
                          setHover({ node, link: null });
                        },
                        onBlur: () => {
                          setHover(null);
                        },
                        onClick: () => {
                          activate(node);
                        },
                        onMouseEnter: () => {
                          setHover({ node, link: null });
                        },
                        onMouseLeave: () => {
                          setHover(null);
                        },
                      }
                    : { 'aria-hidden': true })}
                  className={`${interactive ? 'cursor-pointer' : ''} outline-none focus-visible:[&>rect:first-child]:stroke-ring focus-visible:[&>rect:first-child]:stroke-2`}
                >
                  <rect
                    x={node.x0}
                    y={node.y0}
                    width={node.x1 - node.x0}
                    height={Math.max(node.y1 - node.y0, 2)}
                    rx={2}
                    className={tone.fill}
                  />
                  <text
                    x={left ? node.x0 - 10 : node.x1 + 10}
                    y={inline ? middle : middle - 8}
                    textAnchor={left ? 'end' : 'start'}
                    dominantBaseline="middle"
                    className="fill-fg text-[12.5px] font-medium"
                  >
                    {name(node.id)}
                    {inline ? (
                      <tspan dx={8} className="fill-subtle font-mono text-[11.5px] font-normal">
                        {value}
                      </tspan>
                    ) : null}
                  </text>
                  {inline ? null : (
                    <text
                      x={left ? node.x0 - 10 : node.x1 + 10}
                      y={middle + 9}
                      textAnchor={left ? 'end' : 'start'}
                      dominantBaseline="middle"
                      className="fill-subtle font-mono text-[11.5px]"
                    >
                      {value}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {hover === null || layout === null ? null : (
          <FlowTooltip
            hover={hover}
            width={layout.width}
            name={name}
            parent={parentOf.get(hover.node.id) ?? null}
            nodeById={nodeById}
            dashboard={dashboard}
            money={money}
            share={share}
            locale={locale}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-6 py-3 text-[11.5px] text-subtle">
        <span>
          {shown === 'amount' ? m.overview_flow_unit_amount() : m.overview_flow_unit_percent()} ·{' '}
          {countTransfers ? m.overview_flow_transfers_counted() : m.overview_flow_transfers_not_counted()}
        </span>
        <span className="ml-auto">{m.overview_flow_updated({ at: updated })}</span>
      </div>
    </section>
  );
}

interface FlowTooltipProps {
  readonly hover: Hover;
  readonly width: number;
  readonly name: (id: string) => string;
  readonly parent: string | null;
  readonly nodeById: ReadonlyMap<string, MoneyFlowNode>;
  readonly dashboard: Dashboard;
  /** Formats with the privacy mode; `table` without the symbol ("3.500.000"). */
  readonly money: (minor: bigint, context?: 'amount' | 'table') => string;
  readonly share: (bps: number) => string;
  readonly locale: Locale;
}

/**
 * The hover / focus card (design `fqzal`): "Kebutuhan → Makan & Dapur", the amount, its share of the group and of
 * the income, the transactions with their average, the budget, and "Klik untuk lihat N transaksi". Positioned
 * through the CSSOM (no `style` attribute) next to the node.
 */
function FlowTooltip({ hover, width, name, parent, nodeById, dashboard, money, share, locale }: FlowTooltipProps) {
  const { node } = hover;
  const categoryId = node.id.startsWith('category:') ? (node.id.split(':')[1] as string) : null;
  const spending =
    categoryId === null
      ? undefined
      : dashboard.categories.find((row) => (row.categoryId ?? 'uncategorized') === categoryId);
  const budget = dashboard.budget?.lines.find((line) => line.categoryId === categoryId);
  const parentNode = parent === null ? undefined : nodeById.get(parent);
  const place = (element: HTMLDivElement | null) => {
    if (element === null) return;
    const right = node.x1 + 16 + 260 <= width;
    element.style.left = `${String(right ? node.x1 + 16 : Math.max(node.x0 - 276, 8))}px`;
    element.style.top = `${String(Math.max((node.y0 + node.y1) / 2 - 40, 0) + 16)}px`;
  };
  const rows: [string, string][] = [];
  if (parentNode !== undefined && parentNode.id.startsWith('group:') && parentNode.valueMinor > 0n) {
    rows.push([
      m.overview_flow_tip_group_share({ group: name(parentNode.id) }),
      share(Math.round((Number(node.valueMinor) / Number(parentNode.valueMinor)) * 10_000)),
    ]);
  }
  rows.push([m.overview_flow_tip_income_share(), share(node.shareBps)]);
  if (spending !== undefined) {
    rows.push([
      m.overview_flow_tip_transactions(),
      m.overview_flow_tip_count({
        count: spending.count,
        average: money(spending.totalMinor / BigInt(Math.max(spending.count, 1))),
      }),
    ]);
  }
  if (budget !== undefined) {
    rows.push([m.overview_flow_tip_budget(), `${money(budget.spentMinor)} / ${money(budget.limitMinor, 'table')}`]);
  }
  return (
    <div
      ref={place}
      role="tooltip"
      className="pointer-events-none absolute z-10 flex w-[260px] flex-col rounded-[10px] border border-border-strong bg-popover text-[12px] shadow-lg"
    >
      <div className="flex flex-col gap-1 border-b border-border px-3 py-2.5">
        <span className="text-[11.5px] text-muted-fg">
          {parentNode === undefined || !parentNode.id.startsWith('group:')
            ? name(node.id)
            : `${name(parentNode.id)} → ${name(node.id)}`}
        </span>
        <Money
          minor={node.valueMinor}
          currency={dashboard.baseCurrency}
          context="amount"
          locale={locale}
          className="text-[15px] font-semibold text-fg"
        />
      </div>
      <dl className="flex flex-col gap-1.5 px-3 py-2.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <dt className="text-muted-fg">{label}</dt>
            <dd className="font-mono text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      {spending === undefined ? null : (
        <p className="border-t border-border px-3 py-2 text-[11.5px] text-subtle">
          {m.overview_flow_tip_open({ count: spending.count })}
        </p>
      )}
    </div>
  );
}
