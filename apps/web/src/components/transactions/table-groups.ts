// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Transactions table's layout (FR-L2): which grouping a search shows, the loaded rows in display order with their
 * group headers (By day `t7l0Cj`, By category `ztMHB`, Flat `r8ep9`), shift-click ranges, and the search highlight
 * (`p22to9`). Group totals come from the whole query (`view.days`, `view.categories`, `view.summary`), not just the
 * rows loaded so far.
 */
import type { CategoryGroup, DayGroup, TransactionRow, TransactionSummary } from '@wf/db/transaction-query';
import type { LocalDate } from '@wf/domain/period';
import type { TransactionType } from '@wf/domain/transactions';
import type { TransactionsSearch, TransactionView } from '../../lib/transactions-search.ts';

/** The grouping shown: `?view=` (By day by default), except that an amount sort cannot be grouped by day. */
export function tableModeOf(search: Pick<TransactionsSearch, 'view' | 'sort'>): TransactionView {
  const view = search.view ?? 'day';
  return view === 'day' && search.sort?.startsWith('amount') === true ? 'flat' : view;
}

/** By category: expenses and incomes per category (`none` = uncategorized), transfers and other types per type. */
export function groupKeyOf(row: Pick<TransactionRow, 'type' | 'categoryId'>): string {
  return row.type === 'expense' || row.type === 'income' ? `${row.type}:${row.categoryId ?? 'none'}` : row.type;
}

export interface DayHeader {
  readonly kind: 'day';
  readonly key: string;
  readonly date: LocalDate;
  readonly count: number;
  /** In − Out of the day, in the base currency. */
  readonly netMinor: bigint;
}

export interface CategoryHeader {
  readonly kind: 'category';
  readonly key: string;
  /** `expense`/`income` groups are categories; any other type is its own group. */
  readonly type: TransactionType;
  readonly categoryId: string | null;
  readonly count: number;
  /** Signed like the rows (expenses negative), in the base currency; transfers: the amount sent. */
  readonly totalMinor: bigint;
  /** Share within its kind in basis points; `null` for groups outside the category totals (transfers). */
  readonly shareBps: number | null;
}

export type TableHeader = DayHeader | CategoryHeader;
export type TableItem = TableHeader | { readonly kind: 'row'; readonly key: string; readonly index: number };

export interface TableLayout {
  /** The loaded rows in display order (keyboard moves and shift ranges follow it). */
  readonly rows: readonly TransactionRow[];
  /** What the list renders: headers and rows (`index` into {@link rows}). */
  readonly items: readonly TableItem[];
}

export interface GroupTotals {
  readonly days: readonly DayGroup[];
  readonly categories: readonly CategoryGroup[];
  readonly summary: Pick<TransactionSummary, 'transferMinor' | 'transferCount'>;
}

function rowItems(rows: readonly TransactionRow[], from = 0): TableItem[] {
  return rows.map((row, offset) => ({ kind: 'row', key: row.id, index: from + offset }));
}

function byDay(rows: readonly TransactionRow[], days: readonly DayGroup[]): TableLayout {
  const totals = new Map(days.map((day) => [day.date, day]));
  const items: TableItem[] = [];
  rows.forEach((row, index) => {
    if (rows[index - 1]?.localDate !== row.localDate) {
      const day = totals.get(row.localDate);
      items.push({
        kind: 'day',
        key: `day:${row.localDate}`,
        date: row.localDate,
        count: day?.count ?? rows.filter((other) => other.localDate === row.localDate).length,
        netMinor: day === undefined ? 0n : day.inMinor - day.outMinor,
      });
    }
    items.push({ kind: 'row', key: row.id, index });
  });
  return { rows, items };
}

function categoryHeader(key: string, members: readonly TransactionRow[], totals: GroupTotals): CategoryHeader {
  const [first] = members as [TransactionRow, ...TransactionRow[]];
  const common = { kind: 'category', key, type: first.type, categoryId: first.categoryId } as const;
  if (first.type === 'transfer') {
    return {
      ...common,
      count: totals.summary.transferCount,
      totalMinor: totals.summary.transferMinor,
      shareBps: null,
    };
  }
  const group = totals.categories.find((candidate) => `${candidate.kind}:${candidate.categoryId ?? 'none'}` === key);
  if (group === undefined) {
    return {
      ...common,
      count: members.length,
      totalMinor: members.reduce((sum, row) => sum + row.amountBaseMinor, 0n),
      shareBps: null,
    };
  }
  return {
    ...common,
    count: group.count,
    totalMinor: group.kind === 'expense' ? -group.totalMinor : group.totalMinor,
    shareBps: group.shareBps,
  };
}

function byCategory(rows: readonly TransactionRow[], totals: GroupTotals): TableLayout {
  const groups = new Map<string, TransactionRow[]>();
  for (const row of rows) {
    const key = groupKeyOf(row);
    const members = groups.get(key);
    if (members === undefined) groups.set(key, [row]);
    else members.push(row);
  }
  const rank = (key: string) => {
    const at = totals.categories.findIndex((group) => `${group.kind}:${group.categoryId ?? 'none'}` === key);
    return at === -1 ? totals.categories.length : at;
  };
  const ordered: TransactionRow[] = [];
  const items: TableItem[] = [];
  for (const [key, members] of [...groups].sort(([a], [b]) => rank(a) - rank(b))) {
    items.push(categoryHeader(key, members, totals), ...rowItems(members, ordered.length));
    ordered.push(...members);
  }
  return { rows: ordered, items };
}

export function tableLayout(rows: readonly TransactionRow[], mode: TransactionView, totals: GroupTotals): TableLayout {
  if (mode === 'day') return byDay(rows, totals.days);
  if (mode === 'category') return byCategory(rows, totals);
  return { rows, items: rowItems(rows) };
}

/** Shift-click / Shift+↑↓: `selected` plus every row from `anchor` to `to` (inclusive, either direction). */
export function selectRange(
  selected: ReadonlySet<string>,
  rows: readonly Pick<TransactionRow, 'id'>[],
  anchor: number,
  to: number,
): Set<string> {
  const next = new Set(selected);
  for (const row of rows.slice(Math.min(anchor, to), Math.max(anchor, to) + 1)) next.add(row.id);
  return next;
}

/** The words of a search that match text (`#tag` tokens only filter by tag). */
export function searchWords(query: string | undefined): string[] {
  return (query ?? '')
    .split(/\s+/)
    .filter((word) => word !== '' && !word.startsWith('#'))
    .map((word) => word.toLowerCase());
}

export interface TextPart {
  readonly text: string;
  readonly match: boolean;
}

/** `text` split into the parts that match one of `words` (case-insensitive) and the rest. */
export function highlightParts(text: string, words: readonly string[]): TextPart[] {
  if (words.length === 0) return [{ text, match: false }];
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Splitting on a capturing group puts the matches at the odd indexes.
  return text
    .split(new RegExp(`(${escaped.join('|')})`, 'gi'))
    .map((part, index) => ({ text: part, match: index % 2 === 1 }))
    .filter((part) => part.text !== '');
}

/** Whether a tag chip matches the search: one of its words or `#tags` appears in the slug. */
export function tagMatches(slug: string, query: string | undefined): boolean {
  return (query ?? '')
    .split(/\s+/)
    .map((word) => word.replace(/^#/, '').toLowerCase())
    .some((word) => word !== '' && slug.includes(word));
}
