// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The filter row of the Transactions table (FR-L2, design `wi4p2` Tanggal, `RLoeY` Jenis, `hbmUp` Kategori, `vBLUp`
 * Rekening, `PaIu7` Tag, `ajFap` "+ Filter") and the no-results state (`auXN6`). Every filter lives in the URL, so a
 * filtered table is a shareable link. Checklists apply with "Tampilkan"; the date applies with the range picker's
 * "Terapkan". Below 1024 px the row scrolls sideways instead of wrapping.
 */
import type { CategoryView } from '@wf/db/categories';
import { weekStartOf } from '@wf/domain/dashboard';
import { ACCOUNT_TYPES } from '@wf/domain/ledger';
import { addDays, countDays, type LocalDate } from '@wf/domain/period';
import type { TransactionSource } from '@wf/domain/transactions';
import { GROUPS_BY_KIND } from '@wf/domain/categories';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { Checkbox } from '@wf/ui/checkbox';
import { formatDateRange, type DateRange } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Popover, PopoverContent, PopoverTrigger } from '@wf/ui/popover';
import { RangePicker, type RangePreset } from '@wf/ui/range-picker';
import { ChevronDown, ListFilter, Search, SearchX, X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { accountTypeLabel, categoryGroupLabel, categoryName } from '../../lib/ledger-labels.ts';
import {
  hasFilters,
  LISTED_TYPES,
  listParamOf,
  listValues,
  MAX_RANGE_DAYS,
  queryOf,
  rangeParamOf,
  type TransactionsSearch,
} from '../../lib/transactions-search.ts';
import type { TransactionsView } from '../../server/fn/transactions.ts';
import { INPUT_FRAME } from '../form.tsx';
import type { LedgerData } from '../ledger/use-transaction-form.ts';
import { usePreferences } from '../preferences.tsx';

export interface TransactionFiltersProps {
  readonly view: TransactionsView;
  readonly search: TransactionsSearch;
  readonly ledger: LedgerData;
  readonly onSearchChange: (patch: Partial<TransactionsSearch>) => void;
}

const CHIP =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] border border-border bg-card px-2.5 text-[12.5px] text-muted-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[active=true]:border-border-strong data-[active=true]:text-fg';
const LINK_BUTTON =
  'rounded-[6px] px-2 py-1 text-[12.5px] text-muted-fg hover:bg-tint-06 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50';
const APPLY_BUTTON =
  'inline-flex h-8 items-center rounded-[7px] bg-fg px-3 text-[12.5px] font-semibold text-primary-fg hover:bg-text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** The amount presets of "Rentang jumlah", in base-currency minor units (IDR). */
const AMOUNT_PRESETS = [50_000, 100_000, 1_000_000] as const;

export interface ChecklistOption {
  readonly value: string;
  readonly label: ReactNode;
  /** For the search field. */
  readonly text: string;
  readonly count: number;
  /** Options are grouped under this heading, in order of first appearance. */
  readonly group?: string;
}

/** The FR-S7 presets for `today`: Hari ini … Tahun ini (`wi4p2`). */
export function datePresets(today: LocalDate, weekStart: 'monday' | 'sunday'): RangePreset[] {
  const month = today.slice(0, 7);
  const lastMonthEnd = addDays(`${month}-01` as LocalDate, -1);
  return [
    { label: m.date_preset_today(), range: { start: today, end: today } },
    { label: m.date_preset_yesterday(), range: { start: addDays(today, -1), end: addDays(today, -1) } },
    { label: m.transactions_filter_date_week(), range: { start: weekStartOf(today, weekStart), end: today } },
    { label: m.transactions_filter_date_7days(), range: { start: addDays(today, -6), end: today } },
    { label: m.transactions_filter_date_month(), range: { start: `${month}-01` as LocalDate, end: today } },
    {
      label: m.transactions_filter_date_last_month(),
      range: { start: `${lastMonthEnd.slice(0, 7)}-01` as LocalDate, end: lastMonthEnd },
    },
    {
      label: m.transactions_filter_date_year(),
      range: { start: `${today.slice(0, 4)}-01-01` as LocalDate, end: today },
    },
  ];
}

/** "Kategori · Makan & Dapur, Hobi" or "Kategori · 3 dipilih". */
function chosenText(labels: readonly string[]): string {
  return labels.length <= 2 ? labels.join(', ') : m.transactions_filter_selected({ count: labels.length });
}

interface ChecklistProps {
  readonly label: string;
  readonly options: readonly ChecklistOption[];
  readonly selected: readonly string[];
  readonly onApply: (values: string[]) => void;
  readonly searchPlaceholder?: string;
  /** Above the list (the tag match mode). */
  readonly header?: ReactNode;
}

/** A chip that opens a checklist: "Jenis Semua ▾" or, when something is chosen, "Jenis · Pengeluaran ×". */
function ChecklistChip({ label, options, selected, onApply, searchPlaceholder, header }: ChecklistProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([...selected]);
  const [query, setQuery] = useState('');
  const listId = useId();
  const visible = options.filter((option) => option.text.toLowerCase().includes(query.trim().toLowerCase()));
  const groups = [...new Set(visible.map((option) => option.group ?? ''))];
  const chosenLabels = options.filter((option) => selected.includes(option.value)).map((option) => option.text);
  const matching = visible
    .filter((option) => draft.includes(option.value))
    .reduce((sum, option) => sum + option.count, 0);
  return (
    <span className="inline-flex shrink-0 items-center">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setDraft([...selected]);
            setQuery('');
          }
        }}
      >
        <PopoverTrigger className={CHIP} data-active={selected.length > 0}>
          <span>{label}</span>
          <span className="font-medium text-fg">
            {selected.length === 0 ? m.transactions_filter_all() : chosenText(chosenLabels)}
          </span>
          <ChevronDown aria-hidden="true" className="size-3.5 text-subtle" />
        </PopoverTrigger>
        <PopoverContent className="flex w-[300px] flex-col" aria-label={label}>
          {header}
          {searchPlaceholder === undefined ? null : (
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search aria-hidden="true" className="size-3.5 text-subtle" />
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                }}
                aria-label={searchPlaceholder}
                aria-controls={listId}
                placeholder={searchPlaceholder}
                className="h-7 min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-subtle"
              />
            </div>
          )}
          <div id={listId} className="flex max-h-[320px] flex-col gap-2 overflow-y-auto p-2">
            {groups.map((group) => (
              <fieldset key={group} className="flex flex-col gap-1">
                {group === '' ? null : (
                  <legend className="px-1 pb-1 text-[11px] font-medium text-subtle uppercase">{group}</legend>
                )}
                {visible
                  .filter((option) => (option.group ?? '') === group)
                  .map((option) => (
                    <div
                      key={option.value}
                      className="flex items-center justify-between gap-2 rounded-[6px] px-1 py-1 hover:bg-tint-06"
                    >
                      <Checkbox
                        label={option.label}
                        checked={draft.includes(option.value)}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setDraft((current) =>
                            checked ? [...current, option.value] : current.filter((value) => value !== option.value),
                          );
                        }}
                        className="min-w-0 flex-1"
                      />
                      <span className="font-mono text-[11px] text-subtle">{option.count}</span>
                    </div>
                  ))}
              </fieldset>
            ))}
            {visible.length === 0 ? (
              <p className="px-1 py-2 text-[12.5px] text-subtle">{m.transactions_filter_none_found()}</p>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border p-2">
            <button
              type="button"
              className={LINK_BUTTON}
              disabled={draft.length === 0}
              onClick={() => {
                setDraft([]);
              }}
            >
              {m.transactions_filter_clear()}
            </button>
            <button
              type="button"
              className={APPLY_BUTTON}
              onClick={() => {
                onApply(draft);
                setOpen(false);
              }}
            >
              {draft.length === 0 ? m.transactions_filter_show_all() : m.transactions_filter_show({ count: matching })}
            </button>
          </div>
        </PopoverContent>
      </Popover>
      {selected.length === 0 ? null : (
        <button
          type="button"
          aria-label={m.transactions_filter_remove({ filter: label })}
          className="-ml-px flex h-8 items-center rounded-r-[7px] px-1.5 text-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => {
            onApply([]);
          }}
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      )}
    </span>
  );
}

/** A removable chip for an active "+ Filter" filter. */
function ActiveChip({ children, label, onRemove }: { children: ReactNode; label: string; onRemove: () => void }) {
  return (
    <span className={`${CHIP} pr-1`} data-active="true">
      {children}
      <button
        type="button"
        aria-label={m.transactions_filter_remove({ filter: label })}
        className="flex size-6 items-center justify-center rounded-[5px] text-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        onClick={onRemove}
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </span>
  );
}

function categoryOptions(categories: readonly CategoryView[], view: TransactionsView): ChecklistOption[] {
  const counts = new Map(view.categories.map((group) => [group.categoryId, group.count]));
  return (['expense', 'income', 'fee'] as const).flatMap((kind) =>
    GROUPS_BY_KIND[kind].flatMap((group) =>
      categories
        .filter((category) => category.kind === kind && category.group === group && category.archivedAt === null)
        .map((category) => ({
          value: category.id,
          label: categoryName(category),
          text: categoryName(category),
          count: counts.get(category.id) ?? 0,
          group: kind === 'income' ? m.transactions_filter_income_group() : categoryGroupLabel(group),
        })),
    ),
  );
}

export function TransactionFilters({ view, search, ledger, onSearchChange }: TransactionFiltersProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const range: DateRange = { start: view.from, end: view.to };
  const accountCounts = new Map(view.accounts.map((group) => [group.accountId, group.count]));
  const sourceLabel = (source: TransactionSource) => SOURCE_LABELS[source]();
  return (
    // Below 1024 px the chips scroll sideways (FR-TB3); the faded right edge says there is more, and the end padding
    // lets the last chip scroll clear of it.
    <div
      role="group"
      aria-label={m.transactions_filter_label()}
      className="flex items-center gap-2 overflow-x-auto pb-1 max-lg:pr-12 max-lg:mask-r-from-90% lg:flex-wrap lg:overflow-visible"
    >
      <span className="inline-flex shrink-0 items-center gap-1">
        <RangePicker
          value={range}
          onValueChange={(next) => {
            const period = view.periods.find(
              (candidate) => candidate.start === next.start && candidate.end === next.end,
            );
            onSearchChange(
              period === undefined
                ? { range: rangeParamOf(next.start, next.end), period: undefined }
                : { period: period.label, range: undefined },
            );
          }}
          presets={datePresets(view.today, 'monday')}
          summary={(chosen) =>
            m.transactions_filter_date_summary({
              days: countDays(chosen.start, chosen.end),
              periods: view.periods.filter((period) => period.start <= chosen.end && period.end >= chosen.start).length,
            })
          }
          today={view.today}
          locale={locale}
          labels={{
            previousMonth: m.calendar_previous_month(),
            nextMonth: m.calendar_next_month(),
            start: m.transactions_filter_date_start(),
            end: m.transactions_filter_date_end(),
            apply: m.transactions_filter_date_apply(),
            cancel: m.record_cancel(),
          }}
          aria-label={m.transactions_filter_date()}
        />
        {search.range === undefined && search.period === undefined ? null : (
          <button
            type="button"
            aria-label={m.transactions_filter_date_reset()}
            className="flex size-7 items-center justify-center rounded-[6px] text-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => {
              onSearchChange({ range: undefined, period: undefined });
            }}
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        )}
      </span>
      <ChecklistChip
        label={m.transactions_filter_type()}
        options={LISTED_TYPES.map((type) => ({
          value: type,
          label: TYPE_LABELS[type](),
          text: TYPE_LABELS[type](),
          count:
            type === 'expense'
              ? view.summary.outCount
              : type === 'income'
                ? view.summary.inCount
                : view.summary.transferCount,
        }))}
        selected={listValues(search.type)}
        onApply={(values) => {
          onSearchChange({ type: listParamOf(values) });
        }}
      />
      <ChecklistChip
        label={m.transactions_filter_category()}
        options={categoryOptions(ledger.categories, view)}
        selected={listValues(search.category)}
        searchPlaceholder={m.transactions_filter_category_search()}
        onApply={(values) => {
          onSearchChange({ category: listParamOf(values) });
        }}
      />
      <ChecklistChip
        label={m.transactions_filter_account()}
        options={ACCOUNT_TYPES.flatMap((type) =>
          ledger.accounts
            .filter((account) => account.type === type && account.status === 'active')
            .map((account) => ({
              value: account.id,
              label: account.displayName,
              text: account.displayName,
              count: accountCounts.get(account.id) ?? 0,
              group: accountTypeLabel(type),
            })),
        )}
        selected={listValues(search.account)}
        searchPlaceholder={m.transactions_filter_account_search()}
        onApply={(values) => {
          onSearchChange({ account: listParamOf(values) });
        }}
      />
      <ChecklistChip
        label={m.transactions_filter_tag()}
        options={ledger.tags.map((tag) => ({
          value: tag.slug,
          label: <span className="font-mono">#{tag.slug}</span>,
          text: tag.slug,
          count: tag.usageCount,
        }))}
        selected={listValues(search.tag)}
        searchPlaceholder={m.transactions_filter_tag_search()}
        header={
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-[12.5px]">
            <span className="text-muted-fg">{m.transactions_filter_tag_match()}</span>
            <span role="group" aria-label={m.transactions_filter_tag_match()} className="flex gap-1">
              {(['any', 'all'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={(search.tagMode ?? 'any') === mode}
                  className="rounded-[6px] px-2 py-1 text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-tint-06 aria-pressed:text-fg"
                  onClick={() => {
                    onSearchChange({ tagMode: mode === 'any' ? undefined : mode });
                  }}
                >
                  {mode === 'any' ? m.transactions_filter_tag_any() : m.transactions_filter_tag_all()}
                </button>
              ))}
            </span>
          </div>
        }
        onApply={(values) => {
          onSearchChange({ tag: listParamOf(values) });
        }}
      />
      {search.min === undefined && search.max === undefined ? null : (
        <ActiveChip
          label={m.transactions_filter_amount()}
          onRemove={() => {
            onSearchChange({ min: undefined, max: undefined });
          }}
        >
          {m.transactions_filter_amount()}{' '}
          <span className="font-medium text-fg">
            {search.min === undefined ? null : (
              <>
                {m.transactions_filter_at_least()}{' '}
                <Money minor={BigInt(search.min)} currency={ledger.baseCurrency} context="amount" locale={locale} />
              </>
            )}
            {search.max === undefined ? null : (
              <>
                {' '}
                {m.transactions_filter_at_most()}{' '}
                <Money minor={BigInt(search.max)} currency={ledger.baseCurrency} context="amount" locale={locale} />
              </>
            )}
          </span>
        </ActiveChip>
      )}
      {search.attachment === undefined ? null : (
        <ActiveChip
          label={m.transactions_filter_attachment()}
          onRemove={() => {
            onSearchChange({ attachment: undefined });
          }}
        >
          {search.attachment ? m.transactions_filter_attachment() : m.transactions_filter_no_attachment()}
        </ActiveChip>
      )}
      {search.source === undefined ? null : (
        <ActiveChip
          label={m.transactions_filter_source()}
          onRemove={() => {
            onSearchChange({ source: undefined });
          }}
        >
          {m.transactions_filter_source()}{' '}
          <span className="font-medium text-fg">
            {chosenText((listValues(search.source) as TransactionSource[]).map(sourceLabel))}
          </span>
        </ActiveChip>
      )}
      {search.currency === undefined ? null : (
        <ActiveChip
          label={m.transactions_filter_currency()}
          onRemove={() => {
            onSearchChange({ currency: undefined });
          }}
        >
          {m.transactions_filter_currency()}{' '}
          <span className="font-medium text-fg">{listValues(search.currency).join(', ')}</span>
        </ActiveChip>
      )}
      {search.uncategorized === undefined ? null : (
        <ActiveChip
          label={m.transactions_filter_uncategorized()}
          onRemove={() => {
            onSearchChange({ uncategorized: undefined });
          }}
        >
          {m.transactions_filter_uncategorized()}
        </ActiveChip>
      )}
      <MoreFilters view={view} search={search} ledger={ledger} onSearchChange={onSearchChange} />
    </div>
  );
}

const TYPE_LABELS = {
  expense: m.transactions_filter_type_expense,
  income: m.transactions_filter_type_income,
  transfer: m.transactions_filter_type_transfer,
} as const;

const SOURCE_LABELS: Readonly<Record<TransactionSource, () => string>> = {
  manual: m.transactions_filter_source_manual,
  quick: m.transactions_table_source_quick,
  assistant: m.transactions_table_source_assistant,
  receipt: m.transactions_table_source_receipt,
  import: m.transactions_table_source_import,
  gmail: m.transactions_table_source_gmail,
  recurring: m.transactions_table_source_recurring,
  period_close: m.transactions_table_source_period_close,
};

/** "+ Filter" (`ajFap`): amount range, attachment, source, currency, uncategorized. */
function MoreFilters({ view, search, ledger, onSearchChange }: TransactionFiltersProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const [open, setOpen] = useState(false);
  const [min, setMin] = useState<bigint | null>(null);
  const [max, setMax] = useState<bigint | null>(null);
  const [includeAll, setIncludeAll] = useState(search.type !== undefined);
  const [attachment, setAttachment] = useState(false);
  const [uncategorized, setUncategorized] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const ids = { min: useId(), max: useId() };
  const allCurrencies = [...new Set(ledger.accounts.map((account) => account.currency))].sort();
  const uncategorizedCount = view.categories.find((group) => group.categoryId === null)?.count ?? 0;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setMin(search.min === undefined ? null : BigInt(search.min));
          setMax(search.max === undefined ? null : BigInt(search.max));
          setIncludeAll(search.type !== undefined);
          setAttachment(search.attachment === true);
          setUncategorized(search.uncategorized === true);
          setSources(listValues(search.source));
          setCurrencies(listValues(search.currency));
        }
      }}
    >
      <PopoverTrigger className={`${CHIP} border-dashed`}>
        <ListFilter aria-hidden="true" className="size-3.5" />
        {m.transactions_filter_more()}
      </PopoverTrigger>
      <PopoverContent className="flex w-[340px] flex-col" aria-label={m.transactions_filter_more_title()}>
        <div className="flex flex-col gap-3 p-3">
          <h3 className="text-[11px] font-medium text-subtle uppercase">{m.transactions_filter_more_title()}</h3>
          <fieldset className="flex flex-col gap-2">
            <legend className="pb-1 text-[12.5px] font-medium text-fg">{m.transactions_filter_amount()}</legend>
            <div className="flex items-center gap-2">
              <div className={INPUT_FRAME.sm}>
                <AmountInput
                  id={ids.min}
                  size="inline"
                  value={min}
                  onValueChange={setMin}
                  currency={ledger.baseCurrency}
                  locale={locale}
                  aria-label={m.transactions_filter_amount_min()}
                  placeholder={m.transactions_filter_amount_min()}
                />
              </div>
              <span aria-hidden="true" className="text-subtle">
                –
              </span>
              <div className={INPUT_FRAME.sm}>
                <AmountInput
                  id={ids.max}
                  size="inline"
                  value={max}
                  onValueChange={setMax}
                  currency={ledger.baseCurrency}
                  locale={locale}
                  aria-label={m.transactions_filter_amount_max()}
                  placeholder={m.transactions_filter_amount_max()}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {AMOUNT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={min === BigInt(preset) && max === null}
                  className="rounded-[6px] border border-border px-2 py-1 text-[12px] text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-fg aria-pressed:text-fg"
                  onClick={() => {
                    setMin(BigInt(preset));
                    setMax(null);
                  }}
                >
                  {m.transactions_filter_at_least()}{' '}
                  <Money minor={BigInt(preset)} currency={ledger.baseCurrency} context="table" locale={locale} />
                </button>
              ))}
            </div>
            <Checkbox
              label={m.transactions_filter_amount_include()}
              checked={includeAll}
              onChange={(event) => {
                setIncludeAll(event.currentTarget.checked);
              }}
            />
          </fieldset>
          <Checkbox
            label={m.transactions_filter_attachment()}
            checked={attachment}
            onChange={(event) => {
              setAttachment(event.currentTarget.checked);
            }}
          />
          <Checkbox
            label={m.transactions_filter_uncategorized()}
            description={m.transactions_summary_count({ count: uncategorizedCount })}
            checked={uncategorized}
            onChange={(event) => {
              setUncategorized(event.currentTarget.checked);
            }}
          />
          <fieldset className="flex flex-col gap-1.5">
            <legend className="pb-1 text-[12.5px] font-medium text-fg">{m.transactions_filter_source()}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {(['manual', 'quick', 'import', 'gmail'] as const satisfies readonly TransactionSource[]).map(
                (source) => (
                  <Checkbox
                    key={source}
                    label={SOURCE_LABELS[source]()}
                    checked={sources.includes(source)}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setSources((current) =>
                        checked ? [...current, source] : current.filter((value) => value !== source),
                      );
                    }}
                  />
                ),
              )}
            </div>
          </fieldset>
          {allCurrencies.length < 2 ? null : (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="pb-1 text-[12.5px] font-medium text-fg">{m.transactions_filter_currency()}</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {allCurrencies.map((code) => (
                  <Checkbox
                    key={code}
                    label={code}
                    checked={currencies.includes(code)}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setCurrencies((current) =>
                        checked ? [...current, code] : current.filter((value) => value !== code),
                      );
                    }}
                  />
                ))}
              </div>
            </fieldset>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border p-2">
          <button
            type="button"
            className={LINK_BUTTON}
            onClick={() => {
              setMin(null);
              setMax(null);
              setAttachment(false);
              setUncategorized(false);
              setSources([]);
              setCurrencies([]);
            }}
          >
            {m.transactions_filter_clear()}
          </button>
          <button
            type="button"
            className={APPLY_BUTTON}
            onClick={() => {
              const amount = min !== null || max !== null;
              onSearchChange({
                min: min === null ? undefined : Number(min),
                max: max === null ? undefined : Number(max),
                // "Termasuk pemasukan & transfer" off: an amount range looks at spending only.
                ...(amount && !includeAll && search.type === undefined ? { type: 'expense' } : {}),
                attachment: attachment ? true : undefined,
                uncategorized: uncategorized ? true : undefined,
                source: listParamOf(sources),
                currency: listParamOf(currencies),
              });
              setOpen(false);
            }}
          >
            {m.transactions_filter_apply()}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export interface NoResultsProps {
  readonly view: TransactionsView;
  readonly search: TransactionsSearch;
  readonly onSearchChange: (patch: Partial<TransactionsSearch>) => void;
}

/** "Tidak ada transaksi “netflix”" (`auXN6`): widen the dates or drop every filter. */
export function NoResults({ view, search, onSearchChange }: NoResultsProps) {
  const { preferences } = usePreferences();
  const dates = formatDateRange({ start: view.from, end: view.to }, preferences.locale, view.today);
  const oldest = view.periods.reduce<LocalDate>(
    (first, period) => (period.start < first ? period.start : first),
    view.from,
  );
  const start = countDays(oldest, view.today) > MAX_RANGE_DAYS ? addDays(view.today, 1 - MAX_RANGE_DAYS) : oldest;
  const query = queryOf(search);
  return (
    <div role="status" className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <SearchX aria-hidden="true" className="size-6 text-subtle" />
      <p className="text-[14px] font-medium text-fg">
        {search.q === undefined || search.q === ''
          ? m.transactions_noresults_title()
          : m.transactions_noresults_title_query({ query: search.q })}
      </p>
      <p className="max-w-[420px] text-[12.5px] text-muted-fg">
        {hasFilters({ ...query, q: undefined })
          ? m.transactions_noresults_description_filters({ dates })
          : m.transactions_noresults_description({ dates })}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-[7px] border border-border px-3 text-[12.5px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => {
            onSearchChange({ range: rangeParamOf(start, view.today), period: undefined });
          }}
        >
          {m.transactions_noresults_all_dates()}
        </button>
        {hasFilters(query) ? (
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-[7px] border border-border px-3 text-[12.5px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => {
              onSearchChange({
                type: undefined,
                category: undefined,
                uncategorized: undefined,
                account: undefined,
                tag: undefined,
                tagMode: undefined,
                min: undefined,
                max: undefined,
                attachment: undefined,
                source: undefined,
                currency: undefined,
                q: undefined,
              });
            }}
          >
            {m.transactions_noresults_clear()}
          </button>
        ) : null}
      </div>
      <p className="mt-2 font-mono text-[11px] text-subtle">
        {m.transactions_noresults_count({ total: view.unfilteredCount })}
      </p>
    </div>
  );
}
