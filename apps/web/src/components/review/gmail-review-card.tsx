// SPDX-License-Identifier: AGPL-3.0-only
import type { ReviewEdits } from '@wf/db/review';
import type { GmailReviewItem } from './review-model.ts';
import type { Locale } from '@wf/domain/money';
import type { LocalDate } from '@wf/domain/period';
import { zonedInstant } from '@wf/domain/recurrence';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { formatDate, toLocalDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { usePrivacy } from '@wf/ui/privacy';
import { CircleAlert, Mail } from 'lucide-react';
import { useState } from 'react';
import { Button, Field, INPUT_FRAME, TextInput } from '../form.tsx';
import { AccountPicker, AccountTrigger } from '../ledger/account-picker.tsx';
import { CategorySelect } from '../ledger/category-picker.tsx';
import { DateTimeField } from '../ledger/date-time-field.tsx';
import { wallTime } from '../ledger/transaction-draft.ts';
import { CARD, CardHead, IconTile, NOTE, type ReviewLookup } from './review-cards.tsx';

/** Below this the AI's confidence in a field is called out; above it the field reads like any other. */
const SURE = 90;

/** The AI's confidence in one field, beside its label: quiet when sure, amber when it needs a look. */
function Confidence({ percent }: { percent: number }) {
  return (
    <span className={`font-mono text-[11.5px] ${percent < SURE ? 'text-amber-fg' : 'text-subtle'}`}>
      {m.gmail_confidence({ percent })}
    </span>
  );
}

/**
 * One AI reading of a transaction email, laid out like the record form (title, amount, when, account, category) with
 * its pickers: nothing is recorded until "Catat", even at 100%. The email is data, never executable markup.
 */
export function GmailReviewCard({
  item,
  lookup,
  locale,
  timeZone,
  today,
  pending,
  onConfirm,
  onIgnore,
}: {
  item: GmailReviewItem;
  lookup: ReviewLookup;
  locale: Locale;
  timeZone: string;
  today: LocalDate;
  pending: boolean;
  /** Every value is known and corrected by the user; the title (merchant) is never blank. */
  onConfirm: (
    edits: Required<Pick<ReviewEdits, 'amountMinor' | 'occurredAt' | 'accountId' | 'categoryId'>> & {
      readonly merchant: string;
    },
  ) => void;
  onIgnore: () => void;
}) {
  const { extraction, from, subject } = item.payload;
  const { confidence } = extraction;
  const { hidden, hiddenLabel } = usePrivacy();
  const [amount, setAmount] = useState(extraction.amountMinor);
  const [accountId, setAccountId] = useState(extraction.accountId);
  const [categoryId, setCategoryId] = useState(extraction.categoryId);
  const [merchant, setMerchant] = useState(extraction.merchant ?? '');
  const [when, setWhen] = useState<{ readonly date: LocalDate; readonly time: string } | null>(() =>
    extraction.occurredAt === null
      ? null
      : { date: toLocalDate(extraction.occurredAt, timeZone), time: wallTime(extraction.occurredAt, timeZone) },
  );
  const account = lookup.accounts.find((entry) => entry.id === accountId);
  const currency = account?.currency ?? extraction.currency ?? lookup.baseCurrency;
  // Like the server: an account the user picked corrects a mistaken AI currency; the untouched suggestion must match it.
  const currencyMismatch =
    account !== undefined &&
    accountId === extraction.accountId &&
    extraction.currency !== null &&
    account.currency !== extraction.currency;
  let occurredAt: Date | null;
  try {
    occurredAt = when === null ? null : zonedInstant(when.date, when.time, timeZone);
  } catch {
    occurredAt = null;
  }
  const title = merchant.trim();
  const missing = {
    amount: amount === null || amount <= 0n,
    title: title === '',
    when: occurredAt === null,
    account: account === undefined || currencyMismatch,
    category: categoryId === null,
  };
  const edits =
    !Object.values(missing).some(Boolean) && amount !== null && account !== undefined && categoryId !== null
      ? { amountMinor: amount, accountId: account.id, categoryId, merchant: title, occurredAt: occurredAt as Date }
      : null;

  return (
    <article aria-label={item.label} data-review-item={item.id} className={CARD}>
      <CardHead
        tile={
          <IconTile>
            <Mail />
          </IconTile>
        }
        title={hidden ? hiddenLabel : title || subject}
        subtitle={hidden ? hiddenLabel : from}
        amount={amount === null ? '—' : <Money minor={amount} currency={currency} context="amount" locale={locale} />}
        date={
          when === null
            ? null
            : `${formatDate(when.date, locale, 'day')} ${when.time.replace(':', locale === 'id' ? '.' : ':')}`
        }
      />
      {item.payload.errorCode === null && !currencyMismatch ? null : (
        <p role="status" className={NOTE}>
          <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-amber-fg" />
          {currencyMismatch ? m.ledger_error_invalid_account() : m.gmail_missing_fields()}
        </p>
      )}
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          // The Record button confirms (also on Enter, which clicks it); the page never navigates.
          event.preventDefault();
        }}
      >
        <Field label={m.record_description()} aside={<Confidence percent={confidence.merchant} />}>
          {({ id }) => (
            <TextInput
              id={id}
              value={hidden ? hiddenLabel : merchant}
              disabled={hidden}
              required
              maxLength={200}
              placeholder={m.record_description_placeholder()}
              aria-invalid={missing.title}
              onChange={(event) => {
                setMerchant(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={m.review_amount_label()} aside={<Confidence percent={confidence.amount} />}>
          {({ id }) => (
            // Framed like the other fields; red while the amount is still unknown.
            <span className={`${INPUT_FRAME.lg} ${missing.amount ? 'border-red' : ''}`}>
              {hidden ? (
                <Money minor={amount ?? 0n} currency={currency} context="amount" locale={locale} />
              ) : (
                <AmountInput
                  id={id}
                  size="inline"
                  value={amount}
                  onValueChange={setAmount}
                  currency={currency}
                  locale={locale}
                  aria-invalid={missing.amount}
                />
              )}
            </span>
          )}
        </Field>
        <Field label={m.gmail_date_time()} aside={<Confidence percent={confidence.date} />}>
          {({ id }) => (
            <DateTimeField
              id={id}
              size="lg"
              date={when?.date ?? today}
              time={when?.time ?? wallTime(new Date(), timeZone)}
              onChange={setWhen}
              today={today}
              timeZone={timeZone}
              locale={locale}
              {...(when === null ? { triggerLabel: m.review_ai_unknown() } : {})}
            />
          )}
        </Field>
        <Field label={m.record_account()} aside={<Confidence percent={confidence.account} />}>
          {({ id }) => (
            <AccountPicker
              accounts={lookup.accounts}
              value={accountId}
              onValueChange={setAccountId}
              label={m.record_account_placeholder()}
              searchPlaceholder={m.record_account_search()}
              locale={locale}
            >
              <AccountTrigger
                id={id}
                aria-invalid={missing.account}
                account={account}
                placeholder={m.record_account_placeholder()}
              />
            </AccountPicker>
          )}
        </Field>
        <Field label={m.review_category_label()} aside={<Confidence percent={confidence.category} />}>
          {({ id }) => (
            <CategorySelect
              id={id}
              categories={lookup.categories}
              kind="expense"
              value={categoryId}
              onValueChange={setCategoryId}
              label={m.review_category_pick()}
              searchPlaceholder={m.category_picker_search()}
              placeholder={m.review_category_pick()}
              aria-invalid={missing.category}
              className="h-[42px] w-full rounded-[9px] px-3 text-[14px]"
            />
          )}
        </Field>
        <div className="flex items-end justify-end gap-2">
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
        <p className="mt-2 break-words text-fg">{hidden ? hiddenLabel : `${from} · ${subject}`}</p>
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
