// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Record Transaction form body (FR-T2–T4, T8; design `airjf`, `PKtGi`, `qB5s3`): type, amount with chips,
 * category tiles, account, date and time, description, tags, a private note, the insufficient-balance warning, and
 * the balance impact (FR-T3). {@link TransactionFormFields} renders the fields of a {@link useTransactionForm}
 * state, for hosts that place their own actions (the sheet pins them in its footer); {@link TransactionForm} is
 * the self-contained form with "Batal" / "Simpan" for detail panels (create or edit).
 */
import type { Locale } from '@wf/domain/money';
import type { LocalDate } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { AmountInput, IDR_QUICK_ADDS } from '@wf/ui/amount-input';
import { Money } from '@wf/ui/money';
import { SegmentedControl } from '@wf/ui/segmented-control';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CircleAlert, Info, Plus, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import type { RecordTransactionInput } from '../../server/fn/transactions-write.ts';
import { Button, Field, FormError } from '../form.tsx';
import { AccountPicker, AccountTrigger } from './account-picker.tsx';
import { CategoryPicker } from './category-picker.tsx';
import { DateTimeField } from './date-time-field.tsx';
import { TagInput } from './tag-input.tsx';
import { balancesAfter, isCrossCurrency, type EntryKind, type TransactionFormValues } from './transaction-draft.ts';
import { ErrorText, TransferFields } from './transfer-fields.tsx';
import { useTransactionForm, type LedgerData, type TransactionFormState } from './use-transaction-form.ts';

export interface TransactionFormFieldsProps {
  readonly form: TransactionFormState;
  readonly data: LedgerData;
  readonly locale: Locale;
  /** The user's time zone (date presets, "Sekarang", the instant saved). */
  readonly timeZone: string;
  readonly today: LocalDate;
  /** FR-T8 "Catat pemasukan dulu" for the short account; the action is left out without it. */
  readonly onRecordIncomeFirst?: (accountId: string) => void;
  /** FR-T8 "Sesuaikan saldo" (reconcile the account); the action is left out without it. */
  readonly onAdjustBalance?: (accountId: string) => void;
}

const KIND_ICON_CLASS: Readonly<Record<EntryKind, string>> = {
  expense: '[&_[data-state=checked]_svg]:text-red-fg',
  income: '[&_[data-state=checked]_svg]:text-green-fg',
  transfer: '[&_[data-state=checked]_svg]:text-blue-fg',
};

export function TransactionFormFields({
  form,
  data,
  locale,
  timeZone,
  today,
  onRecordIncomeFirst,
  onAdjustBalance,
}: TransactionFormFieldsProps) {
  const id = useId();
  const ids = {
    amount: `${id}-amount`,
    category: `${id}-category`,
    toAccount: `${id}-to`,
    rate: `${id}-rate`,
    received: `${id}-received`,
    fee: `${id}-fee`,
  };
  const { values, update, showErrors, figures } = form;
  const [noteOpen, setNoteOpen] = useState(values.note !== '');
  const error = <K extends keyof typeof form.errors>(field: K) => (showErrors ? form.errors[field] : undefined);
  const account = data.accounts.find((candidate) => candidate.id === values.accountId);
  const currency = account?.currency ?? data.baseCurrency;
  const short = form.shortfall;
  const impact = values.type === 'transfer' ? undefined : balancesAfter(values, data.accounts, figures)[0];

  return (
    <>
      <SegmentedControl<EntryKind>
        label={m.record_type_label()}
        fill
        value={values.type}
        onValueChange={(type) => {
          update({ type, categoryId: null, toAccountId: null, receivedMinor: null });
        }}
        options={[
          { value: 'expense', label: m.record_type_expense(), icon: ArrowUpRight },
          { value: 'income', label: m.record_type_income(), icon: ArrowDownLeft },
          { value: 'transfer', label: m.record_type_transfer(), icon: ArrowLeftRight },
        ]}
        className={KIND_ICON_CLASS[values.type]}
      />

      <div
        className={`flex flex-col gap-2 rounded-[12px] border bg-input p-4 ${error('amount') === undefined ? 'border-border' : 'border-red'}`}
      >
        <label htmlFor={ids.amount} className={`text-[12.5px] font-medium ${error('amount') === undefined ? 'text-muted-fg' : 'text-red-fg'}`}>
          {isCrossCurrency(values, data.accounts) ? m.record_amount_sent({ currency }) : m.record_amount()}
        </label>
        <AmountInput
          id={ids.amount}
          value={values.amountMinor}
          onValueChange={(minor) => {
            update({ amountMinor: minor, receivedMinor: null });
          }}
          currency={currency}
          locale={locale}
          quickAdds={currency === 'IDR' ? IDR_QUICK_ADDS : []}
          autoFocus
          aria-invalid={error('amount') !== undefined}
          aria-describedby={error('amount') === undefined ? undefined : `${ids.amount}-error`}
        />
      </div>
      {error('amount') === undefined ? null : <ErrorText id={`${ids.amount}-error`}>{m.record_error_amount()}</ErrorText>}

      {values.type === 'transfer' ? (
        <>
          <TransferFields
            form={form}
            data={data}
            locale={locale}
            timeZone={timeZone}
            ids={ids}
            error={(field) => error(field)}
          />
          <Field label={m.record_date()}>
            {({ id: fieldId }) => (
              <DateTimeField
                id={fieldId}
                date={values.date}
                time={values.time}
                onChange={update}
                today={today}
                timeZone={timeZone}
                locale={locale}
              />
            )}
          </Field>
        </>
      ) : (
        <>
          <CategoryPicker
            heading={values.type === 'income' ? m.record_category_income() : m.record_category()}
            categories={data.categories}
            kind={values.type}
            value={values.categoryId}
            onValueChange={(categoryId) => {
              update({ categoryId });
            }}
            label={values.type === 'income' ? m.record_category_income_pick() : m.record_category_pick()}
            searchPlaceholder={values.type === 'income' ? m.record_category_income_search() : m.category_picker_search()}
            invalid={error('category') !== undefined}
            describedBy={error('category') === undefined ? undefined : ids.category}
          />
          {error('category') === undefined ? null : <ErrorText id={ids.category}>{m.record_error_category()}</ErrorText>}
          <div className="grid grid-cols-2 gap-3">
            <Field label={values.type === 'income' ? m.record_account_income() : m.record_account()} error={error('account') === undefined ? null : m.record_error_account()}>
              {({ id: fieldId, describedBy, invalid }) => (
                <AccountPicker
                  accounts={data.accounts}
                  value={values.accountId}
                  onValueChange={(accountId) => {
                    update({ accountId });
                  }}
                  label={m.record_account_pick()}
                  searchPlaceholder={m.record_account_search()}
                  locale={locale}
                  outflowMinor={values.type === 'expense' ? values.amountMinor : null}
                >
                  <AccountTrigger
                    id={fieldId}
                    account={account}
                    placeholder={m.record_account_placeholder()}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                  />
                </AccountPicker>
              )}
            </Field>
            <Field label={m.record_date()}>
              {({ id: fieldId }) => (
                <DateTimeField
                  id={fieldId}
                  date={values.date}
                  time={values.time}
                  onChange={update}
                  today={today}
                  timeZone={timeZone}
                  locale={locale}
                />
              )}
            </Field>
          </div>
        </>
      )}

      {short === null ? null : (
        <div role="status" className="flex flex-col gap-2 rounded-[10px] border border-amber bg-amber-tint-1 p-3 text-[12.5px]">
          <p className="flex items-start gap-2 font-medium text-amber-fg">
            <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <span>
              {m.record_short_title({ account: short.account.displayName })}{' '}
              <Money minor={short.shortMinor} currency={short.account.currency} context="amount" locale={locale} />
            </span>
          </p>
          <p className="pl-[22px] text-text-secondary">
            {m.record_short_recorded()}{' '}
            <Money minor={short.account.balanceMinor} currency={short.account.currency} context="amount" locale={locale} />
            {', '}
            {values.type === 'transfer' ? m.record_short_transfer() : m.record_short_expense()}{' '}
            <Money minor={short.outflowMinor} currency={short.account.currency} context="amount" locale={locale} />
            {'. '}
            {m.record_short_hint()}
          </p>
          {onRecordIncomeFirst === undefined && onAdjustBalance === undefined ? null : (
            <div className="flex gap-2 pl-[22px]">
              {onRecordIncomeFirst === undefined ? null : (
                <Button
                  size="sm"
                  onClick={() => {
                    onRecordIncomeFirst(short.account.id);
                  }}
                >
                  {m.record_short_income_first()}
                </Button>
              )}
              {onAdjustBalance === undefined ? null : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    onAdjustBalance(short.account.id);
                  }}
                >
                  {m.record_short_adjust()}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <Field label={m.record_description()}>
        {({ id: fieldId }) => (
          <textarea
            id={fieldId}
            rows={2}
            maxLength={200}
            value={values.description}
            placeholder={m.record_description_placeholder()}
            onChange={(event) => {
              update({ description: event.currentTarget.value });
            }}
            className="w-full min-w-0 resize-none rounded-[9px] border border-border-input bg-input px-3 py-2.5 text-[14px] text-fg outline-none placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        )}
      </Field>

      <Field label={m.record_tags()} aside={<span className="text-[11.5px] text-subtle">{m.record_tags_hint()}</span>}>
        {({ id: fieldId }) => (
          <TagInput
            id={fieldId}
            value={values.tags}
            onValueChange={(tags) => {
              update({ tags });
            }}
            tags={data.tags}
          />
        )}
      </Field>

      {noteOpen ? (
        <Field label={m.record_note()} hint={m.record_note_hint()}>
          {({ id: fieldId, describedBy }) => (
            <textarea
              id={fieldId}
              rows={2}
              maxLength={2000}
              aria-describedby={describedBy}
              value={values.note}
              onChange={(event) => {
                update({ note: event.currentTarget.value });
              }}
              className="w-full min-w-0 resize-none rounded-[9px] border border-border-input bg-input px-3 py-2.5 text-[14px] text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          )}
        </Field>
      ) : (
        <div className="flex items-center gap-2 text-[12.5px] text-muted-fg">
          {m.record_more()}
          <button
            type="button"
            onClick={() => {
              setNoteOpen(true);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-border px-2.5 text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Plus aria-hidden="true" className="size-3.5" />
            {m.record_note_add()}
          </button>
        </div>
      )}

      {impact === undefined ? null : (
        <p className="flex items-center gap-2 rounded-[10px] border border-border bg-surface-2 px-3 py-2.5 text-[12.5px] text-text-secondary">
          <Info aria-hidden="true" className="size-3.5 shrink-0 text-muted-fg" />
          <span>
            {m.record_impact_prefix({ account: impact.account.displayName })}{' '}
            <Money minor={impact.afterMinor} currency={impact.account.currency} context="amount" locale={locale} className="text-fg" />{' '}
            {m.record_impact_suffix()}
          </span>
        </p>
      )}
    </>
  );
}

/** "N isian perlu dilengkapi" (FR-T8), for the host's footer. */
export function ErrorSummary({ form }: { readonly form: TransactionFormState }) {
  const count = Object.keys(form.errors).length;
  if (!form.showErrors || count === 0) return null;
  return (
    <p role="alert" className="flex items-center gap-1.5 text-[12.5px] text-red-fg">
      <CircleAlert aria-hidden="true" className="size-[13px] shrink-0" />
      {m.record_error_summary({ count })}
    </p>
  );
}

export interface TransactionFormProps {
  /** `create` resets to `initial` after saving; `edit` keeps the saved values. */
  readonly mode: 'create' | 'edit';
  readonly initial: TransactionFormValues;
  readonly data: LedgerData;
  readonly locale: Locale;
  readonly timeZone: string;
  readonly today: LocalDate;
  /** Saves the input; resolves to an error message to show, or `null` when saved. */
  readonly onSubmit: (input: RecordTransactionInput) => Promise<string | null>;
  readonly onCancel: () => void;
}

/** The form with its own actions, for detail panels (B5 edit) and other hosts without a pinned footer. */
export function TransactionForm({ mode, initial, data, locale, timeZone, today, onSubmit, onCancel }: TransactionFormProps) {
  const form = useTransactionForm({ initial, data, locale });
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submit = async () => {
    const input = form.prepare({ timeZone, source: 'manual' });
    if (input === null || saving) return;
    setSaving(true);
    setFailure(null);
    const message = await onSubmit(input);
    setSaving(false);
    setFailure(message);
    if (message === null && mode === 'create') form.reset(initial);
  };
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void submit();
        }
      }}
      className="flex flex-col gap-4"
    >
      <TransactionFormFields form={form} data={data} locale={locale} timeZone={timeZone} today={today} />
      {failure === null ? null : <FormError>{failure}</FormError>}
      <div className="flex items-center gap-2">
        <ErrorSummary form={form} />
        <span className="flex-1" />
        <Button variant="secondary" onClick={onCancel}>
          {m.record_cancel()}
        </Button>
        <Button type="submit" pending={saving}>
          {mode === 'edit' ? m.record_save_changes() : form.shortfall === null ? m.record_save() : m.record_save_anyway()}
        </Button>
      </div>
    </form>
  );
}
