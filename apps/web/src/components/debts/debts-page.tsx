// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Utang & cicilan" (PRD §6.13 FR-R7, FR-U1–U5, design section 18): the header and KPIs, then either "Kamu bebas
 * utang" with the debt types (`exCE7`) or each credit card (summary strip and current bill, `rHTMd`), the active
 * installments with their schedules (`A7ttc`), and the card payment priority. "Tambah utang / cicilan" and "Ubah jadi
 * cicilan" open {@link AddDebtDialog}; "Bayar tagihan" opens the Record sheet on a transfer into the card. Every change
 * reloads the route's data.
 */
import { useRouter } from '@tanstack/react-router';
import type { DebtView } from '@wf/db/debts';
import type { CcPaymentBucket, DebtKind } from '@wf/domain/debt';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { EmptyState } from '@wf/ui/empty-state';
import { toast } from '@wf/ui/toast';
import { Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { cardState, debtKpis } from '../../lib/debts.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { setCardPaymentPriority, type DebtsOverview } from '../../server/fn/debts.ts';
import { Button } from '../form.tsx';
import { useRecordTransaction } from '../ledger/record-transaction.tsx';
import { PageHeader } from '../page-header.tsx';
import { usePreferences } from '../preferences.tsx';
import { AddDebtDialog, type AddDebtStart } from './add-debt-dialog.tsx';
import { CardBillCard, CardStrip } from './card-section.tsx';
import { DebtKpis } from './debt-kpis.tsx';
import { InstallmentCard, KIND_ICONS, KIND_LABELS } from './installment-card.tsx';
import { PriorityPanel } from './priority-panel.tsx';

/** The empty state's debt types with what each one needs (design `deZgU`). */
const TYPES: readonly { readonly kind: DebtKind; readonly note: () => string }[] = [
  { kind: 'card_installment', note: m.debts_type_card_note },
  { kind: 'paylater', note: m.debts_type_paylater_note },
  { kind: 'zero_percent', note: m.debts_type_zero_note },
  { kind: 'mortgage', note: m.debts_type_mortgage_note },
  { kind: 'personal_loan', note: m.debts_type_loan_note },
];

export interface DebtsPageProps {
  readonly overview: DebtsOverview;
  /** `?new` (⌘K): the add dialog opens. */
  readonly initialNew?: boolean;
}

export function DebtsPage({ overview, initialNew = false }: DebtsPageProps) {
  const router = useRouter();
  const record = useRecordTransaction();
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const { today, debts, cards } = overview;
  const { baseCurrency, accounts } = overview.accounts;
  const [start, setStart] = useState<AddDebtStart | null>(initialNew ? { kind: 'paylater' } : null);
  const states = cards.map((card) => ({ card, state: cardState(card, debts, today) }));
  const kpis = debtKpis(
    debts,
    states.map(({ state }) => state),
    today,
    baseCurrency,
  );
  const owing = states.filter(({ state }) => state.status.owedMinor > 0n);
  const empty = debts.length === 0 && owing.length === 0;

  const parts = [
    kpis.installmentCount === 0 ? null : m.debts_description_installments({ count: kpis.installmentCount }),
    kpis.billCount === 0
      ? null
      : kpis.installmentCount === 0
        ? m.debts_kpi_card_bills({ count: kpis.billCount })
        : m.debts_kpi_bills({ count: kpis.billCount }),
  ].filter((part) => part !== null);
  const description = empty
    ? m.debts_description_none()
    : [...parts, m.debts_description_as_of({ date: formatDate(today, locale, 'date') })].join(' · ');

  const saved = (debt: DebtView) => {
    setStart(null);
    toast({ tone: 'success', title: m.debts_saved({ name: debt.name }) });
    void router.invalidate();
  };
  const savePriority = async (priority: CcPaymentBucket[]) => {
    const result = await setCardPaymentPriority({ data: { priority } });
    if (!result.ok) {
      toast({ tone: 'error', title: ledgerErrorMessage(result.code, locale) });
      return false;
    }
    toast({ tone: 'success', title: m.debts_priority_saved() });
    await router.invalidate();
    return true;
  };
  const addButton = (
    <Button
      onClick={() => {
        setStart({ kind: 'paylater' });
      }}
    >
      <Plus aria-hidden="true" className="size-3.5" />
      {m.debts_add()}
    </Button>
  );

  return (
    <>
      <PageHeader
        breadcrumb={[m.breadcrumb_finance(), m.debts_title()]}
        title={m.debts_title()}
        description={description}
        actions={addButton}
      />
      <DebtKpis
        kpis={kpis}
        receivablesMinor={overview.receivablesMinor}
        baseCurrency={baseCurrency}
        today={today}
        locale={locale}
      />
      {empty ? (
        <EmptyState
          icon={ShieldCheck}
          title={m.debts_empty_title()}
          description={m.debts_empty_description()}
          actions={addButton}
          note={
            <ul aria-label={m.debts_empty_types()} className="grid grid-cols-2 gap-2.5 pt-3 md:grid-cols-5">
              {TYPES.map(({ kind, note }) => {
                const Icon = KIND_ICONS[kind];
                return (
                  <li key={kind}>
                    <button
                      type="button"
                      onClick={() => {
                        setStart({ kind });
                      }}
                      className="flex w-full flex-col items-start gap-1.5 rounded-[10px] border border-border px-3 py-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <Icon aria-hidden="true" className="size-4 text-muted-fg" />
                      <span className="text-[13px] font-medium text-fg">{KIND_LABELS[kind]()}</span>
                      <span className="text-[11.5px] text-subtle">{note()}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {owing.map(({ card, state }) => {
            const account = accounts.find((candidate) => candidate.id === card.accountId);
            const held = debts.filter((debt) => debt.cardAccountId === card.accountId).map((debt) => debt.name);
            return (
              <CardStrip
                key={card.accountId}
                bill={card}
                state={state}
                account={account}
                heldNames={held}
                locale={locale}
              />
            );
          })}
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex min-w-0 flex-col gap-4">
              {owing
                .filter(({ card }) => card.transactions.length > 0 || card.balanceMinor < -card.installmentsHeldMinor)
                .map(({ card, state }) => {
                  return (
                    <CardBillCard
                      key={card.accountId}
                      bill={card}
                      state={state}
                      account={accounts.find((candidate) => candidate.id === card.accountId)}
                      heldNames={[]}
                      locale={locale}
                      onPay={() => {
                        record.open({
                          type: 'transfer',
                          toAccountId: card.accountId,
                          amountMinor: state.statementMinor > 0n ? state.statementMinor : state.status.owedMinor,
                        });
                      }}
                      onConvert={() => {
                        setStart({ kind: 'card_installment', cardId: card.accountId });
                      }}
                    />
                  );
                })}
              {debts.map((debt) => (
                <InstallmentCard
                  key={debt.id}
                  debt={debt}
                  card={cards.find((card) => card.accountId === debt.cardAccountId)}
                  accounts={accounts}
                  locale={locale}
                />
              ))}
            </div>
            {cards.length === 0 ? null : <PriorityPanel priority={overview.priority} onSave={savePriority} />}
          </div>
        </div>
      )}
      <AddDebtDialog
        start={start}
        onClose={() => {
          setStart(null);
        }}
        overview={overview}
        locale={locale}
        onSaved={saved}
      />
    </>
  );
}
