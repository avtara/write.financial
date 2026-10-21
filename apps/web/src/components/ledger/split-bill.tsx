// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Pisah tagihan" (FR-L5, design IGHyP), opened from the Record sheet for an expense: "Cara bagi" (Sama rata · Nominal ·
 * Persen · Per item), the user ("Kamu", the category and account of the expense) and the other people, whose shares
 * become receivables with a due date (and the H-1 reminder to the user only), "Total cocok", and "SETELAH DISIMPAN":
 * the category and the month's spending recorded whole vs. split, the safe daily limit, and the receivables. Saved
 * through `recordSplitBill` (the user's part as the expense, the rest as receivables in one transaction); the
 * expense keeps the Record sheet's client id and every person their own, so a retried save records once.
 */
import { useRouteContext } from '@tanstack/react-router';
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import type { LocalDate } from '@wf/domain/period';
import { dueDateFor, SPLIT_METHODS, type DuePreset, type SplitMethod } from '@wf/domain/receivables';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { SegmentedControl } from '@wf/ui/segmented-control';
import { Sheet } from '@wf/ui/sheet';
import { Switch } from '@wf/ui/switch';
import { CircleAlert, CircleCheck, Info, Plus, UserPlus, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import {
  avatarClass,
  reminderClock,
  splitImpact,
  splitShares,
  type SplitItemDraft,
  type SplitPerson,
} from '../../lib/receivables.ts';
import { getSplitBillContext, recordSplitBill, type SplitBillContext } from '../../server/fn/receivables.ts';
import type { RecordTransactionInput } from '../../server/fn/transactions-write.ts';
import { monthName } from '../dashboard/dashboard-format.ts';
import { AfterPreview, type AfterRow } from '../debts/after-preview.tsx';
import { DuePresetChips } from '../debts/due-preset-chips.tsx';
import { Button, FormError, INPUT_FRAME } from '../form.tsx';
import { RichMessage } from '../rich-message.tsx';
import { initials } from '../user-menu.tsx';

/** The expense the Record sheet prepared; its amount is the whole bill. */
export type BillInput = Extract<RecordTransactionInput, { type: 'expense' | 'income' }>;

const METHOD_LABELS: Readonly<Record<SplitMethod, () => string>> = {
  equal: m.record_split_equal,
  amount: m.record_split_amount,
  percent: m.record_split_percent,
  item: m.record_split_item,
};

/** A row of "Pisah tagihan": `id` is also the client id of that person's receivable. */
interface PersonRow extends SplitPerson {
  readonly id: string;
}

const newPerson = (): PersonRow => ({ id: crypto.randomUUID(), name: '', amountMinor: null, percent: '' });

export interface SplitBillSheetProps {
  readonly bill: BillInput;
  /** The bill's date (the user's calendar) for the due-date presets and the preview. */
  readonly date: LocalDate;
  readonly account: AccountView | undefined;
  readonly category: CategoryView | undefined;
  readonly locale: Locale;
  /** "Batal": back to the Record sheet with what was typed. */
  readonly onBack: () => void;
  readonly onSaved: (saved: { readonly transactionId: string; readonly count: number }) => void;
}

export function SplitBillSheet({ bill, date, account, category, locale, onBack, onSaved }: SplitBillSheetProps) {
  const { viewer } = useRouteContext({ strict: false });
  const totalMinor = bill.amountMinor;
  const categoryLabel = category === undefined ? null : categoryName(category);
  const currency = account?.currency ?? 'IDR';
  const [context, setContext] = useState<SplitBillContext | null>(null);
  const [method, setMethod] = useState<SplitMethod>('equal');
  const [people, setPeople] = useState<readonly PersonRow[]>(() => [newPerson(), newPerson()]);
  const [items, setItems] = useState<readonly SplitItemDraft[]>([{ amountMinor: null, people: [0, 1] }]);
  const [due, setDue] = useState<DuePreset>('one_week');
  const [remind, setRemind] = useState(true);
  const [showErrors, setShowErrors] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    // The preview only adds numbers: splitting works without it.
    void getSplitBillContext().then(
      (result) => {
        if (result.ok) setContext(result.value);
      },
      () => undefined,
    );
  }, []);

  const shares = splitShares(totalMinor, method, people, items);
  const ownMinor = shares.ok ? (shares.amounts[0] as bigint) : null;
  const dueDate = dueDateFor(due, date);
  const others = people.slice(1);
  const nameMissing = others.some((person) => person.name.trim() === '');
  const problem = !shares.ok
    ? null
    : ownMinor === 0n
      ? m.record_split_own_required()
      : nameMissing
        ? m.record_split_names_required()
        : null;
  const setPerson = (index: number, patch: Partial<SplitPerson>) => {
    setPeople((current) => current.map((person, at) => (at === index ? { ...person, ...patch } : person)));
  };
  const removePerson = (index: number) => {
    setPeople((current) => current.filter((_, at) => at !== index));
    // Items keep pointing at the same people.
    setItems((current) =>
      current.map((item) => ({
        ...item,
        people: item.people.filter((at) => at !== index).map((at) => (at > index ? at - 1 : at)),
      })),
    );
  };

  const save = async () => {
    setShowErrors(true);
    if (!shares.ok || problem !== null) return;
    setPending(true);
    setFailure(null);
    const result = await recordSplitBill({
      data: {
        transaction: { ...bill, type: 'expense', amountMinor: shares.amounts[0] as bigint },
        shares: others.map((person, index) => ({
          clientId: person.id,
          counterparty: person.name.trim(),
          amountMinor: shares.amounts[index + 1] as bigint,
          dueDate,
          remind: remind && dueDate !== null,
        })),
      },
    }).catch(() => null);
    setPending(false);
    if (result === null || !result.ok) {
      setFailure(result === null ? m.record_save_failed() : ledgerErrorMessage(result.code, locale));
      return;
    }
    onSaved({ transactionId: result.value.transactionId, count: result.value.receivables.length });
  };

  /** "SETELAH DISIMPAN", once the context is loaded and the shares add up. */
  const rows: AfterRow[] = [];
  if (context !== null && ownMinor !== null) {
    const impact = splitImpact(context, { date, categoryId: bill.categoryId, totalMinor, ownMinor });
    if (impact.category !== null && categoryLabel !== null) {
      const { month, ...row } = impact.category;
      rows.push({
        label: m.record_split_category({ category: categoryLabel, month: monthName(month, locale, 'long') }),
        ...row,
      });
    }
    if (impact.month !== null) {
      rows.push({
        label: m.record_split_month({ month: monthName(context.month.label, locale, 'long') }),
        ...impact.month,
      });
    }
    if (impact.safeDaily !== null) {
      rows.push({ label: m.record_split_safe_daily(), ...impact.safeDaily, style: 'amount', tone: 'green' });
    }
    rows.push({ label: m.record_split_receivables(), ...impact.receivables, style: 'amount', tone: 'violet' });
  }

  const amountCell = (person: PersonRow, index: number): ReactNode => {
    const name = index === 0 ? m.record_split_you() : person.name.trim() || m.record_split_name_placeholder();
    if (method === 'amount') {
      return (
        <span className={`${INPUT_FRAME.sm} w-[132px]`}>
          <AmountInput
            aria-label={m.record_split_share({ name })}
            size="inline"
            value={person.amountMinor}
            onValueChange={(amountMinor) => {
              setPerson(index, { amountMinor });
            }}
            currency={currency}
            locale={locale}
          />
        </span>
      );
    }
    const computed = shares.ok ? (
      <Money minor={shares.amounts[index] as bigint} currency={currency} context="amount" locale={locale} />
    ) : (
      <span className="text-subtle">—</span>
    );
    if (method === 'percent') {
      return (
        <span className="flex items-center gap-2">
          <span className={`${INPUT_FRAME.sm} w-[72px] gap-1`}>
            <input
              aria-label={m.record_split_share_percent({ name })}
              inputMode="decimal"
              value={person.percent}
              onChange={(event) => {
                setPerson(index, { percent: event.target.value });
              }}
              className="w-full min-w-0 bg-transparent text-right font-mono text-[13px] text-fg outline-none"
            />
            <span className="text-[12px] text-subtle">%</span>
          </span>
          <span className="w-[96px] text-right font-mono text-[13px]">{computed}</span>
        </span>
      );
    }
    return <span className="font-mono text-[13px] text-fg">{computed}</span>;
  };

  return (
    <Sheet
      open
      onOpenChange={onBack}
      title={m.record_split_title()}
      description={
        bill.description
          ? `${bill.description} · ${formatDate(date, locale, 'weekday')}`
          : formatDate(date, locale, 'weekday')
      }
      closeLabel={m.record_close()}
      footer={
        <>
          <span className="flex-1" />
          <Button variant="secondary" onClick={onBack}>
            {m.record_split_cancel()}
          </Button>
          <Button
            pending={pending}
            onClick={() => {
              void save();
            }}
          >
            {m.record_split_save()}
          </Button>
        </>
      }
    >
      <p className="flex items-center justify-between text-[13px] text-muted-fg">
        {categoryLabel}
        <Money minor={-totalMinor} currency={currency} context="delta" locale={locale} className="text-[15px]" />
      </p>
      <div className="flex flex-col gap-1.5">
        <span aria-hidden="true" className="text-[12.5px] font-medium text-text-secondary">
          {m.record_split_method()}
        </span>
        <SegmentedControl
          label={m.record_split_method()}
          value={method}
          onValueChange={setMethod}
          options={SPLIT_METHODS.map((option) => ({ value: option, label: METHOD_LABELS[option]() }))}
        />
      </div>
      <ul aria-label={m.record_split_people()} className="flex flex-col gap-2">
        {people.map((person, index) => {
          const you = index === 0;
          const label = you ? m.record_split_you() : person.name.trim();
          return (
            <li
              key={person.id}
              className={`flex items-center gap-3 rounded-[10px] border px-3.5 py-3 ${you ? 'border-border-strong bg-muted' : 'border-border bg-card'}`}
            >
              <span
                aria-hidden="true"
                className={`flex size-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${you ? 'bg-blue-tint-2 text-blue-fg' : avatarClass(label)}`}
              >
                {you
                  ? viewer === undefined
                    ? m.record_split_you().charAt(0)
                    : initials(viewer)
                  : label === ''
                    ? '?'
                    : initials({ name: label, email: label })}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                {you ? (
                  <>
                    <span className="text-[13px] font-medium text-fg">{m.record_split_you()}</span>
                    <span className="truncate text-[11.5px] text-subtle">
                      {[categoryLabel, account?.displayName ?? null].filter((part) => part !== null).join(' · ')}
                    </span>
                  </>
                ) : (
                  <>
                    <input
                      aria-label={m.record_split_name({ index: index + 1 })}
                      value={person.name}
                      maxLength={60}
                      autoComplete="off"
                      list="split-bill-people"
                      placeholder={m.record_split_name_placeholder()}
                      aria-invalid={showErrors && person.name.trim() === ''}
                      onChange={(event) => {
                        setPerson(index, { name: event.target.value });
                      }}
                      className="w-full min-w-0 rounded-[4px] bg-transparent text-[13px] [&::-webkit-calendar-picker-indicator]:hidden font-medium text-fg outline-none placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-ring aria-invalid:text-red-fg"
                    />
                    <span className="text-[11.5px] text-subtle">
                      {dueDate === null
                        ? m.record_split_receivable()
                        : m.record_split_receivable_due({ date: formatDate(dueDate, locale, 'day') })}
                    </span>
                  </>
                )}
              </span>
              {amountCell(person, index)}
              {you || people.length <= 2 ? null : (
                <button
                  type="button"
                  aria-label={m.record_split_remove({ name: label || m.record_split_name({ index: index + 1 }) })}
                  onClick={() => {
                    removePerson(index);
                  }}
                  className="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-subtle hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <datalist id="split-bill-people">
        {(context?.people ?? []).map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <button
        type="button"
        onClick={() => {
          setPeople((current) => [...current, newPerson()]);
        }}
        className="-mt-2 flex w-fit items-center gap-1.5 rounded-[6px] px-0.5 py-1 text-[12.5px] font-medium text-blue-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <UserPlus aria-hidden="true" className="size-3.5" />
        {m.record_split_add()}
      </button>
      {method === 'item' ? (
        <section aria-label={m.record_split_items()} className="flex flex-col gap-2">
          <h3 className="text-[12.5px] font-medium text-text-secondary">{m.record_split_items()}</h3>
          {items.map((item, itemIndex) => (
            <div key={itemIndex} className="flex flex-wrap items-center gap-2 rounded-[8px] border border-border p-2.5">
              <span className={`${INPUT_FRAME.sm} w-[132px]`}>
                <AmountInput
                  aria-label={m.record_split_item_amount({ index: itemIndex + 1 })}
                  size="inline"
                  value={item.amountMinor}
                  onValueChange={(amountMinor) => {
                    setItems((current) =>
                      current.map((other, at) => (at === itemIndex ? { ...other, amountMinor } : other)),
                    );
                  }}
                  currency={currency}
                  locale={locale}
                />
              </span>
              <span
                role="group"
                aria-label={m.record_split_item_people({ index: itemIndex + 1 })}
                className="flex flex-1 flex-wrap gap-1"
              >
                {people.map((person, personIndex) => (
                  <button
                    key={person.id}
                    type="button"
                    aria-pressed={item.people.includes(personIndex)}
                    onClick={() => {
                      setItems((current) =>
                        current.map((other, at) =>
                          at !== itemIndex
                            ? other
                            : {
                                ...other,
                                people: other.people.includes(personIndex)
                                  ? other.people.filter((value) => value !== personIndex)
                                  : [...other.people, personIndex].sort((a, b) => a - b),
                              },
                        ),
                      );
                    }}
                    className="rounded-[6px] border border-border px-2 py-0.5 text-[11.5px] text-muted-fg focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-blue-tint-4 aria-pressed:bg-blue-tint-2 aria-pressed:text-blue-fg"
                  >
                    {personIndex === 0
                      ? m.record_split_you()
                      : person.name.trim() || m.record_split_name({ index: personIndex + 1 })}
                  </button>
                ))}
              </span>
              {items.length <= 1 ? null : (
                <button
                  type="button"
                  aria-label={m.record_split_item_remove({ index: itemIndex + 1 })}
                  onClick={() => {
                    setItems((current) => current.filter((_, at) => at !== itemIndex));
                  }}
                  className="flex size-7 items-center justify-center rounded-[6px] text-subtle hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              setItems((current) => [...current, { amountMinor: null, people: people.map((_, index) => index) }]);
            }}
            className="flex w-fit items-center gap-1.5 rounded-[6px] px-0.5 py-1 text-[12.5px] font-medium text-blue-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Plus aria-hidden="true" className="size-3.5" />
            {m.record_split_item_add()}
          </button>
          <p className="text-[11.5px] text-subtle">{m.record_split_items_note()}</p>
        </section>
      ) : null}
      <div role="status" className="text-[12px]">
        {shares.ok ? (
          <p className="flex items-center gap-2 rounded-[8px] border border-green-tint-3 bg-green-tint-1 px-3 py-2.5 text-green-fg">
            <CircleCheck aria-hidden="true" className="size-3.5 shrink-0" />
            <span>
              <RichMessage
                message={m.record_split_match}
                slots={{
                  parts: shares.amounts.map((amount, index) => (
                    <span key={index}>
                      {index === 0 ? null : ' + '}
                      <Money minor={amount} currency={currency} context="table" locale={locale} className="inline" />
                    </span>
                  )),
                  total: (
                    <Money minor={totalMinor} currency={currency} context="table" locale={locale} className="inline" />
                  ),
                }}
              />
            </span>
          </p>
        ) : (
          <p className="flex items-center gap-2 rounded-[8px] border border-border bg-surface-2 px-3 py-2.5 text-amber-fg">
            <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
            {shares.reason === 'mismatch' ? (
              <RichMessage
                message={m.record_split_mismatch}
                slots={{
                  amount: <Money minor={shares.differenceMinor} currency={currency} context="amount" locale={locale} />,
                }}
              />
            ) : (
              m.record_split_incomplete()
            )}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-text-secondary">{m.record_split_due()}</span>
        <DuePresetChips value={due} onChange={setDue} from={date} locale={locale} label={m.record_split_due()} />
      </div>
      <Switch
        label={m.receivables_remind({ time: reminderClock(context?.reminderTime ?? '09:00', locale) })}
        description={m.receivables_remind_note()}
        checked={remind && dueDate !== null}
        disabled={dueDate === null}
        onChange={(event) => {
          setRemind(event.currentTarget.checked);
        }}
      />
      {rows.length === 0 ? null : <AfterPreview rows={rows} currency={currency} locale={locale} />}
      <p className="flex gap-2 text-[11.5px] text-subtle">
        <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" />
        <span>
          <RichMessage
            message={m.record_split_note}
            slots={{
              amount: <Money minor={totalMinor} currency={currency} context="amount" locale={locale} />,
              account: account?.displayName ?? '',
            }}
          />
        </span>
      </p>
      {showErrors && problem !== null ? <FormError>{problem}</FormError> : null}
      {failure === null ? null : <FormError>{failure}</FormError>}
    </Sheet>
  );
}
