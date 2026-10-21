// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the Record sheet adds for credit cards (FR-U2, FR-U4): "Pecah jadi cicilan" on an expense of at least
 * Rp500.000 on a card (design `hNvip`, off: `x20Gf`) and, on a transfer into a card, how the payment is allocated
 * by priority with the recalculation of a partly paid installment and the card before → after (`qrRRV`). The sheet
 * keeps the choices and saves through `recordCardInstallment` / `recordCardPayment`.
 */
import { cardCycle, INSTALLMENT_MIN_MINOR } from '@wf/domain/creditcard';
import type { CcPaymentBucket, Installment, RecalcMode } from '@wf/domain/debt';
import type { LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Switch } from '@wf/ui/switch';
import { ArrowRight, CalendarCheck, Gauge, HandCoins, ReceiptText, Split } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cardInstallmentSchedule, cardPaymentPlan, cardState, type CardFigures } from '../../lib/debts.ts';
import { getCardPaymentContext, type CardPaymentContext } from '../../server/fn/debts.ts';
import { InstallmentTerms, parseTerms, type InstallmentTermsValue } from '../debts/installment-terms.tsx';
import { BUCKET_LABELS, MoveButton, moveBucket } from '../debts/priority-panel.tsx';
import { RichMessage } from '../rich-message.tsx';

export type CardContextState = CardPaymentContext | 'loading' | 'failed' | null;

/** The card context of `accountId` (`null` = not a card), reloaded when it changes. */
export function useCardContext(accountId: string | null): CardContextState {
  const [state, setState] = useState<{ readonly id: string | null; readonly value: CardContextState }>({
    id: null,
    value: null,
  });
  useEffect(() => {
    if (accountId === null) return;
    let live = true;
    void getCardPaymentContext({ data: { accountId } }).then(
      (result) => {
        if (live) setState({ id: accountId, value: result.ok ? result.value : 'failed' });
      },
      () => {
        if (live) setState({ id: accountId, value: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [accountId]);
  if (accountId === null) return null;
  return state.id === accountId ? state.value : 'loading';
}

export interface InstallmentChoice {
  readonly on: boolean;
  readonly terms: InstallmentTermsValue;
}

const monthName = (date: LocalDate, locale: Locale) =>
  new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

function Effects({ items }: { readonly items: readonly { readonly icon: typeof Split; readonly text: ReactNode }[] }) {
  return (
    <ul className="flex flex-col gap-1.5 text-[12.5px] text-muted-fg">
      {items.map(({ icon: Icon, text }, index) => (
        <li key={index} className="flex gap-2">
          <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-subtle" />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

/** "Pecah jadi cicilan" under an expense on a card. */
export function CardInstallmentField({
  context,
  amountMinor,
  date,
  value,
  onChange,
  locale,
}: {
  readonly context: CardPaymentContext;
  readonly amountMinor: bigint | null;
  readonly date: LocalDate;
  readonly value: InstallmentChoice;
  readonly onChange: (value: InstallmentChoice) => void;
  readonly locale: Locale;
}) {
  const { card } = context;
  const state = cardState(card, context.debts, context.today);
  const days =
    card.statementDay === null || card.dueDay === null
      ? null
      : { statementDay: card.statementDay, dueDay: card.dueDay };
  const splittable = days !== null && amountMinor !== null && amountMinor >= INSTALLMENT_MIN_MINOR;
  const terms = parseTerms(value.terms);
  const schedule = !splittable || terms === null ? null : cardInstallmentSchedule(days, amountMinor, date, terms);
  const when = { date: formatDate(date, locale, 'day'), month: monthName(date, locale) };
  return (
    <section aria-label={m.record_installment_title()} className="flex flex-col gap-3">
      <p className="text-[12px] text-subtle">
        <RichMessage
          message={m.record_installment_card}
          slots={{
            limit: (
              <Money
                minor={state.status.remainingLimitMinor}
                currency={card.currency}
                context="amount"
                locale={locale}
              />
            ),
          }}
        />
      </p>
      {!splittable ? null : (
        <div className={`flex flex-col gap-3 rounded-[12px] border p-4 ${value.on ? 'border-blue' : 'border-border'}`}>
          <div className="flex items-start gap-2.5">
            <Split aria-hidden="true" className="mt-0.5 size-4 text-blue-fg" />
            <Switch
              className="flex-1"
              label={m.record_installment_title()}
              description={
                value.on
                  ? m.record_installment_on_note()
                  : m.record_installment_off_note({
                      date: formatDate(cardCycle(date, days.statementDay, days.dueDay).statementOn, locale, 'day'),
                    })
              }
              checked={value.on}
              onChange={(event) => {
                onChange({ ...value, on: event.currentTarget.checked });
              }}
            />
          </div>
          {value.on ? (
            <InstallmentTerms
              value={value.terms}
              onChange={(next) => {
                onChange({ ...value, terms: next });
              }}
              schedule={schedule}
              currency={card.currency}
              locale={locale}
            />
          ) : null}
        </div>
      )}
      {!splittable ? null : value.on ? (
        <Effects
          items={[
            {
              icon: ReceiptText,
              text: (
                <RichMessage
                  message={m.record_installment_effect_expense}
                  slots={{
                    amount: <Money minor={amountMinor} currency={card.currency} context="amount" locale={locale} />,
                    ...when,
                  }}
                />
              ),
            },
            {
              icon: HandCoins,
              text: (
                <RichMessage
                  message={m.record_installment_effect_debt}
                  slots={{
                    amount: <Money minor={amountMinor} currency={card.currency} context="amount" locale={locale} />,
                  }}
                />
              ),
            },
            {
              icon: Gauge,
              text: (
                <RichMessage
                  message={m.record_installment_effect_limit}
                  slots={{
                    amount: <Money minor={amountMinor} currency={card.currency} context="amount" locale={locale} />,
                  }}
                />
              ),
            },
          ]}
        />
      ) : (
        <Effects
          items={[
            {
              icon: ReceiptText,
              text: (
                <RichMessage
                  message={m.record_installment_effect_plain}
                  slots={{
                    amount: <Money minor={amountMinor} currency={card.currency} context="amount" locale={locale} />,
                    ...when,
                  }}
                />
              ),
            },
            {
              icon: CalendarCheck,
              text: (
                <RichMessage
                  message={m.record_installment_effect_bill}
                  slots={{
                    total: (
                      <Money
                        minor={state.status.owedMinor + amountMinor}
                        currency={card.currency}
                        context="amount"
                        locale={locale}
                      />
                    ),
                    installments: (
                      <Money
                        minor={card.installmentsHeldMinor}
                        currency={card.currency}
                        context="amount"
                        locale={locale}
                      />
                    ),
                    bill: (
                      <Money
                        minor={state.status.currentBillMinor + amountMinor}
                        currency={card.currency}
                        context="amount"
                        locale={locale}
                      />
                    ),
                  }}
                />
              ),
            },
          ]}
        />
      )}
    </section>
  );
}

export interface CardPaymentChoice {
  /** This payment's own order; `null` = the saved priority. */
  readonly priority: readonly CcPaymentBucket[] | null;
  readonly mode: RecalcMode;
}

/** The card figures shown before → after a payment. */
const FIGURES: readonly { readonly key: keyof CardFigures; readonly label: (statement: string) => string }[] = [
  { key: 'installmentsMinor', label: () => m.record_card_payment_installments() },
  { key: 'owedMinor', label: () => m.record_card_payment_owed() },
  { key: 'remainingLimitMinor', label: () => m.record_card_payment_limit() },
  { key: 'statementMinor', label: (date) => m.record_card_payment_statement({ date }) },
];

/** A table amount, or "—" when there is none (the credit row has no "before"). */
function TableAmount({
  valueMinor,
  currency,
  locale,
  className,
}: {
  readonly valueMinor: bigint | null;
  readonly currency: string;
  readonly locale: Locale;
  readonly className: string;
}) {
  return valueMinor === null ? (
    <span className="block text-right text-subtle">—</span>
  ) : (
    <Money minor={valueMinor} currency={currency} context="table" locale={locale} className={className} />
  );
}

/** "Alokasi pembayaran kartu" under a transfer into a card. */
export function CardPaymentPreview({
  context,
  amountMinor,
  value,
  onChange,
  locale,
}: {
  readonly context: CardPaymentContext;
  readonly amountMinor: bigint;
  readonly value: CardPaymentChoice;
  readonly onChange: (value: CardPaymentChoice) => void;
  readonly locale: Locale;
}) {
  const { card } = context;
  const state = cardState(card, context.debts, context.today);
  const priority = value.priority ?? context.priority;
  const plan = cardPaymentPlan({ state, debts: context.debts, amountMinor, priority, mode: value.mode });
  const statement = state.cycle === null ? null : formatDate(state.cycle.statementOn, locale, 'day');
  const option = (mode: RecalcMode, label: string, note: ReactNode) => (
    <label className="flex flex-1 cursor-pointer items-start gap-2.5 rounded-[10px] border border-border px-3 py-2.5 has-checked:border-blue has-checked:bg-blue-tint-1">
      <input
        type="radio"
        name="card-payment-mode"
        value={mode}
        checked={value.mode === mode}
        onChange={() => {
          onChange({ ...value, mode });
        }}
        className="mt-0.5 accent-blue"
      />
      <span className="flex flex-col">
        <span className="text-[13px] text-fg">{label}</span>
        <span className="font-mono text-[11.5px] text-subtle">{note}</span>
      </span>
    </label>
  );
  const { partial } = plan;
  return (
    <section aria-label={m.record_card_payment_title()} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[12.5px] font-medium text-muted-fg">{m.record_card_payment_title()}</h3>
        <span className="text-[11.5px] text-subtle">{m.record_card_payment_reorder()}</span>
      </div>
      <table className="w-full overflow-hidden rounded-[10px] border border-border text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-[10.5px] tracking-[0.06em] text-subtle uppercase">
            <th className="px-3 py-2 text-left font-medium">{m.record_card_payment_priority()}</th>
            <th className="px-3 py-2 text-right font-medium">{m.record_card_payment_before()}</th>
            <th className="px-3 py-2 text-right font-medium">{m.record_card_payment_paid()}</th>
            <th className="px-3 py-2 text-right font-medium">{m.record_card_payment_after()}</th>
          </tr>
        </thead>
        <tbody>
          {plan.rows.map((row, index) => {
            const bucketIndex = row.bucket === 'credit' ? -1 : priority.indexOf(row.bucket);
            const label = row.debt?.name ?? BUCKET_LABELS[row.bucket].label();
            const note =
              row.debt === null
                ? row.bucket === 'spending' && statement !== null
                  ? m.record_card_payment_bill_note({ date: statement })
                  : BUCKET_LABELS[row.bucket].note()
                : m.record_card_payment_installment_note({ count: row.debt.tenorMonths });
            return (
              <tr key={row.debt?.id ?? row.bucket} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <span
                      className={`flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] ${index === 0 ? 'bg-blue text-on-accent' : 'bg-surface-3 text-muted-fg'}`}
                    >
                      {index + 1}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-fg">{label}</span>
                      <span className="text-[11px] text-subtle">{note}</span>
                    </span>
                    {row.bucket === 'credit' ? null : (
                      <span className="ml-auto flex gap-1">
                        <MoveButton
                          label={m.debts_priority_up({ name: BUCKET_LABELS[row.bucket].label() })}
                          disabled={bucketIndex === 0}
                          onClick={() => {
                            onChange({ ...value, priority: moveBucket(priority, bucketIndex, -1) });
                          }}
                          up
                        />
                        <MoveButton
                          label={m.debts_priority_down({ name: BUCKET_LABELS[row.bucket].label() })}
                          disabled={bucketIndex === priority.length - 1}
                          onClick={() => {
                            onChange({ ...value, priority: moveBucket(priority, bucketIndex, 1) });
                          }}
                          up={false}
                        />
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <TableAmount
                    valueMinor={row.beforeMinor}
                    currency={card.currency}
                    locale={locale}
                    className="text-muted-fg"
                  />
                </td>
                <td className="px-3 py-2.5">
                  <TableAmount
                    valueMinor={row.paidMinor}
                    currency={card.currency}
                    locale={locale}
                    className={row.paidMinor > 0n ? 'text-green-fg' : 'text-fg'}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <TableAmount
                    valueMinor={row.beforeMinor === null ? null : row.beforeMinor - row.paidMinor}
                    currency={card.currency}
                    locale={locale}
                    className="text-fg"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {partial === null ? null : (
        <fieldset className="flex flex-col gap-2">
          <legend className="flex w-full items-baseline justify-between gap-2 pb-2 text-[12.5px] text-fg">
            <span>
              <RichMessage
                message={m.record_card_payment_rest}
                slots={{
                  name: partial.debt.name,
                  amount: <Money minor={partial.restMinor} currency={card.currency} context="amount" locale={locale} />,
                }}
              />
            </span>
            <span className="text-[11.5px] text-subtle">{m.record_card_payment_rest_hint()}</span>
          </legend>
          <div className="flex flex-col gap-2 sm:flex-row">
            {option(
              'reduce_amount',
              m.record_card_payment_reduce(),
              <RichMessage
                message={m.record_card_payment_reduce_note}
                slots={{
                  count: String(partial.reduce.length),
                  amount: (
                    <Money
                      minor={(partial.reduce[0] as Installment).totalMinor}
                      currency={card.currency}
                      context="amount"
                      locale={locale}
                    />
                  ),
                }}
              />,
            )}
            {option(
              'shorten_tenor',
              m.record_card_payment_shorten(),
              <RichMessage
                message={m.record_card_payment_shorten_note}
                slots={{
                  count: String(partial.shorten.length),
                  amount: (
                    <Money
                      minor={(partial.shorten[0] as Installment).totalMinor}
                      currency={card.currency}
                      context="amount"
                      locale={locale}
                    />
                  ),
                  date: formatDate((partial.shorten.at(-1) as Installment).dueOn, locale, 'day'),
                }}
              />,
            )}
          </div>
        </fieldset>
      )}
      <dl className="flex flex-col gap-1.5 rounded-[10px] border border-border bg-surface-2 px-3 py-2.5 text-[12.5px]">
        {FIGURES.filter(({ key }) => key !== 'statementMinor' || statement !== null).map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-2">
            <dt className="text-muted-fg">{label(statement ?? '')}</dt>
            <dd className="flex items-center gap-1.5">
              <Money
                minor={plan.before[key]}
                currency={card.currency}
                context="table"
                locale={locale}
                className="text-subtle"
              />
              <ArrowRight aria-hidden="true" className="size-3 text-subtle" />
              <Money
                minor={plan.after[key]}
                currency={card.currency}
                context="table"
                locale={locale}
                className="font-medium text-fg"
              />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
