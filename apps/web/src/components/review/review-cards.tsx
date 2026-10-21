// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Review queue's item cards (FR-L7, design `N4J73r`, `Ju8vG`, `dIS46`, `yNnG3`): a due bill or recurring
 * schedule ("Belum" / "Sudah dibayar|ditransfer|diterima", "Ubah nominal", "DIBAGI KE"), an AI result with its
 * confidence ("Yakin 62%"), a transaction that lost its category, and a period-close proposal. Cards only report the
 * user's choice; the page applies it.
 */
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import type { Locale } from '@wf/domain/money';
import type { LocalDate } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { formatDate, formatTime, toLocalDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { ArrowLeftRight, Check, CircleAlert, CircleCheck, Plus, Sparkles, Tag } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { Button } from '../form.tsx';
import { CategoryIcon } from '../category-icon.tsx';
import { CategorySelect, frequentCategories } from '../ledger/category-picker.tsx';
import { draftAmount, dueState, type CategoryItem, type CloseItem, type DraftItem } from './review-model.ts';

/** Names and currencies the cards show, from the page's accounts and categories. */
export interface ReviewLookup {
  readonly baseCurrency: string;
  readonly accounts: readonly AccountView[];
  readonly categories: readonly CategoryView[];
}

const accountOf = (lookup: ReviewLookup, id: string | null) => lookup.accounts.find((account) => account.id === id);
const currencyOf = (lookup: ReviewLookup, id: string | null) => accountOf(lookup, id)?.currency ?? lookup.baseCurrency;

const CARD = 'flex flex-col gap-3 rounded-[12px] border border-border bg-surface-2 p-4';
const NOTE = 'flex items-start gap-2 rounded-[8px] bg-amber-tint-1 px-3 py-2 text-[12.5px] text-text-secondary';

/** The card's heading row: a leading tile, title and subtitle, and the amount with its date. */
function CardHead({
  tile,
  title,
  subtitle,
  amount,
  date,
}: {
  tile: ReactNode;
  title: string;
  subtitle: string | null;
  amount: ReactNode;
  date: string | null;
}) {
  return (
    <div className="flex items-start gap-3">
      {tile}
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="truncate text-[14px] font-semibold text-fg">{title}</h3>
        {subtitle === null ? null : <p className="truncate text-[12.5px] text-muted-fg">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-[13.5px] font-medium text-fg">{amount}</span>
        {date === null ? null : <span className="font-mono text-[11.5px] text-subtle">{date}</span>}
      </div>
    </div>
  );
}

/** A square with the subject's initial (subscriptions without a logo). */
function InitialTile({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-tint-06 text-[13px] font-semibold text-fg"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function IconTile({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-tint-06 text-muted-fg [&_svg]:size-4"
    >
      {children}
    </span>
  );
}

/** The wording of a due item by what it moves: a bill paid, a transfer made, income received. */
const PAID = {
  expense: { question: m.review_paid_question, confirm: m.review_paid },
  income: { question: m.review_received_question, confirm: m.review_received },
  transfer: { question: m.review_transferred_question, confirm: m.review_transferred },
} as const;

export interface BillCardProps {
  readonly item: DraftItem;
  readonly lookup: ReviewLookup;
  readonly locale: Locale;
  readonly today: LocalDate;
  /** Recurring schedules: "Ubah nominal" (subscriptions keep their price). */
  readonly editableAmount: boolean;
  readonly pending: boolean;
  readonly onPaid: (amountMinor: bigint | null) => void;
  readonly onUnpaid: () => void;
}

/** A due subscription bill or recurring schedule (design `dIS46`, `yNnG3`). */
export function BillCard({ item, lookup, locale, today, editableAmount, pending, onPaid, onUnpaid }: BillCardProps) {
  const amountId = useId();
  const { draft } = item.payload;
  const kind = draft.type === 'transfer' ? 'transfer' : draft.type === 'income' ? 'income' : 'expense';
  const { accountId, amountMinor } = draftAmount(draft);
  const account = accountOf(lookup, accountId);
  const currency = currencyOf(lookup, accountId);
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState<bigint | null>(amountMinor);
  const due = item.dueDate ?? today;
  const state = dueState(due, today);
  const accountName = account?.displayName ?? '';
  const category = draft.type === 'transfer' ? undefined : lookup.categories.find((c) => c.id === draft.categoryId);
  const subtitle =
    draft.type === 'transfer'
      ? `${accountName} → ${accountOf(lookup, draft.toAccountId)?.displayName ?? ''}`
      : [draft.description ?? null, category === undefined ? null : categoryName(category)]
          .filter((part) => part !== null && part !== '')
          .join(' · ') || accountName;
  const lateness =
    state.kind === 'overdue'
      ? m.review_due_overdue({ days: state.days })
      : state.kind === 'today'
        ? m.review_due_today()
        : m.review_due_upcoming({ days: state.days });
  const consequence =
    kind === 'income'
      ? m.review_unrecorded_in({ account: accountName })
      : item.allocations.length > 0
        ? m.review_unrecorded_goal({ account: accountName })
        : m.review_unrecorded_out({ account: accountName });
  const title = item.label ?? accountName;
  const changed = editing && edited !== null && edited !== amountMinor ? edited : null;
  return (
    <article aria-label={title} data-review-item={item.id} className={CARD}>
      <CardHead
        tile={
          draft.type === 'transfer' ? (
            <IconTile>
              <ArrowLeftRight />
            </IconTile>
          ) : (
            <InitialTile name={title} />
          )
        }
        title={title}
        subtitle={subtitle}
        amount={<Money minor={changed ?? amountMinor} currency={currency} context="amount" locale={locale} />}
        date={formatDate(due, locale, 'day')}
      />
      <p className={NOTE}>
        <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-amber-fg" />
        <span>
          {lateness} · {consequence}
        </span>
      </p>
      {item.allocations.length === 0 ? null : (
        <section aria-label={m.review_allocations()} className="flex flex-col gap-1.5">
          <h4 className="text-[11px] font-medium text-subtle uppercase">{m.review_allocations()}</h4>
          <ul className="flex flex-col gap-1">
            {item.allocations.map((part) => (
              <li key={part.goalId} className="flex items-center gap-2 text-[12.5px] text-text-secondary">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-violet" />
                <span className="flex-1">{part.goalName}</span>
                <Money minor={part.amountMinor} currency={currency} context="table" locale={locale} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {editing ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={amountId} className="text-[12.5px] font-medium text-muted-fg">
            {m.review_amount_label()}
          </label>
          <AmountInput
            id={amountId}
            size="inline"
            value={edited}
            onValueChange={setEdited}
            currency={currency}
            locale={locale}
            autoFocus
          />
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-fg">{PAID[kind].question()}</span>
        {editableAmount && !editing ? (
          <button
            type="button"
            onClick={() => {
              setEditing(true);
            }}
            className="text-[12.5px] text-blue-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {m.review_change_amount()}
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" disabled={pending} onClick={onUnpaid}>
          {m.review_not_yet()}
        </Button>
        <Button
          size="sm"
          pending={pending}
          disabled={editing && (edited === null || edited <= 0n)}
          onClick={() => {
            onPaid(changed);
          }}
        >
          <Check aria-hidden="true" className="size-3.5" />
          {PAID[kind].confirm()}
        </Button>
      </div>
    </article>
  );
}

const SOURCE_LABEL = {
  gmail: m.review_source_gmail,
  assistant: m.review_source_assistant,
  receipt: m.review_source_receipt,
  schedule: m.review_source_schedule,
  period_close: m.review_source_period_close,
  system: m.review_source_system,
} as const;

export interface AiCardProps {
  readonly item: DraftItem;
  readonly lookup: ReviewLookup;
  readonly locale: Locale;
  readonly timeZone: string;
  readonly pending: boolean;
  readonly onRecord: () => void;
  readonly onIgnore: () => void;
}

/** An AI result (Gmail, Assistant, receipt) or import row; the confidence is shown, never acted on (FR-L7). */
export function AiCard({ item, lookup, locale, timeZone, pending, onRecord, onIgnore }: AiCardProps) {
  const { draft } = item.payload;
  const { accountId, amountMinor } = draftAmount(draft);
  const signed = draft.type === 'income' ? amountMinor : -amountMinor;
  const title = item.label ?? m.review_untitled();
  const day = toLocalDate(draft.occurredAt, timeZone);
  return (
    <article aria-label={title} data-review-item={item.id} className={CARD}>
      <CardHead
        tile={
          <IconTile>
            <Sparkles />
          </IconTile>
        }
        title={title}
        subtitle={SOURCE_LABEL[item.source]()}
        amount={<Money minor={signed} currency={currencyOf(lookup, accountId)} context="amount" locale={locale} />}
        date={`${formatDate(day, locale, 'day')} ${formatTime(draft.occurredAt, timeZone, locale)}`}
      />
      {item.aiConfidence === null ? null : (
        <p className={NOTE}>
          <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-amber-fg" />
          <span>{m.review_ai_confidence({ percent: item.aiConfidence })}</span>
        </p>
      )}
      <dl className="grid grid-cols-[84px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
        <dt className="text-muted-fg">{m.review_ai_merchant()}</dt>
        <dd className={draft.type !== 'transfer' && draft.merchant ? 'text-fg' : 'text-subtle'}>
          {(draft.type === 'transfer' ? null : draft.merchant) || m.review_ai_unknown()}
        </dd>
        <dt className="text-muted-fg">{m.review_ai_account()}</dt>
        <dd className="text-fg">{accountOf(lookup, accountId)?.displayName ?? m.review_ai_unknown()}</dd>
      </dl>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" disabled={pending} onClick={onIgnore}>
          {m.review_ignore()}
        </Button>
        <Button size="sm" pending={pending} onClick={onRecord}>
          <Plus aria-hidden="true" className="size-3.5" />
          {m.review_record()}
        </Button>
      </div>
    </article>
  );
}

export interface CategoryRowProps {
  readonly item: CategoryItem;
  readonly lookup: ReviewLookup;
  readonly locale: Locale;
  readonly timeZone: string;
  readonly value: string | null;
  readonly onValueChange: (categoryId: string) => void;
  readonly onIgnore: () => void;
}

/** A recorded transaction whose category was deleted (design `Ju8vG`): pick one, or take a suggestion. */
export function CategoryRow({ item, lookup, locale, timeZone, value, onValueChange, onIgnore }: CategoryRowProps) {
  const { subject } = item;
  const title = subject?.merchant ?? subject?.description ?? item.label ?? m.review_untitled();
  if (subject === null) {
    return (
      <article aria-label={title} data-review-item={item.id} className={CARD}>
        <h3 className="text-[14px] font-semibold text-fg">{title}</h3>
        <p className="text-[12.5px] text-muted-fg">{m.review_category_gone()}</p>
        <Button variant="secondary" size="sm" onClick={onIgnore}>
          {m.review_ignore()}
        </Button>
      </article>
    );
  }
  const kind = subject.type === 'income' ? 'income' : 'expense';
  const suggestions = frequentCategories(lookup.categories, kind).slice(0, 2);
  const day = toLocalDate(subject.occurredAt, timeZone);
  return (
    <article aria-label={title} data-review-item={item.id} className={CARD}>
      <CardHead
        tile={null}
        title={title}
        subtitle={subject.merchant === null ? null : subject.description}
        amount={<Money minor={subject.amountMinor} currency={subject.currency} context="amount" locale={locale} />}
        date={`${formatDate(day, locale, 'day')} ${formatTime(subject.occurredAt, timeZone, locale)}`}
      />
      <p className="flex items-center gap-1.5 text-[12.5px] text-muted-fg">
        <CircleCheck aria-hidden="true" className="size-3.5 text-green-fg" />
        {m.review_category_recorded({ account: accountOf(lookup, subject.accountId)?.displayName ?? '' })}
      </p>
      <div className="flex items-center gap-3">
        <span className="w-[56px] shrink-0 text-[12.5px] text-muted-fg">{m.review_category_label()}</span>
        <CategorySelect
          categories={lookup.categories}
          kind={kind}
          value={value}
          onValueChange={onValueChange}
          label={m.review_category_pick()}
          searchPlaceholder={m.category_picker_search()}
          placeholder={m.review_category_pick()}
          aria-label={m.review_category_for({ name: title })}
          className="h-8 flex-1 rounded-[7px] px-2.5 text-[12.5px]"
        />
      </div>
      {suggestions.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-fg">
          {m.review_category_suggestions()}
          {suggestions.map((category) => (
            <button
              key={category.id}
              type="button"
              aria-pressed={value === category.id}
              onClick={() => {
                onValueChange(category.id);
              }}
              className="rounded-[5px] border border-border px-1.5 py-0.5 text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-blue aria-pressed:bg-blue-tint-2"
            >
              {categoryName(category)}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

export interface CloseCardProps {
  readonly item: CloseItem;
  readonly lookup: ReviewLookup;
  readonly locale: Locale;
  readonly pending: boolean;
  readonly onApply: () => void;
  readonly onIgnore: () => void;
}

/** A period-close proposal: move the leftover to a goal, or carry a budget line into the next period. */
export function CloseCard({ item, lookup, locale, pending, onApply, onIgnore }: CloseCardProps) {
  const { payload } = item;
  let title: string;
  let subtitle: string;
  let amount: ReactNode;
  let tile: ReactNode;
  if (payload.kind === 'leftover') {
    title = item.label === null ? m.review_leftover_title_plain() : m.review_leftover_title({ goal: item.label });
    const from = accountOf(lookup, payload.fromAccountId)?.displayName;
    const to = accountOf(lookup, payload.toAccountId)?.displayName;
    subtitle = from === undefined || to === undefined ? m.review_leftover_no_accounts() : `${from} → ${to}`;
    amount = (
      <Money
        minor={payload.amountMinor}
        currency={currencyOf(lookup, payload.fromAccountId)}
        context="amount"
        locale={locale}
      />
    );
    tile = (
      <IconTile>
        <ArrowLeftRight />
      </IconTile>
    );
  } else {
    const category = lookup.categories.find((candidate) => candidate.id === payload.categoryId);
    const name = category === undefined ? m.review_untitled() : categoryName(category);
    title =
      payload.deltaMinor < 0n
        ? m.review_rollover_over_title({ category: name })
        : m.review_rollover_title({ category: name });
    subtitle = m.review_rollover_subtitle();
    amount = <Money minor={payload.deltaMinor} currency={lookup.baseCurrency} context="amount" locale={locale} />;
    tile =
      category === undefined ? (
        <IconTile>
          <Tag />
        </IconTile>
      ) : (
        <CategoryIcon icon={category.icon} color={category.color} />
      );
  }
  return (
    <article aria-label={title} data-review-item={item.id} className={CARD}>
      <CardHead tile={tile} title={title} subtitle={subtitle} amount={amount} date={null} />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" disabled={pending} onClick={onIgnore}>
          {m.review_ignore()}
        </Button>
        <Button size="sm" pending={pending} onClick={onApply}>
          {m.review_apply()}
        </Button>
      </div>
    </article>
  );
}
