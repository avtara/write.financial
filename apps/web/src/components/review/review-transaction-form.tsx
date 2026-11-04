// SPDX-License-Identifier: AGPL-3.0-only
import type { ReviewEdits } from '@wf/db/review';
import { rateToBase } from '@wf/domain/fx';
import type { Locale } from '@wf/domain/money';
import type { LocalDate } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { toLocalDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { usePrivacy } from '@wf/ui/privacy';
import { useState } from 'react';
import type { RecordTransactionInput } from '../../server/fn/transactions-write.ts';
import { Button, FormError } from '../form.tsx';
import { ErrorSummary, TransactionFormFields } from '../ledger/transaction-form.tsx';
import { emptyValues, ratePair, wallTime, type TransactionFormValues } from '../ledger/transaction-draft.ts';
import { useTransactionForm, type LedgerData, type TransactionFormState } from '../ledger/use-transaction-form.ts';
import type { ReviewLookup } from './review-cards.tsx';
import { draftAmount, dueState, type DraftItem, type GmailReviewItem } from './review-model.ts';

type EditableItem = DraftItem | GmailReviewItem;

function initialValues(
  item: EditableItem,
  data: LedgerData,
  timeZone: string,
  today: LocalDate,
  locale: Locale,
): TransactionFormValues {
  if (item.payload.kind === 'gmail') {
    const e = item.payload.extraction;
    const account = data.accounts.find(
      (entry) => entry.id === e.accountId && (e.currency === null || entry.currency === e.currency),
    );
    return {
      ...emptyValues({
        accountId: account?.id ?? null,
        date: e.occurredAt === null ? today : toLocalDate(e.occurredAt, timeZone),
        time: wallTime(e.occurredAt ?? item.createdAt, timeZone),
      }),
      amountMinor: e.amountMinor,
      categoryId: data.categories.some((entry) => entry.id === e.categoryId && entry.kind === 'expense')
        ? e.categoryId
        : null,
      description: e.merchant ?? '',
      tags: [...item.payload.tags],
    };
  }
  const d = item.payload.draft;
  const { accountId, amountMinor } = draftAmount(d);
  const values = {
    ...emptyValues({
      type: d.type,
      accountId,
      date: toLocalDate(d.occurredAt, timeZone),
      time: wallTime(d.occurredAt, timeZone),
    }),
    amountMinor,
    description: d.description ?? '',
    note: d.note ?? '',
    tags: [...(d.tags ?? [])],
  };
  if (d.type !== 'transfer')
    return {
      ...values,
      categoryId: data.categories.some((entry) => entry.id === d.categoryId && entry.kind === d.type)
        ? d.categoryId
        : null,
    };
  const from = data.accounts.find((entry) => entry.id === d.fromAccountId);
  const to = data.accounts.find((entry) => entry.id === d.toAccountId);
  let manualRate = '';
  if (d.manualRate != null && from !== undefined && to !== undefined && from.currency !== to.currency) {
    const pair = ratePair(from.currency, to.currency, data.baseCurrency);
    try {
      manualRate = rateToBase(pair.base, pair.quote, d.manualRate);
    } catch {
      /* An obsolete rate must be corrected. */
    }
  }
  return {
    ...values,
    toAccountId: d.toAccountId,
    receivedMinor: d.receivedMinor,
    rateMode: d.manualRate == null ? 'reference' : 'manual',
    manualRate: locale === 'id' ? manualRate.replace('.', ',') : manualRate,
    feeMinor: d.fee?.minor ?? null,
    feeCategoryId: data.categories.some((entry) => entry.id === d.fee?.categoryId && entry.kind === 'fee')
      ? (d.fee?.categoryId ?? null)
      : null,
  };
}

/** Only editable fields are forwarded; the server keeps the proposal's source and idempotency key. */
export function reviewEditsFromInput(input: RecordTransactionInput): ReviewEdits {
  const common = {
    occurredAt: input.occurredAt,
    description: input.description ?? null,
    note: input.note ?? null,
    tags: input.tags ?? [],
  };
  return input.type === 'transfer'
    ? {
        ...common,
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        amountMinor: input.sentMinor,
        receivedMinor: input.receivedMinor,
        manualRate: input.manualRate ?? null,
        fee: input.fee ?? null,
      }
    : { ...common, amountMinor: input.amountMinor, accountId: input.accountId, categoryId: input.categoryId };
}

/** Review and transaction-detail editing use the same fields, pickers, validation and balance preview. */
export function ReviewTransactionForm({
  item,
  lookup,
  locale,
  timeZone,
  today,
  pending,
  onConfirm,
  onIgnore,
  onCancel,
  onUnpaid,
}: {
  item: EditableItem;
  lookup: ReviewLookup;
  locale: Locale;
  timeZone: string;
  today: LocalDate;
  pending: boolean;
  onConfirm: (input: RecordTransactionInput) => void;
  onIgnore: () => void;
  onCancel?: (() => void) | undefined;
  onUnpaid?: (() => void) | undefined;
}) {
  const { hidden, hiddenLabel } = usePrivacy();
  const data: LedgerData = {
    ...lookup,
    accounts: lookup.accounts.filter((entry) => entry.status === 'active'),
    categories: lookup.categories.filter((entry) => entry.archivedAt === null),
    tags: lookup.tags ?? [],
    rules: [],
    subscriptionNames: [],
  };
  const [initial] = useState(() => initialValues(item, data, timeZone, today, locale));
  const state = useTransactionForm({ initial, data, locale });
  const [dateChosen, setDateChosen] = useState(
    item.payload.kind !== 'gmail' || item.payload.extraction.occurredAt !== null,
  );
  const [failure, setFailure] = useState<string | null>(null);
  const form: TransactionFormState = {
    ...state,
    update: (patch) => {
      if (patch.date !== undefined || patch.time !== undefined) setDateChosen(true);
      setFailure(null);
      state.update(patch);
    },
  };
  const submit = () => {
    if (pending || hidden) return;
    const input = form.prepare({ timeZone, source: 'manual' });
    if (!dateChosen || (item.payload.kind === 'gmail' && form.values.description.trim() === '')) {
      setFailure(m.gmail_missing_fields());
      return;
    }
    if (input !== null) {
      setFailure(null);
      onConfirm(input);
    }
  };
  const due = item.dueDate === null ? null : dueState(item.dueDate, today);
  return (
    <div
      className="flex min-w-0 flex-col gap-4"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          submit();
        }
      }}
    >
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
        {hidden ? (
          <p className="text-[13px] text-subtle">{hiddenLabel}</p>
        ) : (
          <TransactionFormFields
            form={form}
            data={data}
            locale={locale}
            timeZone={timeZone}
            today={today}
            fixedKind={initial.type}
            dateUnknown={!dateChosen}
            recordImmediately
          />
        )}
        {failure === null ? null : <FormError>{failure}</FormError>}
        {due === null ? null : (
          <p className="text-[12.5px] text-muted-fg">
            {due.kind === 'today'
              ? m.review_due_today()
              : due.kind === 'overdue'
                ? m.review_due_overdue({ days: due.days })
                : m.review_due_upcoming({ days: due.days })}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <ErrorSummary form={form} />
          <span className="flex-1" />
          {onUnpaid === undefined ? null : (
            <Button variant="secondary" onClick={onUnpaid}>
              {m.review_not_yet()}
            </Button>
          )}
          {onCancel === undefined ? null : (
            <Button variant="secondary" onClick={onCancel}>
              {m.record_cancel()}
            </Button>
          )}
          <Button variant="secondary" onClick={onIgnore}>
            {m.review_ignore()}
          </Button>
          <Button pending={pending} disabled={hidden} onClick={submit}>
            {item.payload.kind === 'gmail' ? m.review_record() : m.review_confirm()}
          </Button>
        </div>
      </fieldset>
      {item.payload.kind !== 'gmail' ? (
        item.aiConfidence === null ? null : (
          <p className="text-[12.5px] text-amber-fg">{m.review_ai_confidence({ percent: item.aiConfidence })}</p>
        )
      ) : (
        <details className="min-w-0 rounded-[8px] border border-border px-3 py-2 text-[12px]">
          <summary className="cursor-pointer text-muted-fg">{m.gmail_source()}</summary>
          <p className="mt-2 break-words text-fg">
            {hidden ? hiddenLabel : `${item.payload.from} · ${item.payload.subject}`}
          </p>
          <blockquote className="mt-2 whitespace-pre-line break-words text-muted-fg">
            {hidden ? hiddenLabel : item.payload.excerpt}
          </blockquote>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-[11.5px]">
            {[
              [m.record_amount(), item.payload.extraction.confidence.amount],
              [m.record_date(), item.payload.extraction.confidence.date],
              [m.record_description(), item.payload.extraction.confidence.merchant],
              [m.accounts_form_currency(), item.payload.extraction.confidence.currency],
              [m.record_account(), item.payload.extraction.confidence.account],
              [m.review_category_label(), item.payload.extraction.confidence.category],
            ].map(([label, percent]) => (
              <div key={label}>
                <dt className="text-muted-fg">{label}</dt>
                <dd className="font-mono text-subtle">{m.gmail_confidence({ percent: Number(percent) })}</dd>
              </div>
            ))}
          </dl>
          <a
            href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(item.payload.messageId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block text-blue-fg underline"
          >
            {m.gmail_open()}
          </a>
          <p className="mt-2 text-subtle">{m.gmail_readonly_note()}</p>
        </details>
      )}
      {item.allocations.length === 0 ? null : (
        <div className="flex flex-col gap-1 text-[12.5px] text-muted-fg">
          {item.allocations.map((allocation) => (
            <p key={allocation.goalId}>
              {hidden ? hiddenLabel : allocation.goalName} ·{' '}
              <Money
                minor={allocation.amountMinor}
                currency={
                  lookup.accounts.find(
                    (account) =>
                      item.payload.kind === 'transaction' &&
                      item.payload.draft.type === 'transfer' &&
                      account.id === item.payload.draft.toAccountId,
                  )?.currency ?? lookup.baseCurrency
                }
                context="amount"
                locale={locale}
              />
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
