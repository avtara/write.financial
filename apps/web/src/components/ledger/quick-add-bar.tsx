// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Quick Add bar on the Overview (FR-T1, design `UnxJt` "Catat Cepat"): one line — type, amount, category (or
 * the two accounts of a transfer), date, description — confirmed with ↵ through the same `recordTransaction` as the
 * sheet, with the same toast and "Urungkan". Expenses and incomes go to the default quick-entry account. The
 * category is guessed from the description while none was picked ("makan siang" → Makan & Dapur), and an amount
 * typed into the description ("kopi 25rb") fills an empty amount when saving.
 */
import { useRouter } from '@tanstack/react-router';
import { parseMoneyInput, type Locale } from '@wf/domain/money';
import type { LocalDate } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { Tabs, TabsList, TabsTrigger } from '@wf/ui/tabs';
import { toast } from '@wf/ui/toast';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CircleAlert, CornerDownLeft, PenLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { recordTransaction } from '../../server/fn/transactions-write.ts';
import { Button } from '../form.tsx';
import { AccountPicker, AccountTrigger } from './account-picker.tsx';
import { budgetNotes } from '../budget/budget-note.tsx';
import { CategorySelect } from './category-picker.tsx';
import { DateTimeField } from './date-time-field.tsx';
import { announceSaved } from './announce-saved.tsx';
import { RuleSuggestion } from './rule-suggestion.tsx';
import {
  defaultAccountId,
  emptyValues,
  guessCategory,
  wallTime,
  type EntryKind,
  type FormErrors,
} from './transaction-draft.ts';
import { useTransactionForm, type LedgerData } from './use-transaction-form.ts';

export interface QuickAddBarProps {
  readonly data: LedgerData;
  readonly locale: Locale;
  readonly timeZone: string;
  readonly today: LocalDate;
}

/** The one message the bar shows for its first problem (design `p4AWD` "Isi jumlah dulu sebelum menyimpan"). */
function firstError(errors: FormErrors): string | null {
  if (errors.amount !== undefined) return m.quick_add_error_amount();
  if (errors.category !== undefined) return m.record_error_category();
  if (errors.account !== undefined) return m.record_error_account();
  // Never "same account" here: each picker disables the account chosen on the other side.
  if (errors.toAccount !== undefined) return m.record_error_to_account();
  return errors.rate === undefined && errors.received === undefined ? null : m.quick_add_error_rate();
}

export function QuickAddBar({ data, locale, timeZone, today }: QuickAddBarProps) {
  const router = useRouter();
  const start = (type: EntryKind) =>
    emptyValues({
      type,
      accountId: defaultAccountId(data.accounts),
      date: today,
      time: wallTime(new Date(), timeZone),
    });
  const form = useTransactionForm({ initial: start('expense'), data, locale });
  const [picked, setPicked] = useState(false);
  const [saving, setSaving] = useState(false);
  // Set when an amount was taken from the description: saving resumes once the form shows it.
  const resubmit = useRef(false);
  const { values, update } = form;
  const account = data.accounts.find((candidate) => candidate.id === values.accountId);
  const currency = account?.currency ?? data.baseCurrency;
  const live = data.categories.filter((category) => values.type !== 'transfer' && category.kind === values.type);
  const message = form.showErrors ? firstError(form.errors) : null;
  const notes =
    values.type === 'expense'
      ? budgetNotes(data.budget, currency === data.baseCurrency ? (values.amountMinor ?? 0n) : 0n, locale)
      : undefined;

  const submit = async () => {
    if (saving) return;
    // "kopi 25rb": an amount in the description fills an empty amount.
    if (values.amountMinor === null) {
      const words = values.description.trim().split(/\s+/);
      const word = words.findLast(
        (candidate) => /\d/.test(candidate) && parseMoneyInput(candidate, { locale, currency }) !== null,
      );
      if (word !== undefined) {
        const index = words.lastIndexOf(word);
        update({
          amountMinor: parseMoneyInput(word, { locale, currency }),
          description: words.filter((_, at) => at !== index).join(' '),
        });
        resubmit.current = true;
        return;
      }
    }
    const input = form.prepare({ timeZone, source: 'quick' });
    if (input === null) return;
    setSaving(true);
    const result = await recordTransaction({ data: input }).catch(() => null);
    setSaving(false);
    if (result === null || !result.ok) {
      toast({
        tone: 'error',
        title: result === null ? m.record_save_failed() : ledgerErrorMessage(result.code, locale),
      });
      return;
    }
    const category = data.categories.find((candidate) => candidate.id === values.categoryId);
    const amount = input.type === 'transfer' ? input.sentMinor : input.amountMinor;
    announceSaved({
      id: result.value.id,
      label: category === undefined ? m.record_type_transfer() : categoryName(category),
      amountMinor: values.type === 'income' ? amount : -amount,
      currency,
      accountName: account?.displayName,
      locale,
      onChange: () => {
        void router.invalidate();
      },
    });
    void router.invalidate();
    setPicked(false);
    form.reset({ ...start(values.type), date: values.date });
  };
  // Runs after the render that shows the amount taken from the description, with `submit` seeing it.
  useEffect(() => {
    if (!resubmit.current) return;
    resubmit.current = false;
    void submit();
  });

  return (
    // Not a <form>: Radix radios inside a form render hidden inputs with inline styles, which the CSP refuses.
    <div
      role="form"
      aria-label={m.quick_add_label()}
      onKeyDown={(event) => {
        const { target } = event;
        if (event.key === 'Enter' && target instanceof HTMLInputElement && target.getAttribute('role') !== 'combobox') {
          event.preventDefault();
          void submit();
        }
      }}
      className="flex flex-col gap-1.5"
    >
      <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-border bg-card p-2.5">
        {/* Tabs, not a radio group: Radix radios render hidden inputs with inline styles on the server (CSP). */}
        <Tabs
          value={values.type}
          onValueChange={(next) => {
            // Radix reports the value of one of the triggers below.
            const type = next as EntryKind;
            setPicked(false);
            form.reset({
              ...start(type),
              amountMinor: values.amountMinor,
              description: values.description,
              date: values.date,
            });
          }}
        >
          <TabsList label={m.record_type_label()}>
            <TabsTrigger
              value="expense"
              panel={false}
              icon={ArrowUpRight}
              iconClassName="group-data-[state=active]:text-red-fg"
            >
              {m.quick_add_expense()}
            </TabsTrigger>
            <TabsTrigger
              value="income"
              panel={false}
              icon={ArrowDownLeft}
              iconClassName="group-data-[state=active]:text-green-fg"
            >
              {m.quick_add_income()}
            </TabsTrigger>
            <TabsTrigger
              value="transfer"
              panel={false}
              icon={ArrowLeftRight}
              iconClassName="group-data-[state=active]:text-blue-fg"
            >
              {m.record_type_transfer()}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {/* Below 1280 px the amount takes what is left, so "Simpan" stays on the row at 1024 (FR-TB2). */}
        <div
          className={`w-[170px] rounded-[9px] border bg-input px-3 py-[7px] max-xl:w-0 max-xl:min-w-[7.5rem] max-xl:flex-1 ${message === m.quick_add_error_amount() ? 'border-red' : 'border-border-input'}`}
        >
          <AmountInput
            size="inline"
            value={values.amountMinor}
            onValueChange={(amountMinor) => {
              update({ amountMinor, receivedMinor: null });
            }}
            currency={currency}
            locale={locale}
            aria-label={m.record_amount()}
            aria-invalid={message === m.quick_add_error_amount()}
          />
        </div>
        {values.type === 'transfer' ? (
          <>
            <AccountPicker
              accounts={data.accounts}
              value={values.accountId}
              onValueChange={(accountId) => {
                update({ accountId, receivedMinor: null });
              }}
              label={m.record_transfer_pick_from()}
              searchPlaceholder={m.record_transfer_search_from()}
              locale={locale}
              outflowMinor={values.amountMinor}
              disabledId={values.toAccountId}
              disabledReason={m.record_transfer_chosen_as_to()}
            >
              <AccountTrigger
                account={account}
                placeholder={m.record_transfer_from()}
                aria-label={m.record_transfer_from()}
                className="h-9 w-[170px] text-[13px]"
              />
            </AccountPicker>
            <AccountPicker
              accounts={data.accounts}
              value={values.toAccountId}
              onValueChange={(toAccountId) => {
                update({ toAccountId, receivedMinor: null });
              }}
              label={m.record_transfer_pick_to()}
              searchPlaceholder={m.record_transfer_search_to()}
              locale={locale}
              disabledId={values.accountId}
              disabledReason={m.record_transfer_chosen_as_from()}
            >
              <AccountTrigger
                account={data.accounts.find((candidate) => candidate.id === values.toAccountId)}
                placeholder={m.record_transfer_to()}
                aria-label={m.record_transfer_to()}
                className="h-9 w-[170px] text-[13px]"
              />
            </AccountPicker>
          </>
        ) : (
          <CategorySelect
            categories={data.categories}
            kind={values.type}
            value={values.categoryId}
            onValueChange={(categoryId) => {
              setPicked(true);
              update({ categoryId });
            }}
            label={values.type === 'income' ? m.record_category_income_pick() : m.record_category_pick()}
            searchPlaceholder={m.category_picker_search()}
            placeholder={values.type === 'income' ? m.record_category_income() : m.record_category()}
            aria-label={values.type === 'income' ? m.record_category_income() : m.record_category()}
            aria-invalid={message === m.record_error_category()}
            {...(notes === undefined ? {} : { budgetNote: notes })}
            className="h-9 w-[190px] rounded-[9px] px-3 text-[13px]"
          />
        )}
        <div className="w-[150px]">
          <DateTimeField
            size="sm"
            date={values.date}
            time={values.time}
            onChange={update}
            today={today}
            timeZone={timeZone}
            locale={locale}
            {...(values.date === today ? { triggerLabel: m.date_preset_today() } : {})}
          />
        </div>
        {/* FR-TB2: no note on a tablet; the Record sheet (N) has it. */}
        <label className="flex h-9 min-w-[160px] flex-1 items-center gap-2 rounded-[9px] border border-border-input bg-input px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring max-xl:hidden">
          <PenLine aria-hidden="true" className="size-3.5 shrink-0 text-muted-fg" />
          <span className="sr-only">{m.record_description()}</span>
          <input
            value={values.description}
            maxLength={200}
            autoComplete="off"
            placeholder={m.record_description_placeholder()}
            onChange={(event) => {
              const description = event.currentTarget.value;
              const guess = picked ? undefined : guessCategory(description, live, categoryName);
              update({ description, ...(guess === undefined ? {} : { categoryId: guess?.id ?? null }) });
            }}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-subtle"
          />
        </label>
        <Button
          size="sm"
          pending={saving}
          className="h-9"
          onClick={() => {
            void submit();
          }}
        >
          {m.record_save()}
          <CornerDownLeft aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
      <div className="px-0.5">
        <RuleSuggestion
          rules={data.rules}
          subscriptionNames={data.subscriptionNames}
          categories={data.categories}
          values={values}
          categoryIsGuess={!picked}
          onApply={update}
        />
      </div>
      {message === null ? null : (
        <p role="alert" className="flex items-center gap-1.5 px-1 text-[12px] text-red-fg">
          <CircleAlert aria-hidden="true" className="size-[13px] shrink-0" />
          {message}
        </p>
      )}
    </div>
  );
}
