// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Dana tidak rutin baru" (FR-B6, design 06 `j6G7bA`): name, target, due month, what is already saved, and the
 * monthly amount computed from them ("Rp250.000 · 6 bulan · Nov–Apr", rounded up so the due month is met) with what
 * it does to the sinking funds' total ("jadi Rp1.400.000/bulan (dari Rp1.150.000)"). "Sisihkan tiap gajian" joins the
 * payday transfer the other sinking funds share (it grows by the amount), or makes a new monthly one; either way
 * each due date enters "Perlu ditinjau" and becomes a transfer only once confirmed. Saves through `createGoal`.
 */
import type { AccountView } from '@wf/db/accounts';
import type { GoalView } from '@wf/db/goals';
import { safeDailyStepMinor } from '@wf/domain/budget';
import { sinkingFundPlan } from '@wf/domain/goals';
import { shiftMonth, type YearMonth } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { Money } from '@wf/ui/money';
import { Select } from '@wf/ui/select';
import { Switch } from '@wf/ui/switch';
import { Plus } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { createGoal, type GoalsOverview } from '../../server/fn/goals.ts';
import { monthName } from '../dashboard/dashboard-format.ts';
import { Button, Field, FormError, INPUT_FRAME, Select as NativeSelect, TextInput } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { RichMessage } from '../rich-message.tsx';
import { freeBalance } from './goal-form.tsx';
import { firstContribution } from './goals-model.ts';

const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);
const DEFAULT_DAY = 25;
/** Month cells drawn under the amount at most ("Nov · Des · … · Apr"). */
const MAX_CELLS = 12;

export interface SinkingFormProps {
  readonly open: boolean;
  readonly overview: GoalsOverview;
  readonly accounts: readonly AccountView[];
  readonly locale: Locale;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: (goal: GoalView) => void;
}

export function SinkingForm(props: SinkingFormProps) {
  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={m.goals_sinking_form_title()}
      description={m.goals_sinking_form_description()}
      size="lg"
    >
      {props.open ? <SinkingFormBody {...props} /> : null}
    </Modal>
  );
}

function SinkingFormBody({ overview, accounts, locale, onOpenChange, onSaved }: SinkingFormProps) {
  const { today, baseCurrency: currency, setAside, goals } = overview;
  const usable = accounts.filter(
    (account) => account.status === 'active' && account.currency === currency && account.type !== 'credit_card',
  );
  const sinking = goals.filter((goal) => goal.kind === 'sinking' && goal.status === 'active');
  // Where the payday set-aside lands (confirming it credits the fund there) unless another goal holds that account
  // wholly, else where the other sinking funds' money is, else the first account no other goal holds wholly.
  const storedAt =
    usable.find((account) => account.id === setAside?.toAccountId && freeBalance(account, goals, null) !== null)?.id ??
    sinking.flatMap((goal) => goal.sources.map((source) => source.accountId))[0] ??
    usable.find((account) => freeBalance(account, goals, null) !== null)?.id ??
    null;
  const [name, setName] = useState('');
  const [target, setTarget] = useState<bigint | null>(null);
  const [deadline, setDeadline] = useState('');
  const [saved, setSaved] = useState<bigint | null>(null);
  const [storeId, setStoreId] = useState<string | null>(storedAt);
  const [setAsideOn, setSetAsideOn] = useState(true);
  const [day, setDay] = useState(setAside?.monthDay ?? overview.payday ?? DEFAULT_DAY);
  const [fromId, setFromId] = useState<string | null>(
    setAside?.fromAccountId ?? usable.find((account) => account.id !== storedAt)?.id ?? null,
  );
  const [showErrors, setShowErrors] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const deadlineMonth = /^\d{4}-\d{2}$/.test(deadline) ? (deadline as YearMonth) : null;
  const startOn = firstContribution(today, setAside?.monthDay ?? day);
  const from = startOn.slice(0, 7) as YearMonth;
  const plan =
    deadlineMonth === null || target === null || target <= 0n
      ? null
      : {
          deadline: deadlineMonth,
          ...sinkingFundPlan({
            targetMinor: target,
            savedMinor: saved ?? 0n,
            from,
            deadline: deadlineMonth,
            stepMinor: safeDailyStepMinor(currency),
          }),
        };
  const before = sinking.reduce((sum, goal) => sum + goal.monthlyPlanMinor, 0n);
  const store = usable.find((account) => account.id === storeId);
  const free = store === undefined ? undefined : freeBalance(store, goals, null);
  const errors = {
    name: name.trim() === '' ? m.goals_form_error_name() : null,
    target: target === null || target <= 0n ? m.goals_form_error_target() : null,
    deadline: deadlineMonth === null ? m.goals_form_error_deadline() : null,
    saved:
      saved !== null && saved > 0n && (storeId === null || free === null || (free !== undefined && saved > free))
        ? m.goals_sinking_form_error_saved()
        : null,
    from: setAsideOn && setAside === null && (fromId === null || fromId === storeId) ? m.goals_form_error_from() : null,
  };

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (Object.values(errors).some((error) => error !== null) || plan === null) return;
    setPending(true);
    setFailure(null);
    // The fund runs from the first month it is set aside in to its due month ("6 bulan · Nov–Apr").
    const months = { startMonth: from, endMonth: plan.deadline };
    const plans =
      !setAsideOn || plan.monthlyMinor <= 0n
        ? []
        : setAside === null
          ? [
              {
                amountMinor: plan.monthlyMinor,
                monthDay: day,
                fromAccountId: fromId as string,
                toAccountId: storeId,
                startOn,
                ...months,
              },
            ]
          : [{ recurrenceId: setAside.recurrenceId, amountMinor: plan.monthlyMinor, ...months }];
    const result = await createGoal({
      data: {
        name: name.trim(),
        icon: 'calendar-clock',
        color: 'violet',
        kind: 'sinking',
        targetMinor: target as bigint,
        currency,
        deadlineMonth,
        tag: name.trim(),
        accountId: storeId,
        sources:
          saved !== null && saved > 0n && storeId !== null
            ? [{ accountId: storeId, mode: 'fixed', amountMinor: saved }]
            : [],
        plans,
      },
    }).catch(() => null);
    setPending(false);
    if (result === null || !result.ok) {
      setFailure(result === null ? m.goals_save_failed() : ledgerErrorMessage(result.code, locale));
      return;
    }
    onSaved(result.value);
  };

  const cells =
    plan === null ? [] : Array.from({ length: Math.min(plan.count, MAX_CELLS) }, (_, index) => shiftMonth(from, index));
  const toName = accounts.find((account) => account.id === (setAside?.toAccountId ?? storeId))?.displayName ?? '—';
  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <Field label={m.goals_sinking_form_name()} error={showErrors ? errors.name : null}>
        {({ id, describedBy, invalid }) => (
          <TextInput
            id={id}
            value={name}
            maxLength={40}
            autoFocus
            aria-describedby={describedBy}
            aria-invalid={invalid}
            onChange={(event) => {
              setName(event.currentTarget.value);
            }}
          />
        )}
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,160px)] gap-3">
        <Field label={m.goals_form_target()} error={showErrors ? errors.target : null}>
          {({ id, describedBy, invalid }) => (
            <div className={INPUT_FRAME.lg}>
              <AmountInput
                id={id}
                value={target}
                onValueChange={setTarget}
                currency={currency}
                locale={locale}
                size="inline"
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            </div>
          )}
        </Field>
        <Field label={m.goals_sinking_form_due()} error={showErrors ? errors.deadline : null}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              type="month"
              value={deadline}
              min={from}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => {
                setDeadline(event.currentTarget.value);
              }}
            />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <Field label={m.goals_sinking_form_saved()} error={showErrors ? errors.saved : null}>
          {({ id, describedBy, invalid }) => (
            <div className={INPUT_FRAME.lg}>
              <AmountInput
                id={id}
                value={saved}
                onValueChange={setSaved}
                currency={currency}
                locale={locale}
                size="inline"
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            </div>
          )}
        </Field>
        <Field
          label={m.goals_sinking_form_stored()}
          {...(free === undefined || free === null
            ? {}
            : {
                hint: (
                  <RichMessage
                    message={m.goals_form_source_free}
                    slots={{ amount: <Money minor={free} currency={currency} context="amount" locale={locale} /> }}
                  />
                ),
              })}
        >
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={storeId}
              onValueChange={setStoreId}
              placeholder={m.goals_deposit_pick()}
              options={usable.map((account) => ({ value: account.id, label: account.displayName }))}
            />
          )}
        </Field>
      </div>
      {plan === null ? null : (
        <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface-2 p-3">
          <span className="text-[12px] text-muted-fg">{m.goals_sinking_form_monthly()}</span>
          <div className="flex items-baseline justify-between gap-2">
            <Money
              minor={plan.monthlyMinor}
              currency={currency}
              context="amount"
              locale={locale}
              className="text-[20px] font-medium text-fg"
            />
            <span className="font-mono text-[12px] text-muted-fg">
              {m.goals_sinking_form_months({
                count: plan.count,
                range: `${monthName(from, locale)}–${monthName(plan.deadline, locale)}`,
              })}
            </span>
          </div>
          <ol className="flex gap-1">
            {cells.map((month) => (
              <li key={month} className="flex flex-1 flex-col items-center gap-1 text-[10.5px] text-subtle">
                <span aria-hidden="true" className="block h-1 w-full rounded-full bg-blue" />
                {monthName(month, locale)}
              </li>
            ))}
          </ol>
          <p className="text-[12px] text-text-secondary">
            <RichMessage
              message={m.goals_sinking_form_total}
              slots={{
                after: (
                  <Money
                    minor={before + (setAsideOn ? plan.monthlyMinor : 0n)}
                    currency={currency}
                    context="amount"
                    locale={locale}
                  />
                ),
                before: <Money minor={before} currency={currency} context="amount" locale={locale} />,
              }}
            />
          </p>
        </div>
      )}
      <Switch
        label={<span className="font-medium">{m.goals_sinking_form_set_aside()}</span>}
        description={m.goals_sinking_form_set_aside_hint({ day: setAside?.monthDay ?? day, account: toName })}
        checked={setAsideOn}
        onChange={(event) => {
          setSetAsideOn(event.currentTarget.checked);
        }}
      />
      {setAsideOn && setAside === null ? (
        <div className="grid grid-cols-[minmax(0,130px)_minmax(0,1fr)] gap-3">
          <Field label={m.goals_form_plan_day()}>
            {({ id }) => (
              <NativeSelect
                id={id}
                value={day}
                onChange={(event) => {
                  setDay(Number(event.currentTarget.value));
                }}
              >
                {DAYS.map((option) => (
                  <option key={option} value={option}>
                    {m.goals_plan_day({ day: option })}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={m.goals_form_plan_from()} error={showErrors ? errors.from : null}>
            {({ id, describedBy, invalid }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                value={fromId}
                onValueChange={setFromId}
                placeholder={m.goals_deposit_pick()}
                options={usable
                  .filter((account) => account.id !== storeId)
                  .map((account) => ({ value: account.id, label: account.displayName }))}
              />
            )}
          </Field>
        </div>
      ) : null}
      {failure === null ? null : <FormError>{failure}</FormError>}
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          {m.goals_form_cancel()}
        </Button>
        <Button type="submit" pending={pending}>
          <Plus aria-hidden="true" className="size-3.5" />
          {m.goals_sinking_form_create()}
        </Button>
      </div>
    </form>
  );
}
