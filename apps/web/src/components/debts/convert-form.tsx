// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Ubah transaksi jadi cicilan" (FR-U2, design `OEZIG`): pick an expense of the card's current cycle (≥ Rp500.000,
 * at most 30 days old, not billed yet), the tenor and costs, and see what changes once saved. The expense stays on its
 * date; the plan is stored through `convertCardTransaction`.
 */
import { Link } from '@tanstack/react-router';
import type { AccountView } from '@wf/db/accounts';
import type { DebtView } from '@wf/db/debts';
import { installmentIneligibility } from '@wf/domain/creditcard';
import type { LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { CircleAlert, CreditCard, Gauge, HandCoins, ReceiptText, ScrollText, type LucideIcon } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { cardInstallmentSchedule, cardLabel, cardState } from '../../lib/debts.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { convertCardTransaction, type CardBill } from '../../server/fn/debts.ts';
import { Button, Field, FormError, Select } from '../form.tsx';
import { DEFAULT_TERMS, InstallmentTerms, parseTerms, type InstallmentTermsValue } from './installment-terms.tsx';

/** "SETELAH DISIMPAN". */
const EFFECTS: readonly { readonly icon: LucideIcon; readonly text: () => string }[] = [
  { icon: HandCoins, text: m.debts_convert_effect_debt },
  { icon: ScrollText, text: m.debts_convert_effect_bill },
  { icon: Gauge, text: m.debts_convert_effect_limit },
  { icon: ReceiptText, text: m.debts_convert_effect_expense },
];

export interface ConvertFormProps {
  readonly cards: readonly CardBill[];
  /** For the cards' last digits. */
  readonly accounts: readonly AccountView[];
  readonly today: LocalDate;
  readonly locale: Locale;
  readonly initialCardId?: string;
  readonly onSaved: (debt: DebtView) => void;
  readonly onCancel: () => void;
}

export function ConvertForm({ cards, accounts, today, locale, initialCardId, onSaved, onCancel }: ConvertFormProps) {
  const [cardId, setCardId] = useState(initialCardId ?? cards[0]?.accountId ?? null);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [terms, setTerms] = useState<InstallmentTermsValue>(DEFAULT_TERMS);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const card = cards.find((candidate) => candidate.accountId === cardId);

  if (card === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <p className="flex flex-col items-center gap-1.5 rounded-[10px] border border-border bg-surface-2 px-4 py-6 text-center text-[13px] text-muted-fg">
          <CreditCard aria-hidden="true" className="size-5 text-subtle" />
          <span className="font-medium text-fg">{m.debts_convert_no_card()}</span>
          <Link to="/accounts" className="text-fg underline underline-offset-2">
            {m.debts_convert_add_card()}
          </Link>
        </p>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onCancel}>
            {m.debts_cancel()}
          </Button>
        </div>
      </div>
    );
  }

  const { statementDay, dueDay } = card;
  const days = statementDay === null || dueDay === null ? null : { statementDay, dueDay };
  const eligible =
    days === null
      ? []
      : card.transactions.filter(
          (row) =>
            installmentIneligibility(
              { accountType: 'credit_card', type: row.type, amountMinor: -row.amountMinor, localDate: row.localDate },
              days,
              today,
            ) === null,
        );
  const chosen = eligible.find((row) => row.id === transactionId);
  const parsed = parseTerms(terms);
  const schedule =
    chosen === undefined || parsed === null || days === null
      ? null
      : cardInstallmentSchedule(days, -chosen.amountMinor, chosen.localDate, parsed);

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (chosen === undefined || parsed === null) return;
    setPending(true);
    setFailure(null);
    const result = await convertCardTransaction({ data: { transactionId: chosen.id, ...parsed } });
    setPending(false);
    if (result.ok) onSaved(result.value);
    else setFailure(ledgerErrorMessage(result.code, locale));
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      {cards.length > 1 ? (
        <Field label={m.debts_convert_card()}>
          {({ id }) => (
            <Select
              id={id}
              value={card.accountId}
              onChange={(event) => {
                setCardId(event.target.value);
                setTransactionId(null);
              }}
            >
              {cards.map((option) => (
                <option key={option.accountId} value={option.accountId}>
                  {cardLabel(
                    option.name,
                    accounts.find((account) => account.id === option.accountId),
                  )}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="flex w-full items-baseline justify-between gap-2 pb-2 text-[12.5px] font-medium text-muted-fg">
          {m.debts_convert_pick()}
          <span className="text-[11.5px] font-normal text-subtle">{m.debts_convert_pick_rule()}</span>
        </legend>
        {days === null ? (
          <p className="rounded-[10px] border border-border bg-surface-2 px-4 py-4 text-[13px] text-muted-fg">
            {m.debts_convert_no_cycle()}
          </p>
        ) : eligible.length === 0 ? (
          <p className="flex flex-col items-center gap-1 rounded-[10px] border border-border bg-surface-2 px-4 py-5 text-center text-[13px]">
            <ReceiptText aria-hidden="true" className="size-4 text-subtle" />
            <span className="font-medium text-fg">{m.debts_convert_none()}</span>
            <span className="text-[12px] text-subtle">
              {m.debts_convert_none_note()}{' '}
              {
                <Money
                  minor={cardState(card, [], today).status.currentBillMinor}
                  currency={card.currency}
                  context="amount"
                  locale={locale}
                />
              }
            </span>
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {eligible.map((row) => (
              <li key={row.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-[8px] border border-border px-3 py-2.5 text-[13px] has-checked:border-blue has-checked:bg-blue-tint-1">
                  <input
                    type="radio"
                    name="convert-transaction"
                    value={row.id}
                    checked={row.id === transactionId}
                    onChange={() => {
                      setTransactionId(row.id);
                    }}
                    className="accent-blue"
                  />
                  <span className="min-w-0 flex-1 truncate text-fg">
                    {row.description ?? row.merchant ?? card.name}
                  </span>
                  <span className="font-mono text-[12px] text-subtle">{formatDate(row.localDate, locale, 'day')}</span>
                  {<Money minor={-row.amountMinor} currency={card.currency} context="amount" locale={locale} />}
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="flex w-full items-baseline justify-between gap-2 pb-2 text-[12.5px] font-medium text-muted-fg">
          {m.debts_convert_terms()}
          {chosen === undefined ? (
            <span className="text-[11.5px] font-normal text-subtle">{m.debts_convert_terms_note()}</span>
          ) : null}
        </legend>
        <InstallmentTerms
          value={terms}
          onChange={setTerms}
          schedule={schedule}
          currency={card.currency}
          locale={locale}
          disabled={chosen === undefined}
        />
      </fieldset>
      <section
        aria-label={m.debts_convert_after()}
        className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface-2 px-4 py-3"
      >
        <h3 className="text-[11px] font-medium tracking-[0.06em] text-subtle uppercase">{m.debts_convert_after()}</h3>
        <ul className="flex flex-col gap-2 text-[12.5px] text-muted-fg">
          {EFFECTS.map(({ icon: Icon, text }) => (
            <li key={text()} className="flex gap-2">
              <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-subtle" />
              {text()}
            </li>
          ))}
        </ul>
      </section>
      {failure === null ? null : <FormError>{failure}</FormError>}
      <div className="flex items-center gap-2 border-t border-border pt-4">
        <span className="flex flex-1 items-center gap-1.5 text-[12px] text-subtle">
          <CircleAlert aria-hidden="true" className="size-3.5" />
          {chosen === undefined ? m.debts_convert_hint_pick() : m.debts_convert_hint_ready()}
        </span>
        <Button variant="secondary" onClick={onCancel}>
          {m.debts_cancel()}
        </Button>
        <Button type="submit" pending={pending} disabled={chosen === undefined || parsed === null}>
          {m.debts_convert_submit()}
        </Button>
      </div>
    </form>
  );
}
