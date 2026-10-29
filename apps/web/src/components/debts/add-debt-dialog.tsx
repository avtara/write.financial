// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Tambah utang / cicilan" (FR-U1, FR-U3, FR-U5, design `v3Igd`): the kind (Cicilan kartu · Paylater · Cicilan 0% ·
 * KPR · Pinjaman), name, principal, provider, tenor, monthly interest, first installment, and "Bayar dari", with the
 * "SIMULASI DAMPAK" of the draft: the monthly installment, installments ÷ income (healthy ≤ 30%), the saving rate of
 * this month before → after, and net worth before → after. "Cicilan kartu" turns a card expense into a plan instead
 * ({@link ConvertForm}, design `OEZIG`), which is also how the card's "Ubah jadi cicilan" opens this dialog.
 */
import type { AccountView } from '@wf/db/accounts';
import type { DebtView } from '@wf/db/debts';
import {
  DEFAULT_INTEREST_METHOD,
  debtImpact,
  HEALTHY_DEBT_RATIO_BPS,
  installmentSchedule,
  type DebtKind,
  type Installment,
} from '@wf/domain/debt';
import { addMonths, type LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { DatePicker } from '@wf/ui/date-picker';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { SegmentedControl } from '@wf/ui/segmented-control';
import { ArrowRight, Calculator, CircleAlert } from 'lucide-react';
import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { accountTotals } from '../../lib/accounts.ts';
import { existingMonthlyMinor, parseRateBps } from '../../lib/debts.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { createDebt, type DebtsOverview } from '../../server/fn/debts.ts';
import { RichMessage } from '../rich-message.tsx';
import { Button, Field, FormError, INPUT_FRAME, TextInput } from '../form.tsx';
import { AccountPicker, AccountTrigger } from '../ledger/account-picker.tsx';
import { defaultAccountId } from '../ledger/transaction-draft.ts';
import { Modal } from '../modal.tsx';
import { ConvertForm } from './convert-form.tsx';

/** The kinds the form offers, in the design's order. */
const KINDS: readonly DebtKind[] = ['card_installment', 'paylater', 'zero_percent', 'mortgage', 'personal_loan'];
const KIND_LABELS: Readonly<Record<DebtKind, () => string>> = {
  card_installment: m.debts_kind_card_short,
  paylater: m.debts_kind_paylater,
  zero_percent: m.debts_kind_zero,
  mortgage: m.debts_kind_mortgage_short,
  personal_loan: m.debts_kind_loan_short,
};
const MAX_TENOR = 360;

/** What opened the dialog: "Tambah" (any kind) or a card's "Ubah jadi cicilan". */
export interface AddDebtStart {
  readonly kind: DebtKind;
  /** The card of "Ubah jadi cicilan"; the kind cannot change then. */
  readonly cardId?: string;
}

export interface AddDebtDialogProps {
  readonly start: AddDebtStart | null;
  readonly onClose: () => void;
  readonly overview: DebtsOverview;
  readonly locale: Locale;
  readonly onSaved: (debt: DebtView) => void;
}

export function AddDebtDialog({ start, onClose, overview, locale, onSaved }: AddDebtDialogProps) {
  const [kind, setKind] = useState<DebtKind>(start?.kind ?? 'paylater');
  const [opened, setOpened] = useState(start);
  if (opened !== start) {
    setOpened(start);
    if (start !== null) setKind(start.kind);
  }
  const card = kind === 'card_installment';
  const fromCard = start?.cardId !== undefined;
  const cardName = fromCard
    ? overview.cards.find((candidate) => candidate.accountId === start.cardId)?.name
    : undefined;
  return (
    <Modal
      open={start !== null}
      onOpenChange={onClose}
      size="xl"
      title={card ? m.debts_convert_title() : m.debts_add_title()}
      description={card ? m.debts_convert_description({ card: cardName ?? m.debts_kind_card() }) : m.debts_add_draft()}
    >
      {fromCard ? null : (
        <div className="flex flex-col gap-1.5">
          <span aria-hidden="true" className="text-[12.5px] font-medium text-muted-fg">
            {m.debts_add_kind()}
          </span>
          <SegmentedControl
            label={m.debts_add_kind()}
            value={kind}
            onValueChange={setKind}
            options={KINDS.map((option) => ({ value: option, label: KIND_LABELS[option]() }))}
          />
        </div>
      )}
      {card ? (
        <ConvertForm
          cards={overview.cards}
          accounts={overview.accounts.accounts}
          today={overview.today}
          locale={locale}
          {...(start?.cardId === undefined ? {} : { initialCardId: start.cardId })}
          onSaved={onSaved}
          onCancel={onClose}
        />
      ) : (
        <LoanForm kind={kind} overview={overview} locale={locale} onSaved={onSaved} onCancel={onClose} />
      )}
    </Modal>
  );
}

interface LoanDraft {
  readonly name: string;
  readonly principalMinor: bigint | null;
  readonly provider: string;
  readonly tenor: string;
  readonly rate: string;
  readonly firstDue: LocalDate;
  readonly payFromAccountId: string | null;
}

/** Net worth as the Accounts page counts it, plus receivables, minus what non-card debts still owe (FR-U5). */
export function netWorthOf(overview: DebtsOverview): bigint {
  const { baseCurrency } = overview.accounts;
  const active = overview.accounts.accounts.filter((account) => account.status === 'active');
  const owed = overview.debts
    .filter((debt) => debt.kind !== 'card_installment' && debt.currency === baseCurrency)
    .reduce((sum, debt) => sum + debt.remainingPrincipalMinor, 0n);
  return accountTotals(active, baseCurrency).totalMinor + overview.receivables.outstandingMinor - owed;
}

function LoanForm({
  kind,
  overview,
  locale,
  onSaved,
  onCancel,
}: {
  readonly kind: DebtKind;
  readonly overview: DebtsOverview;
  readonly locale: Locale;
  readonly onSaved: (debt: DebtView) => void;
  readonly onCancel: () => void;
}) {
  const { today } = overview;
  const { baseCurrency } = overview.accounts;
  const payable = overview.accounts.accounts.filter(
    (account: AccountView) => account.type !== 'credit_card' && account.type !== 'investment',
  );
  const [draft, setDraft] = useState<LoanDraft>({
    name: '',
    principalMinor: null,
    provider: '',
    tenor: '12',
    rate: '0',
    firstDue: addMonths(today, 1),
    payFromAccountId: defaultAccountId(payable),
  });
  const [showErrors, setShowErrors] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const set = (patch: Partial<LoanDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const account = payable.find((candidate) => candidate.id === draft.payFromAccountId);
  const currency = account?.currency ?? baseCurrency;
  const tenor = /^\d{1,3}$/.test(draft.tenor) ? Number(draft.tenor) : null;
  const rateBps = parseRateBps(draft.rate);
  const errors = {
    name: draft.name.trim() === '' ? m.debts_add_name_required() : null,
    principal: draft.principalMinor === null || draft.principalMinor <= 0n ? m.debts_add_principal_required() : null,
    tenor: tenor === null || tenor < 1 || tenor > MAX_TENOR ? m.debts_add_tenor_invalid() : null,
    rate: rateBps === null ? m.debts_terms_interest_invalid() : null,
    account: account === undefined ? m.debts_add_account_required() : null,
  };
  const valid = Object.values(errors).every((error) => error === null);
  const schedule =
    draft.principalMinor === null || draft.principalMinor <= 0n || errors.tenor !== null || rateBps === null
      ? null
      : installmentSchedule({
          principalMinor: draft.principalMinor,
          tenor: tenor as number,
          monthlyRateBps: rateBps,
          adminFeeMinor: 0n,
          method: DEFAULT_INTEREST_METHOD[kind],
          firstDue: draft.firstDue,
        });

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (!valid) return;
    setPending(true);
    setFailure(null);
    const provider = draft.provider.trim();
    const result = await createDebt({
      data: {
        kind: kind as Exclude<DebtKind, 'card_installment'>,
        name: draft.name.trim(),
        provider: provider === '' ? null : provider,
        principalMinor: draft.principalMinor as bigint,
        tenorMonths: tenor as number,
        monthlyRateBps: rateBps as number,
        adminFeeMinor: 0n,
        firstDueDate: draft.firstDue,
        payFromAccountId: (account as AccountView).id,
      },
    });
    setPending(false);
    if (result.ok) onSaved(result.value);
    else setFailure(ledgerErrorMessage(result.code, locale));
  };
  const error = (key: keyof typeof errors) => (showErrors ? errors[key] : null);

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <Field
        label={m.debts_add_name()}
        error={error('name')}
        hint={m.debts_add_name_hint({
          name: draft.name.trim() === '' ? m.debts_add_name_placeholder() : draft.name.trim(),
          count: tenor ?? 1,
        })}
      >
        {({ id, describedBy, invalid }) => (
          <TextInput
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            value={draft.name}
            maxLength={60}
            autoComplete="off"
            placeholder={m.debts_add_name_placeholder()}
            onChange={(event) => {
              set({ name: event.target.value });
            }}
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={m.debts_add_principal()} error={error('principal')}>
          {({ id, describedBy, invalid }) => (
            <span className={`${INPUT_FRAME.lg} flex items-center gap-2`}>
              <AmountInput
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                size="inline"
                value={draft.principalMinor}
                onValueChange={(principalMinor) => {
                  set({ principalMinor });
                }}
                currency={currency}
                locale={locale}
              />
            </span>
          )}
        </Field>
        <Field label={m.debts_add_provider()}>
          {({ id }) => (
            <TextInput
              id={id}
              value={draft.provider}
              maxLength={40}
              autoComplete="off"
              placeholder={m.debts_add_provider_placeholder()}
              onChange={(event) => {
                set({ provider: event.target.value });
              }}
            />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={m.debts_add_tenor()} error={error('tenor')}>
          {({ id, describedBy, invalid }) => (
            <span className={`${INPUT_FRAME.lg} flex items-center gap-2`}>
              <input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                inputMode="numeric"
                value={draft.tenor}
                onChange={(event) => {
                  set({ tenor: event.target.value });
                }}
                className="w-full min-w-0 bg-transparent font-mono text-[14px] text-fg outline-none"
              />
              <span className="shrink-0 text-[12.5px] text-subtle">{m.debts_add_months()}</span>
            </span>
          )}
        </Field>
        <Field label={m.debts_add_rate()} error={error('rate')}>
          {({ id, describedBy, invalid }) => (
            <span className={`${INPUT_FRAME.lg} flex items-center gap-2`}>
              <input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                inputMode="decimal"
                value={draft.rate}
                onChange={(event) => {
                  set({ rate: event.target.value });
                }}
                className="w-full min-w-0 bg-transparent font-mono text-[14px] text-fg outline-none"
              />
              <span className="shrink-0 text-[12.5px] text-subtle">{m.debts_terms_per_month()}</span>
            </span>
          )}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={m.debts_add_first_due()}>
          {({ id }) => (
            <DatePicker
              id={id}
              value={draft.firstDue}
              onValueChange={(firstDue) => {
                set({ firstDue });
              }}
              placeholder={m.debts_add_first_due()}
              today={today}
              locale={locale}
              labels={{ previousMonth: m.debts_add_previous_month(), nextMonth: m.debts_add_next_month() }}
            />
          )}
        </Field>
        <Field label={m.debts_add_pay_from()} error={error('account')}>
          {({ id, describedBy, invalid }) => (
            <AccountPicker
              accounts={payable}
              value={draft.payFromAccountId}
              onValueChange={(payFromAccountId) => {
                set({ payFromAccountId });
              }}
              label={m.debts_add_pay_from()}
              searchPlaceholder={m.debts_add_account_search()}
              locale={locale}
            >
              <AccountTrigger
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                account={account}
                placeholder={m.debts_add_account_placeholder()}
              />
            </AccountPicker>
          )}
        </Field>
      </div>
      <Simulation schedule={schedule} overview={overview} currency={baseCurrency} locale={locale} />
      {failure === null ? null : <FormError>{failure}</FormError>}
      <div className="flex items-center gap-2 border-t border-border pt-4">
        <span className="flex flex-1 items-center gap-1.5 text-[12px] text-subtle">
          <CircleAlert aria-hidden="true" className="size-3.5" />
          {m.debts_add_hint()}
        </span>
        <Button variant="secondary" onClick={onCancel}>
          {m.debts_cancel()}
        </Button>
        <Button type="submit" pending={pending}>
          {m.debts_add_submit()}
        </Button>
      </div>
    </form>
  );
}

/** "SIMULASI DAMPAK" (FR-U5). */
function Simulation({
  schedule,
  overview,
  currency,
  locale,
}: {
  readonly schedule: readonly Installment[] | null;
  readonly overview: DebtsOverview;
  readonly currency: string;
  readonly locale: Locale;
}) {
  const before = netWorthOf(overview);
  const month = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${overview.today.slice(0, 7)}-01T00:00:00Z`),
  );
  const first = schedule?.[0];
  const last = schedule?.at(-1);
  const impact =
    schedule === null
      ? null
      : debtImpact({
          schedule,
          incomeMinor: overview.month.incomeMinor,
          expenseMinor: overview.month.expenseMinor,
          existingMonthlyMinor: existingMonthlyMinor(overview.debts, currency),
          netWorthMinor: before,
        });
  // The saving rate after, from the amounts rather than the rounded bps: 30,449% shows as 30,4% (v3Igd), not 30,5%.
  const { incomeMinor, expenseMinor } = overview.month;
  const exactAfter =
    impact === null || incomeMinor === 0n
      ? 0
      : Number(incomeMinor - expenseMinor - impact.monthlyMinor) / Number(incomeMinor);
  return (
    <section
      aria-label={m.debts_sim_title()}
      className="flex flex-col gap-3 rounded-[10px] border border-border bg-surface-2 px-4 py-3"
    >
      <h3 className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.06em] text-subtle uppercase">
        <Calculator aria-hidden="true" className="size-3.5" />
        {m.debts_sim_title()}
      </h3>
      {impact === null || first === undefined || last === undefined ? (
        <p className="text-[12.5px] text-muted-fg">{m.debts_sim_empty()}</p>
      ) : (
        <dl className="flex flex-col gap-2.5">
          <Row
            label={m.debts_sim_monthly()}
            note={m.debts_sim_monthly_note({
              count: last.number,
              first: formatDate(first.dueOn, locale, 'date'),
              last: formatDate(last.dueOn, locale, 'date'),
            })}
          >
            {<Money minor={impact.monthlyMinor} currency={currency} context="amount" locale={locale} />}
          </Row>
          <Row
            label={m.debts_sim_ratio()}
            note={
              impact.ratioBps === null ? (
                m.debts_sim_no_income()
              ) : (
                <RichMessage
                  message={m.debts_sim_ratio_note}
                  slots={{
                    income: (
                      <Money minor={overview.month.incomeMinor} currency={currency} context="amount" locale={locale} />
                    ),
                    limit: <Percent value={HEALTHY_DEBT_RATIO_BPS / 10_000} locale={locale} />,
                  }}
                />
              )
            }
          >
            {impact.ratioBps === null ? (
              '—'
            ) : (
              <Percent
                value={impact.ratioBps / 10_000}
                locale={locale}
                className={impact.healthy === true ? 'text-green-fg' : 'text-red-fg'}
              />
            )}
          </Row>
          {impact.savingRateBeforeBps === null ||
          impact.savingRateAfterBps === null ||
          impact.headroomBps === null ? null : (
            <Row
              label={m.debts_sim_saving({ month })}
              note={
                impact.headroomBps >= 0
                  ? m.debts_sim_saving_above({
                      points: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
                        // "Sisa ruang" never overstates the room: tenths of a point, rounded down.
                        Math.floor(impact.headroomBps / 10) / 10,
                      ),
                    })
                  : m.debts_sim_saving_below()
              }
            >
              <span className="flex items-center gap-1.5 text-amber-fg">
                <Percent value={impact.savingRateBeforeBps / 10_000} locale={locale} />
                <ArrowRight aria-hidden="true" className="size-3" />
                <Percent value={exactAfter} locale={locale} />
              </span>
            </Row>
          )}
          <Row label={m.debts_sim_net_worth()} note={m.debts_sim_net_worth_note()}>
            <span className="flex items-center gap-1.5">
              {<Money minor={before} currency={currency} context="amount" locale={locale} />}
              <ArrowRight aria-hidden="true" className="size-3 text-subtle" />
              {<Money minor={impact.netWorthAfterMinor} currency={currency} context="amount" locale={locale} />}
            </span>
          </Row>
        </dl>
      )}
    </section>
  );
}

function Row({
  label,
  note,
  children,
}: {
  readonly label: string;
  readonly note: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="flex min-w-0 flex-col">
        <span className="text-[13px] text-fg">{label}</span>
        <span className="text-[11.5px] text-subtle">{note}</span>
      </dt>
      <dd className="shrink-0 text-right text-[13px] font-medium text-fg">{children}</dd>
    </div>
  );
}
