// SPDX-License-Identifier: AGPL-3.0-only
import type { ReviewEdits } from '@wf/db/review';
import type { GmailReviewItem } from './review-model.ts';
import type { Locale } from '@wf/domain/money';
import { parseLocalDate } from '@wf/domain/period';
import { zonedInstant } from '@wf/domain/recurrence';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { toLocalDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { usePrivacy } from '@wf/ui/privacy';
import { useState } from 'react';
import { Button, Field, Select, TextInput } from '../form.tsx';
import { categoryName } from '../../lib/ledger-labels.ts';
import type { ReviewLookup } from './review-cards.tsx';
import { wallTime } from '../ledger/transaction-draft.ts';

/** Explicit correction and confirmation, even for a 97% extraction. The email is data, never executable markup. */
export function GmailReviewCard({
  item,
  lookup,
  locale,
  timeZone,
  pending,
  onConfirm,
  onIgnore,
}: {
  item: GmailReviewItem;
  lookup: ReviewLookup;
  locale: Locale;
  timeZone: string;
  pending: boolean;
  /** Every value is known and corrected by the user; the merchant is never blank. */
  onConfirm: (
    edits: Required<Pick<ReviewEdits, 'amountMinor' | 'occurredAt' | 'accountId' | 'categoryId'>> & {
      readonly merchant: string;
    },
  ) => void;
  onIgnore: () => void;
}) {
  const { extraction } = item.payload;
  const { hidden, hiddenLabel } = usePrivacy();
  const [amount, setAmount] = useState(extraction.amountMinor);
  const [accountId, setAccountId] = useState(extraction.accountId ?? '');
  const [categoryId, setCategoryId] = useState(extraction.categoryId ?? '');
  const [merchant, setMerchant] = useState(extraction.merchant ?? '');
  const [date, setDate] = useState(() =>
    extraction.occurredAt === null
      ? ''
      : `${toLocalDate(extraction.occurredAt, timeZone)}T${wallTime(extraction.occurredAt, timeZone)}`,
  );
  const account = lookup.accounts.find((account) => account.id === accountId);
  const currency = account?.currency ?? extraction.currency ?? lookup.baseCurrency;
  // Like the server: an account the user picked corrects a mistaken AI currency; the untouched suggestion must match it.
  const currencyMismatch =
    account !== undefined &&
    accountId === extraction.accountId &&
    extraction.currency !== null &&
    account.currency !== extraction.currency;
  let occurredAt: Date | null;
  try {
    occurredAt = date === '' ? null : zonedInstant(parseLocalDate(date.slice(0, 10)), date.slice(11, 16), timeZone);
  } catch {
    occurredAt = null;
  }
  const edits =
    amount !== null &&
    amount > 0n &&
    account !== undefined &&
    !currencyMismatch &&
    categoryId !== '' &&
    merchant.trim() !== '' &&
    occurredAt !== null
      ? { amountMinor: amount, accountId, categoryId, merchant: merchant.trim(), occurredAt }
      : null;
  return (
    <article
      aria-label={item.label}
      data-review-item={item.id}
      className="flex min-w-0 flex-col gap-3 rounded-[12px] border border-border bg-surface-2 p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-fg">{hidden ? hiddenLabel : item.payload.subject}</h3>
        <span className="text-[12px] text-muted-fg">{m.review_source_gmail()}</span>
      </header>
      <p className="text-[12px] text-muted-fg">{m.review_ai_footer()}</p>
      {item.payload.errorCode === null ? null : (
        <p role="status" className="text-[12px] text-amber-fg">
          {m.gmail_missing_fields()}
        </p>
      )}
      {currencyMismatch ? (
        <p role="status" className="text-[12px] text-amber-fg">
          {m.ledger_error_invalid_account()}
        </p>
      ) : null}
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          // The Record button confirms (also on Enter, which clicks it); the page never navigates.
          event.preventDefault();
        }}
      >
        <Field label={`${m.review_amount_label()} · ${m.gmail_confidence({ percent: extraction.confidence.amount })}`}>
          {(control) =>
            hidden ? (
              <Money minor={amount ?? 0n} currency={currency} context="amount" locale={locale} />
            ) : (
              <AmountInput
                id={control.id}
                value={amount}
                onValueChange={setAmount}
                currency={currency}
                locale={locale}
              />
            )
          }
        </Field>
        <Field
          label={`${m.gmail_date_time()} (${timeZone}) · ${m.gmail_confidence({ percent: extraction.confidence.date })}`}
        >
          {(control) => (
            <TextInput
              id={control.id}
              type="datetime-local"
              value={date}
              required
              onChange={(event) => {
                setDate(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={`${m.review_ai_merchant()} · ${m.gmail_confidence({ percent: extraction.confidence.merchant })}`}>
          {(control) => (
            <TextInput
              id={control.id}
              value={hidden ? hiddenLabel : merchant}
              disabled={hidden}
              required
              maxLength={200}
              onChange={(event) => {
                setMerchant(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={`${m.record_account()} · ${m.gmail_confidence({ percent: extraction.confidence.account })}`}>
          {(control) => (
            <Select
              id={control.id}
              value={accountId}
              required
              onChange={(event) => {
                setAccountId(event.target.value);
              }}
            >
              <option value="">{m.record_account_pick()}</option>
              {lookup.accounts
                .filter((account) => account.status === 'active')
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.displayName} · {account.currency}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field
          label={`${m.review_category_label()} · ${m.gmail_confidence({ percent: extraction.confidence.category })}`}
        >
          {(control) => (
            <Select
              id={control.id}
              value={categoryId}
              required
              onChange={(event) => {
                setCategoryId(event.target.value);
              }}
            >
              <option value="">{m.review_category_pick()}</option>
              {lookup.categories
                .filter((category) => category.kind === 'expense' && category.archivedAt === null)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {categoryName(category)}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <p className="self-center text-[12px] text-muted-fg">
          {currency} · {m.gmail_confidence({ percent: extraction.confidence.currency })}
        </p>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" disabled={pending} onClick={onIgnore}>
            {m.review_ignore()}
          </Button>
          <Button
            type="submit"
            pending={pending}
            disabled={edits === null}
            onClick={
              edits === null
                ? undefined
                : () => {
                    onConfirm(edits);
                  }
            }
          >
            {m.review_record()}
          </Button>
        </div>
      </form>
      <details className="min-w-0 rounded-[8px] border border-border px-3 py-2 text-[12px]">
        <summary className="cursor-pointer text-muted-fg">{m.gmail_source()}</summary>
        <p className="break-words text-fg">{hidden ? hiddenLabel : `${item.payload.from} · ${item.payload.subject}`}</p>
        <blockquote className="mt-2 whitespace-pre-line break-words text-muted-fg">
          {hidden ? hiddenLabel : item.payload.excerpt}
        </blockquote>
        <a
          href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(item.payload.messageId)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-blue-fg underline"
        >
          {m.gmail_open()}
        </a>
        <p className="mt-2 text-subtle">{m.gmail_readonly_note()}</p>
      </details>
    </article>
  );
}
