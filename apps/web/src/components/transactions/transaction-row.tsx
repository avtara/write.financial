// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One row of the Transactions table (design `t7l0Cj`): checkbox, time (date + time in the Flat view), category glyph,
 * merchant — description with `#tag` chips, the source badge of automated entries and the attachment clip, then the
 * category, account, amount, and the optional attachment / running balance / source columns in the user's order
 * ("Atur kolom"). Search words are highlighted (`p22to9`). Keyboard handling lives in the table (roving focus).
 */
import type { TransactionRow } from '@wf/db/transaction-query';
import type { Locale } from '@wf/domain/money';
import type { TransactionSource, TransactionType } from '@wf/domain/transactions';
import { m } from '@wf/i18n/messages';
import { Checkbox } from '@wf/ui/checkbox';
import { formatDate, formatTime } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { usePrivacy } from '@wf/ui/privacy';
import { Paperclip } from 'lucide-react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { colorProps } from '../../lib/colors.ts';
import { categoryName } from '../../lib/ledger-labels.ts';
import type { Density, TransactionColumn } from '../../lib/transaction-columns.ts';
import type { TransactionView } from '../../lib/transactions-search.ts';
import { CategoryIcon } from '../category-icon.tsx';
import type { LedgerData } from '../ledger/use-transaction-form.ts';
import { highlightParts, searchWords, tagMatches } from './table-groups.ts';

/** Width and alignment of each column, shared by the header and the rows so they line up. */
export const COLUMN_CLASS: Readonly<Record<Exclude<TransactionColumn, 'tags'>, string>> = {
  time: 'w-[52px] shrink-0',
  description: 'min-w-0 flex-1',
  category: 'w-[150px] shrink-0',
  // FR-TB3: a narrow table (tablets, or beside the detail panel) has no room for the account.
  account: 'w-[130px] shrink-0 @max-[54rem]:hidden',
  amount: 'w-[130px] shrink-0 text-right',
  attachment: 'flex w-8 shrink-0 justify-center',
  balance: 'w-[130px] shrink-0 text-right',
  source: 'w-[110px] shrink-0',
};

/** Without day headers (Per kategori, Rata) the time column shows the date too. */
export const DATED_TIME_CLASS = 'w-[104px] shrink-0';

export const DENSITY_CLASS: Readonly<Record<Density, string>> = {
  comfortable: 'min-h-[55px] py-2',
  compact: 'min-h-[38px] py-1',
};

const SOURCE_LABELS: Readonly<Record<Exclude<TransactionSource, 'manual'>, () => string>> = {
  quick: m.transactions_table_source_quick,
  assistant: m.transactions_table_source_assistant,
  receipt: m.transactions_table_source_receipt,
  import: m.transactions_table_source_import,
  gmail: m.transactions_table_source_gmail,
  recurring: m.transactions_table_source_recurring,
  period_close: m.transactions_table_source_period_close,
};

/** "Gmail · agent", "Catat Cepat"…; `null` for manual entries (no badge). */
export function sourceLabel(source: TransactionSource): string | null {
  return source === 'manual' ? null : SOURCE_LABELS[source]();
}

const TYPE_LABELS: Readonly<Record<Exclude<TransactionType, 'expense' | 'income'>, () => string>> = {
  transfer: m.transactions_table_total_transfer,
  dividend: m.transactions_table_type_dividend,
  adjustment: m.transactions_table_type_adjustment,
  investment: m.transactions_table_type_investment,
  receivable_out: m.transactions_table_type_receivable_out,
  receivable_in: m.transactions_table_type_receivable_in,
  writeoff: m.transactions_table_type_writeoff,
};

/** The "Kategori" cell: the category, "Belum dikategorikan", or the type for transfers and the like. */
export function categoryLabel(row: Pick<TransactionRow, 'type' | 'categoryId'>, ledger: LedgerData) {
  if (row.type !== 'expense' && row.type !== 'income') return { label: TYPE_LABELS[row.type](), color: '' };
  const category = ledger.categories.find((candidate) => candidate.id === row.categoryId);
  return category === undefined
    ? { label: m.transactions_table_uncategorized(), color: '' }
    : { label: categoryName(category), color: category.color };
}

/** Signed like a ledger: `+Rp6.200.000` in green, `−Rp28.000`; the `+` and the color go in privacy mode. */
export function SignedMoney({
  amountMinor,
  currency,
  locale,
  className = '',
}: {
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly locale: Locale;
  readonly className?: string;
}) {
  const { hidden } = usePrivacy();
  const gain = amountMinor > 0n && !hidden;
  return (
    <span className={`font-mono whitespace-nowrap ${gain ? 'text-green-fg' : ''} ${className}`}>
      {gain ? '+' : null}
      <Money minor={amountMinor} currency={currency} context="amount" locale={locale} />
    </span>
  );
}

/** The "Jumlah" cell: transfers neutral and unsigned, everything else signed. */
export function RowAmount({ row, locale }: { readonly row: TransactionRow; readonly locale: Locale }) {
  if (row.type === 'transfer') {
    const sent = row.amountMinor < 0n ? -row.amountMinor : row.amountMinor;
    return <Money minor={sent} currency={row.currency} context="amount" locale={locale} className="text-muted-fg" />;
  }
  return <SignedMoney amountMinor={row.amountMinor} currency={row.currency} locale={locale} className="font-medium" />;
}

function Highlighted({ text, words }: { readonly text: string; readonly words: readonly string[] }) {
  return highlightParts(text, words).map((part, index) =>
    part.match ? (
      // Parts never reorder.
      <mark key={index} className="rounded-[3px] bg-amber-tint-2 font-medium text-amber-fg">
        {part.text}
      </mark>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  );
}

const CHIP = 'inline-flex h-[18px] items-center rounded-[4px] border px-1.5 font-mono text-[10.5px]';

export function SourceBadge({ source }: { readonly source: TransactionSource }) {
  const label = sourceLabel(source);
  return label === null ? null : (
    <span className={`${CHIP} border-border bg-surface-3 font-sans text-muted-fg`}>{label}</span>
  );
}

function AttachmentMark() {
  return (
    <Paperclip role="img" aria-label={m.transactions_table_attachment()} className="size-3 shrink-0 text-subtle" />
  );
}

export interface TransactionRowViewProps {
  readonly row: TransactionRow;
  /** Visible columns in the user's order (`tags` puts the chips under the description). */
  readonly columns: readonly TransactionColumn[];
  readonly density: Density;
  readonly mode: TransactionView;
  readonly ledger: LedgerData;
  readonly timeZone: string;
  readonly locale: Locale;
  /** The search (`?q=`), for the highlight. */
  readonly query: string | undefined;
  /** "Saldo berjalan" after this row, when one account is filtered. */
  readonly balance: { readonly minor: bigint; readonly currency: string } | null;
  /** Its accessible name ("Shopee"). */
  readonly label: string;
  /** Open in the detail panel. */
  readonly open: boolean;
  readonly checked: boolean;
  /** The roving tab stop. */
  readonly tabStop: boolean;
  readonly onCheck: (shiftKey: boolean) => void;
  readonly onOpen: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly onFocus: () => void;
  /** The ⋯ menu. */
  readonly menu: ReactNode;
}

export function TransactionRowView({
  row,
  columns,
  density,
  mode,
  ledger,
  timeZone,
  locale,
  query,
  balance,
  label,
  open,
  checked,
  tabStop,
  onCheck,
  onOpen,
  onKeyDown,
  onFocus,
  menu,
}: TransactionRowViewProps) {
  const words = searchWords(query);
  const category = categoryLabel(row, ledger);
  const glyph = ledger.categories.find((candidate) => candidate.id === row.categoryId);
  const time = formatTime(row.occurredAt, timeZone, locale);
  const showTags = columns.includes('tags');
  const inlineSource = !columns.includes('source') && row.source !== 'manual';
  const inlineAttachment = !columns.includes('attachment') && row.hasAttachment;
  const tags = showTags ? row.tags : [];
  const title = [row.merchant, row.description].filter((part) => part !== null).join(' — ') || category.label;
  const cell = (column: TransactionColumn): ReactNode => {
    switch (column) {
      case 'time':
        return (
          <span
            key={column}
            className={`font-mono text-[12px] text-subtle ${mode === 'day' ? COLUMN_CLASS.time : DATED_TIME_CLASS}`}
          >
            {mode === 'day' ? time : `${formatDate(row.localDate, locale, 'day')} · ${time}`}
          </span>
        );
      case 'description':
        return (
          <span key={column} className={`flex items-center gap-3 ${COLUMN_CLASS.description}`}>
            {row.type === 'transfer' ? (
              <CategoryIcon icon="arrow-left-right" color="" />
            ) : (
              <CategoryIcon icon={glyph?.icon ?? 'shapes'} color={glyph?.color ?? ''} />
            )}
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[13.5px] text-fg">
                  <Highlighted text={title} words={words} />
                </span>
                {inlineAttachment ? <AttachmentMark /> : null}
              </span>
              {tags.length > 0 || inlineSource ? (
                <span className="flex flex-wrap items-center gap-1">
                  {inlineSource ? <SourceBadge source={row.source} /> : null}
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className={`${CHIP} ${tagMatches(tag, query) ? 'border-amber-tint-2 bg-amber-tint-2 text-amber-fg' : 'border-border bg-surface-3 text-muted-fg'}`}
                    >
                      #{tag}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
          </span>
        );
      case 'tags':
        return null;
      case 'category':
        return (
          <span
            key={column}
            className={`flex items-center gap-2 text-[13px] text-text-secondary ${COLUMN_CLASS.category}`}
          >
            <span
              {...colorProps(category.color)}
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full bg-[var(--wf-color,var(--subtle))]"
            />
            <span className="truncate">{category.label}</span>
          </span>
        );
      case 'account':
        return (
          <span key={column} className={`truncate text-[13px] text-muted-fg ${COLUMN_CLASS.account}`}>
            {ledger.accounts.find((account) => account.id === row.accountId)?.displayName}
          </span>
        );
      case 'amount':
        return (
          <span key={column} className={`text-[13.5px] ${COLUMN_CLASS.amount}`}>
            <RowAmount row={row} locale={locale} />
          </span>
        );
      case 'attachment':
        return (
          <span key={column} className={COLUMN_CLASS.attachment}>
            {row.hasAttachment ? <AttachmentMark /> : null}
          </span>
        );
      case 'balance':
        return (
          <span key={column} className={`text-[13px] text-muted-fg ${COLUMN_CLASS.balance}`}>
            {balance === null ? (
              <span title={m.transactions_table_no_balance()}>—</span>
            ) : (
              <Money minor={balance.minor} currency={balance.currency} context="amount" locale={locale} />
            )}
          </span>
        );
      case 'source':
        return (
          <span key={column} className={COLUMN_CLASS.source}>
            <SourceBadge source={row.source} />
          </span>
        );
    }
  };
  const click = (event: MouseEvent<HTMLDivElement>) => {
    // The checkbox and the ⋯ menu (portalled, but React events bubble through portals) handle their own clicks.
    if ((event.target as HTMLElement).closest('label, button, [role="menu"]') !== null) return;
    if (event.shiftKey) onCheck(true);
    else onOpen();
  };
  return (
    <div
      role="group"
      aria-label={label}
      aria-current={open ? 'true' : undefined}
      data-row-id={row.id}
      tabIndex={tabStop ? 0 : -1}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        if (event.target === event.currentTarget) onFocus();
      }}
      onClick={click}
      className={`group relative flex cursor-pointer items-center gap-3 border-b border-border px-4 outline-none focus-visible:bg-tint-04 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring hover:bg-tint-04 ${DENSITY_CLASS[density]} ${open || checked ? 'bg-tint-04' : ''}`}
    >
      {open ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-fg" /> : null}
      <Checkbox
        label={<span className="sr-only">{m.transactions_table_select_row({ name: label })}</span>}
        checked={checked}
        tabIndex={-1}
        onChange={() => {}}
        onClick={(event) => {
          onCheck(event.shiftKey);
        }}
        className="shrink-0 gap-0 [&>span:first-child]:mt-0"
      />
      {columns.map(cell)}
      <span className="flex w-8 shrink-0 justify-end">{menu}</span>
    </div>
  );
}
