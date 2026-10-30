// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Transactions table (FR-L2/L3, design `t7l0Cj`, `r8ep9`, `ztMHB`, `p22to9`, `n71CLe`): a toolbar (search, view
 * Per hari/Per kategori/Rata, "Atur kolom"), the page's filter chips, a header row with select-all and the sortable
 * Waktu/Jumlah columns, then the rows — virtualized, grouped by day or category or flat, loading the next
 * page as the end scrolls into view — and the "Menampilkan N dari M transaksi" footer.
 *
 * Keyboard: rows are one tab stop (roving focus) — ↑/↓ move, Shift+↑/↓ and Space select, Enter or E opens the
 * detail, D duplicates, Backspace/Delete deletes (the selection when the row is part of it). Shift-click selects a
 * range; Escape clears the selection.
 */
import type { TransactionRow } from '@wf/db/transaction-query';
import { m } from '@wf/i18n/messages';
import { Checkbox } from '@wf/ui/checkbox';
import { DateLabel } from '@wf/ui/date-label';
import { formatDateRange } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { Tabs, TabsList, TabsTrigger } from '@wf/ui/tabs';
import { toast } from '@wf/ui/toast';
import { VirtualList } from '@wf/ui/virtual-list';
import { ArrowDown, ArrowUp, ReceiptText } from 'lucide-react';
import { useCallback, useEffect, useEffectEvent, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { colorProps } from '../../lib/colors.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import type { TablePrefs } from '../../lib/transaction-columns.ts';
import {
  listValues,
  queryOf,
  TRANSACTION_VIEWS,
  type TransactionsSearch,
  type TransactionView,
} from '../../lib/transactions-search.ts';
import { listTransactionRows, saveTablePrefs, type TransactionsView } from '../../server/fn/transactions.ts';
import { CategoryIcon } from '../category-icon.tsx';
import type { LedgerData } from '../ledger/use-transaction-form.ts';
import { usePreferences } from '../preferences.tsx';
import { rowLabel } from './action-row.ts';
import { BulkBar } from './bulk-bar.tsx';
import { COLUMN_LABELS, ColumnSettings } from './column-settings.tsx';
import { RowMenu } from './row-menu.tsx';
import { SortMenu } from './sort-menu.tsx';
import { selectRange, tableLayout, tableModeOf, type TableHeader } from './table-groups.ts';
import { TableSearch } from './table-search.tsx';
import { useTransactionActions } from './transaction-actions.tsx';
import { NoResults } from './transaction-filters.tsx';
import { categoryLabel, COLUMN_CLASS, DATED_TIME_CLASS, SignedMoney, TransactionRowView } from './transaction-row.tsx';

const VIEW_LABELS: Readonly<Record<TransactionView, () => string>> = {
  day: m.transactions_table_view_day,
  category: m.transactions_table_view_category,
  flat: m.transactions_table_view_flat,
};

/** Estimated heights before rows are measured. */
const HEADER_HEIGHT = 37;
const ROW_HEIGHT = { comfortable: 56, compact: 40 } as const;
const LOAD_MORE_HEIGHT = 48;

export interface TransactionsTableProps {
  readonly view: TransactionsView;
  readonly search: TransactionsSearch;
  readonly ledger: LedgerData;
  readonly timeZone: string;
  /** The route is reloading the rows (a filter changed): `aria-busy` on the table region. */
  readonly busy: boolean;
  /** The transaction open in the detail (highlighted). */
  readonly selectedId?: string;
  readonly onOpen: (id: string) => void;
  readonly onSearchChange: (patch: Partial<TransactionsSearch>) => void;
  /** The filter chips (`<TransactionFilters>`), under the toolbar. */
  readonly filters: ReactNode;
}

interface Loaded {
  /** The first page these rows continue; a new one (filters, sort, a write) starts over. */
  readonly source: TransactionsView['page'];
  readonly rows: readonly TransactionRow[];
  readonly balances: Readonly<Record<string, bigint>> | null;
}

type LoadState = 'idle' | 'loading' | 'failed';

/** Asks for the next page while it is in view (again after each page arrives); "Coba lagi" after a failure. */
function LoadMore({ state, onLoad }: { readonly state: LoadState; readonly onLoad: () => void }) {
  const load = useEffectEvent(onLoad);
  useEffect(() => {
    if (state === 'idle') load();
  }, [state]);
  return (
    <div className="flex h-12 items-center justify-center gap-3 text-[12.5px] text-subtle">
      {state === 'failed' ? (
        <>
          <span role="alert">{m.transactions_table_load_failed()}</span>
          <button
            type="button"
            onClick={onLoad}
            className="rounded-[6px] px-2 py-1 text-fg underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {m.transactions_table_retry()}
          </button>
        </>
      ) : (
        <span role="status">{m.transactions_table_loading_more()}</span>
      )}
    </div>
  );
}

function GroupHeader({
  header,
  ledger,
  view,
}: {
  readonly header: TableHeader;
  readonly ledger: LedgerData;
  readonly view: TransactionsView;
}) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const count = <span className="text-[12px] text-subtle">{m.transactions_count({ count: header.count })}</span>;
  if (header.kind === 'day') {
    return (
      <div className="flex h-9 items-center gap-2.5 border-b border-border bg-surface-2 px-4 pl-[68px]">
        <DateLabel date={header.date} locale={locale} format="weekday" className="text-[13px] font-semibold text-fg" />
        {header.date === view.today ? (
          <span className="rounded-[4px] bg-blue-tint-2 px-1.5 py-px text-[11px] text-blue-fg">
            {m.transactions_table_today()}
          </span>
        ) : null}
        {count}
        <SignedMoney
          amountMinor={header.netMinor}
          currency={ledger.baseCurrency}
          locale={locale}
          className="ml-auto pr-10 text-[12px] text-muted-fg"
        />
      </div>
    );
  }
  const category = ledger.categories.find((candidate) => candidate.id === header.categoryId);
  const { label, color } = categoryLabel(header, ledger);
  return (
    <div className="flex h-9 items-center gap-2.5 border-b border-border bg-surface-2 px-4 pl-[68px]">
      <CategoryIcon
        icon={category?.icon ?? (header.type === 'transfer' ? 'arrow-left-right' : 'shapes')}
        color={color}
        size="sm"
      />
      <span className="text-[13px] font-semibold text-fg">{label}</span>
      {count}
      <span className="ml-auto flex items-center gap-2.5 pr-10">
        {header.shareBps === null ? null : (
          <>
            <progress
              {...colorProps(color)}
              value={header.shareBps}
              max={10_000}
              aria-hidden="true"
              className="h-1 w-[84px] appearance-none overflow-hidden rounded-full [&::-moz-progress-bar]:bg-[var(--wf-color,var(--subtle))] [&::-webkit-progress-bar]:bg-surface-3 [&::-webkit-progress-value]:bg-[var(--wf-color,var(--subtle))]"
            />
            <Percent value={header.shareBps / 10_000} locale={locale} className="text-[12px] text-subtle" />
          </>
        )}
        {header.type === 'transfer' ? (
          <Money
            minor={header.totalMinor}
            currency={ledger.baseCurrency}
            context="amount"
            locale={locale}
            className="text-[12px] text-muted-fg"
          />
        ) : (
          <SignedMoney
            amountMinor={header.totalMinor}
            currency={ledger.baseCurrency}
            locale={locale}
            className="text-[12px] text-muted-fg"
          />
        )}
      </span>
    </div>
  );
}

export function TransactionsTable({
  view,
  search,
  ledger,
  timeZone,
  busy,
  selectedId,
  onOpen,
  onSearchChange,
  filters,
}: TransactionsTableProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const actions = useTransactionActions();
  const container = useRef<HTMLDivElement>(null);
  const searchFor = useCallback(
    (q: string | undefined) => {
      onSearchChange({ q });
    },
    [onSearchChange],
  );
  const [loaded, setLoaded] = useState<Loaded>({
    source: view.page,
    rows: view.page.rows,
    balances: view.page.balances,
  });
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState(0);
  const [focusIndex, setFocusIndex] = useState(0);
  /** The row whose ⋯ menu is open (its button, or a long-press on the row). */
  const [menuRowId, setMenuRowId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<TablePrefs>(view.prefs);
  if (loaded.source !== view.page) {
    setLoaded({ source: view.page, rows: view.page.rows, balances: view.page.balances });
    setLoadState('idle');
    setSelection(new Set());
    setAnchor(0);
    setFocusIndex(0);
  }

  const mode = tableModeOf(search);
  const layout = tableLayout(loaded.rows, mode, view);
  const { rows } = layout;
  const columns = prefs.columns.filter((column) => column.visible).map((column) => column.id);
  const hasMore = loaded.rows.length < view.page.total;
  const [balanceAccount] = listValues(search.account);
  const balanceCurrency = ledger.accounts.find((account) => account.id === balanceAccount)?.currency;
  const selectedRows = rows.filter((row) => selection.has(row.id));
  const tabStop = Math.min(focusIndex, rows.length - 1);

  const loadMore = () => {
    const { source } = loaded;
    const offset = loaded.rows.length;
    setLoadState('loading');
    void listTransactionRows({ data: { ...queryOf(search), offset } }).then(
      (result) => {
        if (!result.ok) {
          setLoadState('failed');
          return;
        }
        setLoaded((previous) =>
          previous.source !== source || previous.rows.length !== offset
            ? previous
            : {
                source,
                rows: [...previous.rows, ...result.value.rows],
                // Without a single account filter both are `null`, and the lookup misses either way.
                balances: { ...previous.balances, ...result.value.balances },
              },
        );
        setLoadState('idle');
      },
      () => {
        setLoadState('failed');
      },
    );
  };

  const changePrefs = (next: TablePrefs) => {
    const previous = prefs;
    setPrefs(next);
    const fail = (code: string) => {
      setPrefs(previous);
      toast({
        tone: 'error',
        title: m.transactions_table_save_failed(),
        description: ledgerErrorMessage(code, locale),
      });
    };
    void saveTablePrefs({ data: next }).then(
      (result) => {
        if (!result.ok) fail(result.code);
      },
      () => {
        fail('UNKNOWN');
      },
    );
  };

  const check = (index: number, range: boolean) => {
    const row = rows[index] as TransactionRow;
    if (range) {
      setSelection(selectRange(selection, rows, anchor, index));
    } else {
      const next = new Set(selection);
      if (!next.delete(row.id)) next.add(row.id);
      setSelection(next);
      setAnchor(index);
    }
  };

  const clearSelection = useCallback(() => {
    setSelection(new Set());
  }, []);

  const focusRow = (index: number) => {
    const row = rows[index] as TransactionRow;
    setFocusIndex(index);
    container.current?.querySelector<HTMLElement>(`[data-row-id="${row.id}"]`)?.focus();
  };

  const keyDown = (index: number, event: KeyboardEvent<HTMLDivElement>) => {
    // Keys pressed in the row's checkbox, its ⋯ menu, or a dialog opened from it are theirs.
    if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) return;
    const row = rows[index] as TransactionRow;
    const move = (to: number) => {
      event.preventDefault();
      if (to < 0 || to >= rows.length) return;
      if (event.shiftKey) setSelection(selectRange(selection, rows, index, to));
      focusRow(to);
    };
    switch (event.key) {
      case 'ArrowDown':
        move(index + 1);
        return;
      case 'ArrowUp':
        move(index - 1);
        return;
      case ' ':
        event.preventDefault();
        check(index, event.shiftKey);
        return;
      case 'Enter':
      case 'e':
      case 'E':
        event.preventDefault();
        onOpen(row.id);
        return;
      case 'd':
      case 'D':
        event.preventDefault();
        actions.duplicate(row.id);
        return;
      case 'Backspace':
      case 'Delete':
        event.preventDefault();
        actions.remove(selection.has(row.id) ? selectedRows : [row]);
        return;
    }
  };

  const items = layout.items;
  const renderItem = (position: number): ReactNode => {
    const item = items[position];
    if (item === undefined) return <LoadMore state={loadState} onLoad={loadMore} />;
    if (item.kind !== 'row') return <GroupHeader header={item} ledger={ledger} view={view} />;
    const row = rows[item.index] as TransactionRow;
    const label = rowLabel(row, ledger);
    const balance = loaded.balances?.[row.id];
    return (
      <TransactionRowView
        row={row}
        columns={columns}
        density={prefs.density}
        mode={mode}
        ledger={ledger}
        timeZone={timeZone}
        locale={locale}
        query={search.q}
        balance={
          balance === undefined || balanceCurrency === undefined ? null : { minor: balance, currency: balanceCurrency }
        }
        viewAccountId={listValues(search.account).length === 1 ? (balanceAccount ?? null) : null}
        label={label}
        open={row.id === selectedId}
        checked={selection.has(row.id)}
        tabStop={item.index === tabStop}
        onCheck={(range) => {
          check(item.index, range);
        }}
        onOpen={() => {
          onOpen(row.id);
        }}
        onKeyDown={(event) => {
          keyDown(item.index, event);
        }}
        onFocus={() => {
          setFocusIndex(item.index);
        }}
        menu={
          <RowMenu
            row={row}
            ledger={ledger}
            label={label}
            onOpen={onOpen}
            menuOpen={menuRowId === row.id}
            onMenuOpenChange={(next) => {
              setMenuRowId(next ? row.id : null);
            }}
          />
        }
        onLongPress={() => {
          setMenuRowId(row.id);
        }}
      />
    );
  };

  const sortArrow = (active: boolean) =>
    active ? (
      search.sort?.endsWith('asc') === true ? (
        <ArrowUp aria-hidden="true" className="size-3" />
      ) : (
        <ArrowDown aria-hidden="true" className="size-3" />
      )
    ) : null;
  const sortHeader = (label: string, active: boolean, className: string) => (
    <SortMenu search={search} onSearchChange={onSearchChange}>
      <button
        type="button"
        className={`flex items-center gap-1 rounded-[5px] hover:text-fg focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:text-fg ${className}`}
      >
        {label}
        {sortArrow(active)}
      </button>
    </SortMenu>
  );
  const byAmount = search.sort?.startsWith('amount') === true;
  const allChecked = rows.length > 0 && selectedRows.length === rows.length;
  const total = view.summary.inMinor - view.summary.outMinor;

  return (
    <section
      aria-label={m.transactions_table_label()}
      aria-busy={busy}
      className="@container flex flex-col rounded-[14px] border border-border bg-card"
    >
      <div className="flex flex-col gap-3 p-3.5 pb-2">
        <div className="flex items-center gap-2">
          <TableSearch value={search.q} hits={view.page.total} onChange={searchFor} />
          <Tabs
            value={mode}
            onValueChange={(next) => {
              if (next === 'day') onSearchChange({ view: undefined, ...(byAmount ? { sort: undefined } : {}) });
              else onSearchChange({ view: next as TransactionView });
            }}
          >
            <TabsList label={m.transactions_table_view_label()}>
              {TRANSACTION_VIEWS.map((value) => (
                <TabsTrigger key={value} value={value} panel={false} className="py-1 text-[12.5px]">
                  {VIEW_LABELS[value]()}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <ColumnSettings prefs={prefs} onChange={changePrefs} />
        </div>
        {filters}
        {search.q === undefined ? null : (
          <p className="flex items-center gap-1.5 text-[11.5px] text-subtle">
            {m.transactions_search_scope()}
            {[
              m.transactions_search_scope_description(),
              m.transactions_search_scope_note(),
              m.transactions_search_scope_tag(),
            ].map((scope) => (
              <span key={scope} className="rounded-[4px] border border-border bg-surface-3 px-1.5 text-text-secondary">
                {scope}
              </span>
            ))}
          </p>
        )}
      </div>
      {view.page.total === 0 ? (
        view.unfilteredCount > 0 ? (
          <NoResults view={view} search={search} onSearchChange={onSearchChange} />
        ) : (
          <p
            role="status"
            className="flex flex-col items-center gap-2 px-6 py-12 text-center text-[13px] text-muted-fg"
          >
            <ReceiptText aria-hidden="true" className="size-6 text-subtle" />
            {m.transactions_table_empty()}
          </p>
        )
      ) : (
        <>
          <div className="flex h-10 items-center gap-3 border-y border-border px-4 text-[12px] text-subtle">
            <span
              className="flex shrink-0"
              ref={(node) => {
                const input = node?.querySelector('input');
                if (input) input.indeterminate = selectedRows.length > 0 && !allChecked;
              }}
            >
              <Checkbox
                label={<span className="sr-only">{m.transactions_table_select_all()}</span>}
                checked={allChecked}
                onChange={() => {
                  setSelection(allChecked ? new Set() : new Set(rows.map((row) => row.id)));
                }}
                className="gap-0 [&>span:first-child]:mt-0"
              />
            </span>
            {columns.map((column) => {
              switch (column) {
                case 'tags':
                  return null;
                case 'time':
                  return (
                    <span key={column} className={mode === 'day' ? COLUMN_CLASS.time : DATED_TIME_CLASS}>
                      {sortHeader(mode === 'day' ? COLUMN_LABELS.time() : m.transactions_columns_date(), !byAmount, '')}
                    </span>
                  );
                case 'amount':
                  return (
                    <span key={column} className={`flex justify-end ${COLUMN_CLASS.amount}`}>
                      {sortHeader(COLUMN_LABELS.amount(), byAmount, '')}
                    </span>
                  );
                case 'balance':
                  return (
                    <span key={column} className={COLUMN_CLASS.balance}>
                      {COLUMN_LABELS.balance()}
                    </span>
                  );
                default:
                  return (
                    <span key={column} className={`truncate ${COLUMN_CLASS[column]}`}>
                      {column === 'attachment' ? null : COLUMN_LABELS[column]()}
                    </span>
                  );
              }
            })}
            <span className="w-8 shrink-0" />
          </div>
          <div ref={container}>
            <VirtualList
              label={m.transactions_table_label()}
              count={items.length + (hasMore ? 1 : 0)}
              estimateSize={(position) => {
                const item = items[position];
                if (item === undefined) return LOAD_MORE_HEIGHT;
                return item.kind === 'row' ? ROW_HEIGHT[prefs.density] : HEADER_HEIGHT;
              }}
              getItemKey={(position) => items[position]?.key ?? 'load-more'}
              renderItem={renderItem}
              className="max-h-[calc(100dvh-160px)] min-h-0"
            />
          </div>
          {mode === 'flat' ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-3 text-[12px] text-subtle">
              <span className="mr-auto text-[13px] font-semibold text-fg">
                {m.transactions_count({ count: view.page.total })}
              </span>
              <span>
                {m.transactions_table_total_in()}{' '}
                <SignedMoney amountMinor={view.summary.inMinor} currency={ledger.baseCurrency} locale={locale} />
              </span>
              <span>
                {m.transactions_table_total_out()}{' '}
                <SignedMoney
                  amountMinor={-view.summary.outMinor}
                  currency={ledger.baseCurrency}
                  locale={locale}
                  className="text-fg"
                />
              </span>
              <span>
                {m.transactions_table_total_transfer()}{' '}
                <Money
                  minor={view.summary.transferMinor}
                  currency={ledger.baseCurrency}
                  context="amount"
                  locale={locale}
                  className="text-muted-fg"
                />
              </span>
            </div>
          ) : null}
          {selectedRows.length > 0 ? (
            <BulkBar rows={selectedRows} baseCurrency={ledger.baseCurrency} onClear={clearSelection} />
          ) : null}
        </>
      )}
      <p className="border-t border-border px-4 py-3 text-[12px] text-subtle">
        {search.q === undefined ? (
          m.transactions_table_showing({ shown: loaded.rows.length, total: view.page.total })
        ) : (
          <>
            {m.transactions_search_summary({
              count: view.page.total,
              query: search.q,
              range: formatDateRange({ start: view.from, end: view.to }, locale, view.today),
            })}{' '}
            <SignedMoney amountMinor={total} currency={ledger.baseCurrency} locale={locale} />
          </>
        )}
      </p>
    </section>
  );
}
