// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Terima pembayaran" (FR-U7, design ivnWw): the amount received with "Lunas · Rp300.000" and partial chips, the
 * account it came into (the account it was lent from by default), the date, and "SETELAH DISIMPAN": what is left,
 * the account's balance, the month's income unchanged (an incoming transfer, not income), and the repaid share.
 * Saved through `receiveReceivablePayment`; one client id per opened dialog.
 */
import type { AccountView } from '@wf/db/accounts';
import type { ReceivableView } from '@wf/db/receivables';
import { safeDailyStepMinor } from '@wf/domain/budget';
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { receivePayment } from '@wf/domain/receivables';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { DatePicker } from '@wf/ui/date-picker';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { CircleAlert } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { dateLabel, lendingAccounts, momentOf, partialChips } from '../../lib/receivables.ts';
import type { DebtsOverview } from '../../server/fn/debts.ts';
import { receiveReceivablePayment } from '../../server/fn/receivables.ts';
import { BudgetBar } from '../budget/budget-bar.tsx';
import { monthName } from '../dashboard/dashboard-format.ts';
import { Button, Field, FormError, INPUT_FRAME } from '../form.tsx';
import { AccountPicker, AccountTrigger } from '../ledger/account-picker.tsx';
import { Modal } from '../modal.tsx';
import { RichMessage } from '../rich-message.tsx';
import { AfterPreview, type AfterRow } from './after-preview.tsx';

export interface ReceivePaymentDialogProps {
  /** The receivable being paid; `null` = closed. */
  readonly receivable: ReceivableView | null;
  readonly onClose: () => void;
  readonly overview: DebtsOverview;
  readonly locale: Locale;
  readonly onSaved: (receivable: ReceivableView) => void;
}

export function ReceivePaymentDialog({ receivable, onClose, overview, locale, onSaved }: ReceivePaymentDialogProps) {
  return (
    <Modal
      open={receivable !== null}
      onOpenChange={onClose}
      size="lg"
      title={m.receivables_receive_title({ name: receivable?.counterparty ?? '' })}
      description={
        receivable === null ? undefined : (
          <RichMessage
            message={
              receivable.dueDate === null ? m.receivables_receive_description : m.receivables_receive_description_due
            }
            slots={{
              remaining: (
                <Money
                  minor={receivable.remainingMinor}
                  currency={receivable.currency}
                  context="amount"
                  locale={locale}
                />
              ),
              principal: (
                <Money
                  minor={receivable.principalMinor}
                  currency={receivable.currency}
                  context="amount"
                  locale={locale}
                />
              ),
              date: receivable.dueDate === null ? '' : formatDate(receivable.dueDate, locale, 'day'),
            }}
          />
        )
      }
    >
      {receivable === null ? null : (
        <ReceiveForm receivable={receivable} overview={overview} locale={locale} onSaved={onSaved} onCancel={onClose} />
      )}
    </Modal>
  );
}

function ReceiveForm({
  receivable,
  overview,
  locale,
  onSaved,
  onCancel,
}: {
  readonly receivable: ReceivableView;
  readonly overview: DebtsOverview;
  readonly locale: Locale;
  readonly onSaved: (receivable: ReceivableView) => void;
  readonly onCancel: () => void;
}) {
  const { today, timeZone } = overview;
  const { currency, remainingMinor } = receivable;
  const accounts = lendingAccounts(overview.accounts.accounts).filter((account) => account.currency === currency);
  const [clientId] = useState(() => crypto.randomUUID());
  const [amountMinor, setAmountMinor] = useState<bigint | null>(remainingMinor);
  const [accountId, setAccountId] = useState<string | null>(
    accounts.some((account) => account.id === receivable.fromAccountId)
      ? receivable.fromAccountId
      : (accounts[0]?.id ?? null),
  );
  const [date, setDate] = useState<LocalDate>(today);
  const [showErrors, setShowErrors] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const account = accounts.find((candidate) => candidate.id === accountId);
  const amountError =
    amountMinor === null || amountMinor <= 0n
      ? m.receivables_record_amount_required()
      : amountMinor > remainingMinor
        ? m.receivables_receive_too_much()
        : null;
  const errors = { amount: amountError, account: account === undefined ? m.receivables_account_required() : null };
  const valid = amountError === null;
  const after = valid
    ? receivePayment(
        {
          principalMinor: receivable.principalMinor,
          paymentsMinor: receivable.payments.map((payment) => payment.amountMinor),
          writtenOff: false,
        },
        amountMinor as bigint,
      )
    : null;
  const received = valid ? (amountMinor as bigint) : 0n;
  // "Sisa piutang Raka": the first name.
  const name = receivable.counterparty.replace(/\s.*$/, '');
  const money = (minor: bigint) => <Money minor={minor} currency={currency} context="amount" locale={locale} />;
  const chips = [remainingMinor, ...partialChips(remainingMinor, safeDailyStepMinor(currency))];

  /** "SETELAH DISIMPAN". */
  const rows: AfterRow[] = [
    {
      label: m.receivables_after_remaining({ name }),
      beforeMinor: remainingMinor,
      afterMinor: remainingMinor - received,
    },
    ...(account === undefined
      ? []
      : [
          {
            label: m.receivables_after_balance({ account: account.displayName }),
            beforeMinor: account.balanceMinor,
            afterMinor: account.balanceMinor + received,
          },
        ]),
    {
      label: m.receivables_after_income({ month: monthName(today.slice(0, 7) as YearMonth, locale, 'long') }),
      beforeMinor: overview.month.incomeMinor,
      afterMinor: null,
    },
  ];

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (Object.values(errors).some((message) => message !== null)) return;
    setPending(true);
    setFailure(null);
    const result = await receiveReceivablePayment({
      data: {
        id: receivable.id,
        clientId,
        amountMinor: amountMinor as bigint,
        accountId: (account as AccountView).id,
        receivedAt: momentOf(date, today, timeZone),
      },
    });
    setPending(false);
    if (result.ok) onSaved(result.value);
    else setFailure(ledgerErrorMessage(result.code, locale));
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-3.5">
      <Field label={m.receivables_receive_amount()} error={showErrors ? errors.amount : null}>
        {({ id, describedBy, invalid }) => (
          <span className={`${INPUT_FRAME.lg} h-[46px]`}>
            <AmountInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              size="inline"
              value={amountMinor}
              onValueChange={setAmountMinor}
              currency={currency}
              locale={locale}
            />
          </span>
        )}
      </Field>
      <div role="group" aria-label={m.receivables_receive_chips()} className="-mt-2 flex flex-wrap gap-1.5">
        {chips.map((chip, index) => (
          <button
            key={chip.toString()}
            type="button"
            aria-pressed={chip === amountMinor}
            onClick={() => {
              setAmountMinor(chip);
            }}
            className="rounded-[6px] border border-border px-[9px] py-1 text-[11.5px] font-medium text-muted-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-blue-tint-4 aria-pressed:bg-blue-tint-2 aria-pressed:text-blue-fg"
          >
            {index === 0 ? (
              <RichMessage message={m.receivables_receive_full} slots={{ amount: money(chip) }} />
            ) : (
              money(chip)
            )}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={m.receivables_receive_into()} error={showErrors ? errors.account : null}>
          {({ id, describedBy, invalid }) => (
            <AccountPicker
              accounts={accounts}
              value={accountId}
              onValueChange={setAccountId}
              label={m.receivables_receive_into()}
              searchPlaceholder={m.receivables_account_search()}
              locale={locale}
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
              value={date}
              onValueChange={setDate}
              placeholder={m.receivables_date()}
              today={today}
              disableFuture
              triggerLabel={dateLabel(date, today, locale)}
              locale={locale}
              labels={{ previousMonth: m.receivables_previous_month(), nextMonth: m.receivables_next_month() }}
            />
          )}
        </Field>
      </div>
      <AfterPreview currency={currency} locale={locale} rows={rows}>
        {after === null ? null : (
          <>
            <BudgetBar usedBps={after.progressBps} tone="ok" idealBps={null} className="mt-1" />
            <p className="text-[11.5px] text-subtle">
              {after.remainingMinor === 0n ? (
                m.receivables_receive_settles()
              ) : (
                <RichMessage
                  message={
                    receivable.dueDate === null ? m.receivables_receive_progress : m.receivables_receive_progress_due
                  }
                  slots={{
                    percent: <Percent value={after.progressBps / 10_000} decimals={0} locale={locale} />,
                    remaining: (
                      <Money minor={after.remainingMinor} currency={currency} context="amount" locale={locale} />
                    ),
                    date: receivable.dueDate === null ? '' : formatDate(receivable.dueDate, locale, 'day'),
                  }}
                />
              )}
            </p>
          </>
        )}
      </AfterPreview>
      {failure === null ? null : <FormError>{failure}</FormError>}
      <div className="flex items-center gap-2 border-t border-border pt-4">
        <span className="flex flex-1 items-center gap-1.5 text-[11.5px] text-subtle">
          <CircleAlert aria-hidden="true" className="size-3.5" />
          {m.receivables_receive_hint()}
        </span>
        <Button variant="secondary" onClick={onCancel}>
          {m.receivables_cancel()}
        </Button>
        <Button type="submit" pending={pending}>
          {valid ? (
            <RichMessage message={m.receivables_receive_submit} slots={{ amount: money(received) }} />
          ) : (
            m.receivables_receive()
          )}
        </Button>
      </div>
    </form>
  );
}
