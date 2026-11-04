// SPDX-License-Identifier: AGPL-3.0-only
import type { ReviewItemView } from '@wf/db/review';
import type { Locale } from '@wf/domain/money';
import { m } from '@wf/i18n/messages';
import { Checkbox } from '@wf/ui/checkbox';
import { formatDate, formatTime, toLocalDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { usePrivacy } from '@wf/ui/privacy';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { Button, Select, TextInput } from '../form.tsx';
import type { ReviewLookup } from './review-cards.tsx';

const SOURCES = {
  gmail: m.review_source_gmail,
  assistant: m.review_source_assistant,
  receipt: m.review_source_receipt,
  schedule: m.review_source_schedule,
  period_close: m.review_source_period_close,
  system: m.review_source_system,
};

export function reviewSourceLabel(item: ReviewItemView): string {
  return item.reason === 'import_row' ? m.import_title() : SOURCES[item.source]();
}

/** A summary of the proposal, without recording it or fetching transaction details. */
export function reviewRow(item: ReviewItemView, lookup: ReviewLookup) {
  const { payload } = item;
  let title = item.label || m.review_untitled();
  let amount: bigint | null;
  let accountId: string | null = null;
  let toAccountId: string | null = null;
  let categoryId: string | null = null;
  let when: Date | null = item.createdAt;
  let tags: readonly string[] = [];
  let note = '';
  let ready = true;
  if (payload.kind === 'gmail') {
    const e = payload.extraction;
    title = e.merchant || item.label || payload.subject;
    amount = e.amountMinor;
    accountId = e.accountId;
    categoryId = e.categoryId;
    when = e.occurredAt;
    tags = payload.tags;
    ready = !!e.merchant?.trim() && amount !== null && amount > 0n && e.occurredAt !== null;
    const account = lookup.accounts.find((entry) => entry.id === accountId);
    ready &&= account !== undefined && (e.currency === null || e.currency === account.currency);
  } else if (payload.kind === 'transaction') {
    const d = payload.draft;
    title = d.description || item.label || m.review_untitled();
    when = d.occurredAt;
    note = d.note ?? '';
    tags = d.tags ?? [];
    if (d.type === 'transfer') {
      accountId = d.fromAccountId;
      toAccountId = d.toAccountId;
      amount = d.sentMinor;
      ready = d.sentMinor > 0n && d.receivedMinor > 0n && accountId !== toAccountId;
    } else {
      accountId = d.accountId;
      categoryId = d.categoryId;
      amount = d.amountMinor;
      ready = amount > 0n;
    }
  } else if (payload.kind === 'category') {
    title = item.subject?.description || title;
    accountId = item.subject?.accountId ?? null;
    when = item.subject?.occurredAt ?? null;
    amount = item.subject?.amountMinor ?? null;
    ready = false;
  } else if (payload.kind === 'leftover') {
    title = item.label === null ? m.review_leftover_title_plain() : m.review_leftover_title({ goal: item.label });
    accountId = payload.fromAccountId;
    toAccountId = payload.toAccountId;
    amount = payload.amountMinor;
    ready = accountId !== null && toAccountId !== null && accountId !== toAccountId;
  } else {
    categoryId = payload.categoryId;
    amount = payload.deltaMinor;
    const category = lookup.categories.find((entry) => entry.id === categoryId);
    const name = category === undefined ? m.review_untitled() : categoryName(category);
    title =
      amount < 0n ? m.review_rollover_over_title({ category: name }) : m.review_rollover_title({ category: name });
  }
  const account = lookup.accounts.find((entry) => entry.id === accountId);
  const destination = lookup.accounts.find((entry) => entry.id === toAccountId);
  const category = lookup.categories.find((entry) => entry.id === categoryId);
  if (payload.kind === 'gmail' || payload.kind === 'transaction') {
    ready &&= account?.status === 'active' && Number.isFinite(when?.getTime());
    if (payload.kind === 'transaction' && payload.draft.type === 'transfer') ready &&= destination?.status === 'active';
    else {
      const kind = payload.kind === 'gmail' ? 'expense' : payload.draft.type;
      ready &&= category !== undefined && category.archivedAt === null && category.kind === kind;
    }
  }
  return {
    item,
    title,
    amount,
    when,
    tags,
    note,
    ready,
    source: reviewSourceLabel(item),
    account:
      toAccountId === null
        ? (account?.displayName ?? '—')
        : `${account?.displayName ?? '—'} → ${destination?.displayName ?? '—'}`,
    category: category === undefined ? '—' : categoryName(category),
    currency:
      item.subject?.currency ??
      account?.currency ??
      (payload.kind === 'gmail' ? payload.extraction.currency : null) ??
      lookup.baseCurrency,
  };
}

type SortKey = 'when' | 'title' | 'amount';
const CELL = 'px-4 py-3 align-middle';

export function ReviewTable({
  items,
  lookup,
  locale,
  timeZone,
  busy,
  selected,
  onSelect,
  onOpen,
  onIgnore,
  actions,
}: {
  items: readonly ReviewItemView[];
  lookup: ReviewLookup;
  locale: Locale;
  timeZone: string;
  busy: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  onSelect: (ids: readonly string[], checked: boolean) => void;
  onOpen: (id: string) => void;
  onIgnore: (ids: readonly string[]) => void;
  actions?: ReactNode;
}) {
  const { hidden, hiddenLabel } = usePrivacy();
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'when', descending: true });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const search = hidden ? '' : query.trim().toLocaleLowerCase(locale);
  const rows = items
    .map((item) => reviewRow(item, lookup))
    .filter(
      (row) =>
        (source === 'all' || row.item.source === source) &&
        (search === '' ||
          [row.title, row.account, row.category, row.source, row.note, ...row.tags.map((tag) => `#${tag}`)]
            .join(' ')
            .toLocaleLowerCase(locale)
            .includes(search)),
    )
    .sort((a, b) => {
      const order =
        sort.key === 'when'
          ? (a.when?.getTime() ?? 0) - (b.when?.getTime() ?? 0)
          : sort.key === 'title'
            ? a.title.localeCompare(b.title, locale)
            : a.currency.localeCompare(b.currency) ||
              ((a.amount ?? 0n) < (b.amount ?? 0n) ? -1 : (a.amount ?? 0n) > (b.amount ?? 0n) ? 1 : 0);
      return (sort.descending ? -order : order) || a.item.id.localeCompare(b.item.id);
    });
  const lastPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const selectable = visible.filter((row) => !busy.has(row.item.id)).map((row) => row.item.id);
  const checked = selectable.length > 0 && selectable.every((id) => selected.has(id));
  const selectedIds = items.filter((item) => selected.has(item.id)).map((item) => item.id);
  const toggleSort = (key: SortKey) => {
    setSort({ key, descending: sort.key === key ? !sort.descending : key !== 'title' });
    setPage(0);
  };
  const heading = (key: SortKey, label: string) => (
    <th
      scope="col"
      className={CELL}
      aria-sort={sort.key !== key ? 'none' : sort.descending ? 'descending' : 'ascending'}
    >
      <button
        type="button"
        onClick={() => {
          toggleSort(key);
        }}
        className="inline-flex items-center gap-1.5 rounded text-left focus-visible:outline-2 focus-visible:outline-ring"
      >
        {label}
        {sort.key !== key ? null : sort.descending ? (
          <ArrowDown aria-hidden="true" className="size-3" />
        ) : (
          <ArrowUp aria-hidden="true" className="size-3" />
        )}
      </button>
    </th>
  );
  return (
    <section
      aria-label={m.review_title()}
      className="min-w-0 overflow-hidden rounded-[12px] border border-border bg-card"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <div className="relative min-w-[200px] flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute top-2.5 left-3 size-3.5 text-muted-fg" />
          <TextInput
            size="sm"
            aria-label={m.review_table_search()}
            placeholder={m.transactions_search_placeholder()}
            disabled={hidden}
            value={hidden ? '' : query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            className="pl-9"
          />
        </div>
        <Select
          size="sm"
          aria-label={m.review_table_source()}
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            setPage(0);
          }}
          className="w-auto min-w-[150px]"
        >
          <option value="all">{m.review_table_all_sources()}</option>
          {Object.entries(SOURCES)
            .filter(([key]) => items.some((item) => item.source === key))
            .map(([key, label]) => (
              <option key={key} value={key}>
                {label()}
              </option>
            ))}
        </Select>
        {source === 'all' || source === 'schedule' ? actions : null}
      </div>
      {selectedIds.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-blue-tint-1 px-4 py-2">
          <span role="status" className="text-[12.5px] text-fg">
            {m.review_table_selected({ count: selectedIds.length })}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={selectedIds.some((id) => busy.has(id))}
            onClick={() => {
              onIgnore(selectedIds);
            }}
          >
            {m.review_ignore()}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onSelect(selectedIds, false);
            }}
          >
            {m.review_table_clear_selection()}
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1060px] border-collapse text-left text-[13px]">
          <caption className="sr-only">{m.review_description({ count: items.length })}</caption>
          <thead className="border-b border-border bg-surface-2 text-[12px] text-muted-fg">
            <tr>
              <th scope="col" className="w-12 px-4 py-3">
                <Checkbox
                  label={<span className="sr-only">{m.review_table_select_page()}</span>}
                  checked={checked}
                  disabled={selectable.length === 0}
                  onChange={(event) => {
                    onSelect(selectable, event.target.checked);
                  }}
                />
              </th>
              {heading('when', m.transactions_columns_date())}
              {heading('title', m.transactions_columns_description())}
              <th scope="col" className={CELL}>
                {m.transactions_columns_source()}
              </th>
              <th scope="col" className={CELL}>
                {m.transactions_columns_account()}
              </th>
              <th scope="col" className={CELL}>
                {m.transactions_columns_category()}
              </th>
              {heading('amount', m.transactions_columns_amount())}
              <th scope="col" className={CELL}>
                {m.review_table_status()}
              </th>
              <th scope="col" className={CELL}>
                <span className="sr-only">{m.review_table_actions()}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((row) => (
              <tr
                key={row.item.id}
                data-review-item={row.item.id}
                aria-busy={busy.has(row.item.id)}
                className="hover:bg-muted has-checked:bg-blue-tint-1"
              >
                <td className={CELL}>
                  <Checkbox
                    label={
                      <span className="sr-only">
                        {m.transactions_table_select_row({ name: hidden ? hiddenLabel : row.title })}
                      </span>
                    }
                    checked={selected.has(row.item.id)}
                    disabled={busy.has(row.item.id)}
                    onChange={(event) => {
                      onSelect([row.item.id], event.target.checked);
                    }}
                  />
                </td>
                <td className={`${CELL} whitespace-nowrap`}>
                  <span className="block text-fg">
                    {row.when === null ? '—' : formatDate(toLocalDate(row.when, timeZone), locale, 'day')}
                  </span>
                  <span className="font-mono text-[11.5px] text-subtle">
                    {row.when === null ? null : formatTime(row.when, timeZone, locale)}
                  </span>
                </td>
                <td className={`${CELL} max-w-[280px] min-w-[200px]`}>
                  <button
                    type="button"
                    disabled={busy.has(row.item.id)}
                    onClick={() => {
                      onOpen(row.item.id);
                    }}
                    className="block max-w-full truncate rounded text-left font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {hidden ? hiddenLabel : row.title}
                  </button>
                  {hidden || row.tags.length === 0 ? null : (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {row.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded border border-border bg-surface-2 px-1 font-mono text-[10.5px] text-muted-fg"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className={CELL}>
                  <span className="whitespace-nowrap rounded-md border border-border px-2 py-1 text-[11.5px] text-muted-fg">
                    {row.source}
                  </span>
                  {row.item.aiConfidence === null ? null : (
                    <span
                      title={m.review_ai_confidence({ percent: row.item.aiConfidence })}
                      className={`mt-1 block font-mono text-[11px] ${row.item.aiConfidence < 90 ? 'text-amber-fg' : 'text-subtle'}`}
                    >
                      {m.gmail_confidence({ percent: row.item.aiConfidence })}
                    </span>
                  )}
                </td>
                <td className={`${CELL} max-w-[180px] truncate text-muted-fg`}>{row.account}</td>
                <td className={`${CELL} text-muted-fg`}>{row.category}</td>
                <td className={`${CELL} text-right whitespace-nowrap font-medium`}>
                  {row.amount === null ? (
                    '—'
                  ) : (
                    <Money minor={row.amount} currency={row.currency} context="amount" locale={locale} />
                  )}
                </td>
                <td className={CELL}>
                  <span
                    className={`whitespace-nowrap rounded-full px-2 py-1 text-[11px] ${row.ready ? 'bg-blue-tint-1 text-blue-fg' : 'bg-amber-tint-1 text-amber-fg'}`}
                  >
                    {row.ready ? m.review_table_ready() : m.review_table_incomplete()}
                  </span>
                </td>
                <td className={CELL}>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy.has(row.item.id)}
                    onClick={() => {
                      onOpen(row.item.id);
                    }}
                  >
                    {m.review_table_open()}
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length > 0 ? null : (
              <tr>
                <td colSpan={9} className="px-4 py-14 text-center text-[13px] text-muted-fg">
                  {m.review_table_no_results()}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-[12px] text-muted-fg">
        <span role="status">
          {m.review_table_range({
            from: rows.length === 0 ? 0 : currentPage * pageSize + 1,
            to: Math.min((currentPage + 1) * pageSize, rows.length),
            count: rows.length,
          })}
        </span>
        <div className="flex items-center gap-2">
          <Select
            size="sm"
            aria-label={m.review_table_page_size()}
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(0);
            }}
            className="w-auto"
          >
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {m.review_table_per_page({ count: size })}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="secondary"
            aria-label={m.review_table_previous()}
            disabled={currentPage === 0}
            onClick={() => {
              setPage(currentPage - 1);
            }}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            aria-label={m.review_table_next()}
            disabled={currentPage >= lastPage}
            onClick={() => {
              setPage(currentPage + 1);
            }}
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </footer>
    </section>
  );
}
