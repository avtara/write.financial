// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Catat piutang" (FR-U7, design H7g1A): who (with the people lent to before), amount, from account, date, due date
 * (1 minggu · 2 minggu · Akhir bulan · Tanpa tenggat), note, the H-1 reminder to the user only, and "SETELAH
 * DISIMPAN": the account's balance drops, receivables grow, the month's spending and net worth stay. Saved through
 * `recordReceivable` as a loan (a transfer to the receivable, not an expense); one client id per opened dialog.
 */
import type { AccountView } from '@wf/db/accounts';
import type { ReceivableView } from '@wf/db/receivables';
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { dueDateFor, type DuePreset } from '@wf/domain/receivables';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { DatePicker } from '@wf/ui/date-picker';
import { Switch } from '@wf/ui/switch';
import { CircleAlert, UserRound } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { dateLabel, lendingAccounts, momentOf, reminderClock } from '../../lib/receivables.ts';
import type { DebtsOverview } from '../../server/fn/debts.ts';
import { recordReceivable } from '../../server/fn/receivables.ts';
import { monthName } from '../dashboard/dashboard-format.ts';
import { Button, Field, FormError, INPUT_FRAME, TextInput } from '../form.tsx';
import { AccountPicker, AccountTrigger } from '../ledger/account-picker.tsx';
import { defaultAccountId } from '../ledger/transaction-draft.ts';
import { Modal } from '../modal.tsx';
import { netWorthOf } from './add-debt-dialog.tsx';
import { AfterPreview, type AfterRow } from './after-preview.tsx';
import { DuePresetChips } from './due-preset-chips.tsx';

/** People named in "pernah: …". */
const SUGGESTED_PEOPLE = 3;

interface Draft {
  readonly clientId: string;
  readonly counterparty: string;
  readonly amountMinor: bigint | null;
  readonly fromAccountId: string | null;
  readonly date: LocalDate;
  readonly due: DuePreset;
  readonly note: string;
  readonly remind: boolean;
}

export interface RecordReceivableDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly overview: DebtsOverview;
  readonly locale: Locale;
  readonly onSaved: (receivable: ReceivableView) => void;
}

export function RecordReceivableDialog({ open, onClose, overview, locale, onSaved }: RecordReceivableDialogProps) {
  return (
    <Modal
      open={open}
      onOpenChange={onClose}
      size="lg"
      title={m.receivables_record_title()}
      description={m.receivables_record_description()}
    >
      <RecordForm overview={overview} locale={locale} onSaved={onSaved} onCancel={onClose} />
    </Modal>
  );
}

function RecordForm({
  overview,
  locale,
  onSaved,
  onCancel,
}: {
  readonly overview: DebtsOverview;
  readonly locale: Locale;
  readonly onSaved: (receivable: ReceivableView) => void;
  readonly onCancel: () => void;
}) {
  const { today, timeZone } = overview;
  const { baseCurrency } = overview.accounts;
  const accounts = lendingAccounts(overview.accounts.accounts);
  const [draft, setDraft] = useState<Draft>(() => ({
    clientId: crypto.randomUUID(),
    counterparty: '',
    amountMinor: null,
    fromAccountId: defaultAccountId(accounts),
    date: today,
    due: 'end_of_month',
    note: '',
    remind: true,
  }));
  const [showErrors, setShowErrors] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const account = accounts.find((candidate) => candidate.id === draft.fromAccountId);
  const currency = account?.currency ?? baseCurrency;
  const dueDate = dueDateFor(draft.due, draft.date);
  const remind = draft.remind && dueDate !== null;
  const errors = {
    who: draft.counterparty.trim() === '' ? m.receivables_record_who_required() : null,
    amount: draft.amountMinor === null || draft.amountMinor <= 0n ? m.receivables_record_amount_required() : null,
    account: account === undefined ? m.receivables_account_required() : null,
  };
  const error = (key: keyof typeof errors) => (showErrors ? errors[key] : null);
  const time = reminderClock(overview.reminderTime, locale);
  const people = overview.receivables.people.slice(0, SUGGESTED_PEOPLE);
  const amount = draft.amountMinor ?? 0n;
  const netWorth = netWorthOf(overview);

  /** "SETELAH DISIMPAN". */
  const rows: AfterRow[] = [
    ...(account === undefined
      ? []
      : [
          {
            label: m.receivables_after_balance({ account: account.displayName }),
            beforeMinor: account.balanceMinor,
            afterMinor: account.balanceMinor - amount,
          },
        ]),
    {
      label: m.receivables_after_receivables(),
      beforeMinor: overview.receivables.outstandingMinor,
      afterMinor: overview.receivables.outstandingMinor + amount,
    },
    {
      label: m.receivables_after_expense({
        month: monthName(overview.today.slice(0, 7) as YearMonth, locale, 'long'),
      }),
      beforeMinor: overview.month.expenseMinor,
      afterMinor: null,
    },
    { label: m.receivables_after_net_worth(), beforeMinor: netWorth, afterMinor: null },
  ];

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (Object.values(errors).some((message) => message !== null)) return;
    setPending(true);
    setFailure(null);
    const note = draft.note.trim();
    const result = await recordReceivable({
      data: {
        clientId: draft.clientId,
        counterparty: draft.counterparty.trim(),
        amountMinor: draft.amountMinor as bigint,
        fromAccountId: (account as AccountView).id,
        lentAt: momentOf(draft.date, today, timeZone),
        dueDate,
        remind,
        note: note === '' ? null : note,
      },
    });
    setPending(false);
    if (result.ok) onSaved(result.value);
    else setFailure(ledgerErrorMessage(result.code, locale));
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-3.5">
      <Field
        label={m.receivables_record_who()}
        error={error('who')}
        aside={
          people.length === 0 ? null : (
            <span className="flex flex-wrap items-center gap-1 text-[11px] text-subtle">
              {m.receivables_record_who_before()}
              {people.map((person, index) => (
                <span key={person} className="flex items-center gap-1">
                  {index === 0 ? null : <span aria-hidden="true">·</span>}
                  <button
                    type="button"
                    onClick={() => {
                      set({ counterparty: person });
                    }}
                    className="rounded-[4px] hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {person}
                  </button>
                </span>
              ))}
            </span>
          )
        }
      >
        {({ id, describedBy, invalid }) => (
          <span className={`${INPUT_FRAME.lg} gap-2`}>
            <UserRound aria-hidden="true" className="size-3.5 shrink-0 text-muted-fg" />
            <input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={draft.counterparty}
              maxLength={60}
              autoComplete="off"
              list={`${id}-people`}
              placeholder={m.receivables_record_who_placeholder()}
              onChange={(event) => {
                set({ counterparty: event.target.value });
              }}
              className="w-full min-w-0 bg-transparent text-[14px] text-fg outline-none placeholder:text-subtle"
            />
            <datalist id={`${id}-people`}>
              {overview.receivables.people.map((person) => (
                <option key={person} value={person} />
              ))}
            </datalist>
          </span>
        )}
      </Field>
      <Field label={m.receivables_record_amount()} error={error('amount')}>
        {({ id, describedBy, invalid }) => (
          <span className={`${INPUT_FRAME.lg} h-[46px]`}>
            <AmountInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              size="inline"
              value={draft.amountMinor}
              onValueChange={(amountMinor) => {
                set({ amountMinor });
              }}
              currency={currency}
              locale={locale}
            />
          </span>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={m.receivables_record_from()} error={error('account')}>
          {({ id, describedBy, invalid }) => (
            <AccountPicker
              accounts={accounts}
              value={draft.fromAccountId}
              onValueChange={(fromAccountId) => {
                set({ fromAccountId });
              }}
              label={m.receivables_record_from()}
              searchPlaceholder={m.receivables_account_search()}
              locale={locale}
              outflowMinor={amount}
            >
              <AccountTrigger
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                account={account}
                placeholder={m.receivables_account_placeholder()}
              />
            </AccountPicker>
          )}
        </Field>
        <Field label={m.receivables_date()}>
          {({ id }) => (
            <DatePicker
              id={id}
              value={draft.date}
              onValueChange={(date) => {
                set({ date });
              }}
              placeholder={m.receivables_date()}
              today={today}
              disableFuture
              triggerLabel={dateLabel(draft.date, today, locale)}
              locale={locale}
              labels={{ previousMonth: m.receivables_previous_month(), nextMonth: m.receivables_next_month() }}
            />
          )}
        </Field>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between text-[12.5px] font-medium text-muted-fg">
          {m.receivables_record_due()}
          <span className="text-[11px] font-normal text-subtle">{m.receivables_optional()}</span>
        </span>
        <DuePresetChips
          value={draft.due}
          onChange={(due) => {
            set({ due });
          }}
          from={draft.date}
          locale={locale}
          label={m.receivables_record_due()}
        />
      </div>
      <Field
        label={m.receivables_record_note()}
        aside={<span className="text-[11px] text-subtle">{m.receivables_optional()}</span>}
      >
        {({ id }) => (
          <TextInput
            id={id}
            value={draft.note}
            maxLength={500}
            autoComplete="off"
            placeholder={m.receivables_record_note_placeholder()}
            onChange={(event) => {
              set({ note: event.target.value });
            }}
          />
        )}
      </Field>
      <Switch
        label={m.receivables_remind({ time })}
        description={m.receivables_remind_note()}
        checked={remind}
        disabled={dueDate === null}
        onChange={(event) => {
          set({ remind: event.currentTarget.checked });
        }}
      />
      <AfterPreview currency={currency} locale={locale} rows={rows} />
      {failure === null ? null : <FormError>{failure}</FormError>}
      <div className="flex items-center gap-2 border-t border-border pt-4">
        <span className="flex flex-1 items-center gap-1.5 text-[11.5px] text-subtle">
          <CircleAlert aria-hidden="true" className="size-3.5" />
          {m.receivables_record_hint()}
        </span>
        <Button variant="secondary" onClick={onCancel}>
          {m.receivables_cancel()}
        </Button>
        <Button type="submit" pending={pending}>
          {m.receivables_record_submit()}
        </Button>
      </div>
    </form>
  );
}
