// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The goal dialogs of design 13: "Setor ke …" (FR-G3 `PCgK1`, `biM3a`) and "Tarik dana dari …?" (`nVb1Q`) with the
 * preview of progress, emergency-fund months, and the estimate before → after; "… tercapai" / "Tandai selesai"
 * (FR-G4 `rbvBr`: stop the recurring contributions or continue as a reserve); and "Pindahkan sisa" (`m535GI`: to
 * another goal, or released as free balance). Each submits through its callback, which answers an error message or
 * `null`; nothing is written here.
 */
import type { AccountView } from '@wf/db/accounts';
import type { GoalView } from '@wf/db/goals';
import {
  depositPreview,
  goalSnapshot,
  withdrawPreview,
  type GoalMovePreview,
  type GoalSnapshot,
} from '@wf/domain/goals';
import { ratioBps } from '@wf/domain/budget';
import { dateInMonth, monthsBetween, type LocalDate, type YearMonth } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { DatePicker } from '@wf/ui/date-picker';
import { formatDate } from '@wf/ui/dates';
import { KbdHint, type Platform } from '@wf/ui/kbd-hint';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { Select } from '@wf/ui/select';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Check, PartyPopper } from 'lucide-react';
import { useState, type SyntheticEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { GoalSummary } from '../../server/fn/goals.ts';
import { periodLabel } from '../dashboard/dashboard-format.ts';
import { Button, Field, FormError, INPUT_FRAME, TextInput } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { RichMessage } from '../rich-message.tsx';
import { Chip } from './goal-list.tsx';
import { firstContribution, formatMonths, goalState, planDays, sortGoals } from './goals-model.ts';

const QUICK_AMOUNTS = [500_000n, 1_000_000n];

/** Accounts held wholly by a goal other than `goalId` (a deposit cannot go there). */
function heldWholly(goals: readonly GoalView[], goalId: string): Set<string> {
  return new Set(
    goals.flatMap((goal) =>
      goal.id === goalId ? [] : goal.sources.flatMap((source) => (source.mode === 'whole' ? [source.accountId] : [])),
    ),
  );
}

function accountOptions(accounts: readonly AccountView[]) {
  return accounts.map((account) => ({ value: account.id, label: account.displayName }));
}

/** Submits with ⌘↵ / Ctrl+↵ from any field. */
function submitOnModEnter(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    event.currentTarget.requestSubmit();
  }
}

function Pct({ bps, locale }: { readonly bps: number | null; readonly locale: Locale }) {
  return bps === null ? <>—</> : <Percent value={bps / 10_000} locale={locale} />;
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[12.5px]">
      <span className="text-muted-fg">{label}</span>
      <span className="font-mono text-fg">{children}</span>
    </div>
  );
}

/** Progress, "Ketahanan" (emergency funds), and "Estimasi tercapai" before → after. */
function PreviewRows({ preview, locale }: { readonly preview: GoalMovePreview; readonly locale: Locale }) {
  const { before, after } = preview;
  const month = (snapshot: GoalSnapshot) => (snapshot.estimate === null ? '—' : periodLabel(snapshot.estimate, locale));
  return (
    <>
      <Row label={m.goals_preview_progress()}>
        <Pct bps={before.progressBps} locale={locale} /> → <Pct bps={after.progressBps} locale={locale} />
      </Row>
      {before.coverageBps === null || after.coverageBps === null ? null : (
        <Row label={m.goals_preview_coverage()}>
          {m.goals_preview_months({
            before: formatMonths(before.coverageBps, locale),
            after: formatMonths(after.coverageBps, locale),
          })}
        </Row>
      )}
      {preview.reachesTarget ? (
        <Row label={m.goals_preview_goal()}>
          <span className="text-green-fg">{m.goals_preview_reaches()}</span>
        </Row>
      ) : before.estimate === null && after.estimate === null ? null : (
        <Row label={m.goals_preview_estimate()}>
          {month(before)} → {month(after)}
        </Row>
      )}
    </>
  );
}

/** "Terkumpul Rp11.125.000 dari Rp54.000.000 · kurang Rp170.000". */
function SavedLine({ goal, locale }: { readonly goal: GoalSummary; readonly locale: Locale }) {
  const missing = goal.targetMinor - goal.savedMinor;
  return (
    <p className="-mt-2 text-[13px] text-muted-fg">
      <RichMessage
        message={m.goals_deposit_description}
        slots={{
          saved: <Money minor={goal.savedMinor} currency={goal.currency} context="amount" locale={locale} />,
          target: <Money minor={goal.targetMinor} currency={goal.currency} context="amount" locale={locale} />,
        }}
      />
      {missing > 0n && missing < goal.targetMinor ? (
        <>
          {' · '}
          <RichMessage
            message={m.goals_deposit_short}
            slots={{ amount: <Money minor={missing} currency={goal.currency} context="amount" locale={locale} /> }}
          />
        </>
      ) : null}
    </p>
  );
}

export interface MoveInput {
  /** One per dialog: a retried submit never records twice. */
  readonly clientId: string;
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amountMinor: bigint;
  readonly date: LocalDate;
  readonly note: string;
}

interface MoveDialogProps {
  readonly goal: GoalSummary | null;
  readonly goals: readonly GoalView[];
  readonly accounts: readonly AccountView[];
  readonly today: LocalDate;
  readonly locale: Locale;
  readonly platform: Platform;
  readonly onOpenChange: (open: boolean) => void;
  /** Resolves to an error message, or `null` once done. */
  readonly onSubmit: (goal: GoalSummary, input: MoveInput) => Promise<string | null>;
}

export function DepositDialog(props: MoveDialogProps) {
  const { goal } = props;
  return (
    <Modal
      open={goal !== null}
      onOpenChange={props.onOpenChange}
      title={goal === null ? '' : m.goals_deposit_title({ name: goal.name })}
      size="xl"
    >
      {goal === null ? null : <DepositForm {...props} goal={goal} />}
    </Modal>
  );
}

function DepositForm({
  goal,
  goals,
  accounts,
  today,
  locale,
  platform,
  onOpenChange,
  onSubmit,
}: MoveDialogProps & { readonly goal: GoalSummary }) {
  const usable = accounts.filter((account) => account.status === 'active' && account.currency === goal.currency);
  const blocked = heldWholly(goals, goal.id);
  const home = goal.accountId ?? goal.sources[0]?.accountId ?? null;
  const planFrom = goal.plans.find((plan) => plan.active)?.fromAccountId;
  const [clientId] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState<bigint | null>(null);
  const [toId, setToId] = useState<string | null>(home !== null && blocked.has(home) ? null : home);
  const [fromId, setFromId] = useState<string | null>(
    (planFrom !== toId ? planFrom : undefined) ??
      usable.find((account) => account.id !== toId && account.type !== 'credit_card')?.id ??
      null,
  );
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const from = usable.find((account) => account.id === fromId);
  const missing = goal.targetMinor - goal.savedMinor;
  const chips = [...new Set([...QUICK_AMOUNTS, goal.monthlyPlanMinor].filter((value) => value > 0n))];
  // "Pas target" for a goal one deposit away (STNK's Rp170.000), not for one years away.
  const exact = missing > 0n && chips.some((chip) => missing <= chip) ? missing : null;
  const errors = {
    amount: amount === null || amount <= 0n ? m.goals_deposit_error_amount() : null,
    from: fromId === null ? m.goals_deposit_error_from() : null,
    to: toId === null || toId === fromId ? m.goals_deposit_error_to() : null,
  };
  const preview = amount !== null && amount > 0n ? depositPreview(goalState(goal), amount) : null;

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (amount === null || errors.amount !== null || errors.from !== null || errors.to !== null) return;
    setPending(true);
    const failed = await onSubmit(goal, {
      clientId,
      fromAccountId: fromId as string,
      toAccountId: toId as string,
      amountMinor: amount,
      date,
      note,
    });
    setPending(false);
    setFailure(failed);
  };

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      onKeyDown={submitOnModEnter}
      className="flex flex-col gap-4"
    >
      <SavedLine goal={goal} locale={locale} />
      <Field label={m.goals_deposit_amount()} error={showErrors ? errors.amount : null}>
        {({ id, describedBy, invalid }) => (
          <div className="flex flex-col gap-2">
            <div className={INPUT_FRAME.lg}>
              <AmountInput
                id={id}
                value={amount}
                onValueChange={setAmount}
                currency={goal.currency}
                locale={locale}
                size="inline"
                autoFocus
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <button
                  key={String(chip)}
                  type="button"
                  aria-pressed={amount === chip}
                  onClick={() => {
                    setAmount(chip);
                  }}
                  className="rounded-[6px] border border-border px-2 py-1 font-mono text-[12px] text-muted-fg hover:bg-muted aria-pressed:border-fg aria-pressed:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <Money minor={chip} currency={goal.currency} context="table" locale={locale} className="inline!" />
                </button>
              ))}
              {exact === null ? null : (
                <button
                  type="button"
                  aria-pressed={amount === exact}
                  onClick={() => {
                    setAmount(exact);
                  }}
                  className="rounded-[6px] border border-border px-2 py-1 text-[12px] text-muted-fg hover:bg-muted aria-pressed:border-fg aria-pressed:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {m.goals_deposit_exact()}{' '}
                  <Money minor={exact} currency={goal.currency} context="table" locale={locale} className="inline!" />
                </button>
              )}
            </div>
          </div>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={m.goals_deposit_from()}
          error={showErrors ? errors.from : null}
          {...(from === undefined
            ? {}
            : {
                hint: (
                  <RichMessage
                    message={m.goals_deposit_balance}
                    slots={{
                      amount: (
                        <Money minor={from.balanceMinor} currency={from.currency} context="amount" locale={locale} />
                      ),
                    }}
                  />
                ),
              })}
        >
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={fromId}
              onValueChange={setFromId}
              placeholder={m.goals_deposit_pick()}
              options={accountOptions(usable.filter((account) => account.id !== toId))}
            />
          )}
        </Field>
        <Field label={m.goals_deposit_to()} error={showErrors ? errors.to : null}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={toId}
              onValueChange={setToId}
              placeholder={m.goals_deposit_pick()}
              options={accountOptions(usable.filter((account) => !blocked.has(account.id)))}
            />
          )}
        </Field>
        <Field label={m.goals_deposit_date()}>
          {({ id }) => (
            <DatePicker
              id={id}
              value={date}
              onValueChange={setDate}
              placeholder={m.goals_deposit_date()}
              today={today}
              locale={locale}
              disableFuture
              labels={{ previousMonth: m.calendar_previous_month(), nextMonth: m.calendar_next_month() }}
            />
          )}
        </Field>
        <Field label={m.goals_deposit_note()}>
          {({ id }) => (
            <TextInput
              id={id}
              value={note}
              maxLength={2000}
              onChange={(event) => {
                setNote(event.currentTarget.value);
              }}
            />
          )}
        </Field>
      </div>
      <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface-2 p-3">
        <p className="flex items-center gap-1.5 text-[12.5px] text-muted-fg">
          <ArrowLeftRight aria-hidden="true" className="size-3.5" />
          {m.goals_deposit_recorded_as()}
        </p>
        <span className="flex flex-wrap gap-1.5">
          <Chip>{m.goals_deposit_type()}</Chip>
          {goal.tag === null ? null : <Chip className="bg-blue-tint-2 text-blue-fg">#{goal.tag}</Chip>}
          <Chip>{m.goals_deposit_not_spending()}</Chip>
        </span>
        {preview === null ? null : <PreviewRows preview={preview} locale={locale} />}
      </div>
      {failure === null ? null : <FormError>{failure}</FormError>}
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 text-[12px] text-subtle">
          <KbdHint keys={['mod', 'enter']} platform={platform} />
          {m.goals_save_hint()}
        </span>
        <span className="flex-1" />
        <Button
          variant="secondary"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          {m.goals_form_cancel()}
        </Button>
        <Button type="submit" pending={pending}>
          <ArrowDownToLine aria-hidden="true" className="size-3.5" />
          {amount === null || amount <= 0n ? (
            m.goals_deposit_submit_plain()
          ) : (
            <RichMessage
              message={m.goals_deposit_submit}
              slots={{ amount: <Money minor={amount} currency={goal.currency} context="amount" locale={locale} /> }}
            />
          )}
        </Button>
      </div>
    </form>
  );
}

export function WithdrawDialog(props: MoveDialogProps) {
  const { goal } = props;
  return (
    <Modal
      open={goal !== null}
      onOpenChange={props.onOpenChange}
      title={goal === null ? '' : m.goals_withdraw_title({ name: goal.name })}
      description={m.goals_withdraw_description()}
      size="lg"
    >
      {goal === null ? null : <WithdrawForm {...props} goal={goal} />}
    </Modal>
  );
}

function WithdrawForm({
  goal,
  accounts,
  today,
  locale,
  platform,
  onOpenChange,
  onSubmit,
}: MoveDialogProps & { readonly goal: GoalSummary }) {
  const usable = accounts.filter((account) => account.status === 'active' && account.currency === goal.currency);
  const [clientId] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState<bigint | null>(null);
  const [fromId, setFromId] = useState<string | null>(goal.sources[0]?.accountId ?? null);
  const source = goal.sources.find((candidate) => candidate.accountId === fromId);
  const planFrom = goal.plans[0]?.fromAccountId;
  const [toId, setToId] = useState<string | null>(
    usable.find((account) => account.id === planFrom && account.id !== fromId)?.id ??
      usable.find((account) => account.id !== fromId && account.type !== 'credit_card')?.id ??
      null,
  );
  const [showErrors, setShowErrors] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const max = source?.valueMinor ?? 0n;
  const errors = {
    amount:
      amount === null || amount <= 0n ? (
        m.goals_deposit_error_amount()
      ) : amount > max ? (
        <RichMessage
          message={m.goals_withdraw_error_max}
          slots={{ amount: <Money minor={max} currency={goal.currency} context="amount" locale={locale} /> }}
        />
      ) : null,
    to: toId === null || toId === fromId ? m.goals_deposit_error_to() : null,
  };
  const preview =
    amount !== null && amount > 0n && amount <= max && amount <= goal.savedMinor
      ? withdrawPreview(goalState(goal), amount)
      : null;

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (amount === null || fromId === null || errors.amount !== null || errors.to !== null) return;
    setPending(true);
    const failed = await onSubmit(goal, {
      clientId,
      fromAccountId: fromId,
      toAccountId: toId as string,
      amountMinor: amount,
      date: today,
      note: '',
    });
    setPending(false);
    setFailure(failed);
  };

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      onKeyDown={submitOnModEnter}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={m.goals_deposit_amount()}>
          {({ id, describedBy }) => (
            <div className={INPUT_FRAME.lg}>
              <AmountInput
                id={id}
                value={amount}
                onValueChange={setAmount}
                currency={goal.currency}
                locale={locale}
                size="inline"
                autoFocus
                aria-describedby={describedBy}
                aria-invalid={showErrors && errors.amount !== null}
              />
            </div>
          )}
        </Field>
        <Field label={m.goals_withdraw_to()} error={showErrors ? errors.to : null}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={toId}
              onValueChange={setToId}
              placeholder={m.goals_deposit_pick()}
              options={accountOptions(usable.filter((account) => account.id !== fromId))}
            />
          )}
        </Field>
      </div>
      {showErrors && errors.amount !== null ? (
        <p role="alert" className="-mt-2 text-[12px] text-red-fg">
          {errors.amount}
        </p>
      ) : null}
      {goal.sources.length > 1 ? (
        <Field label={m.goals_withdraw_from()}>
          {({ id }) => (
            <Select
              id={id}
              value={fromId}
              onValueChange={setFromId}
              placeholder={m.goals_deposit_pick()}
              options={goal.sources.map((candidate) => ({ value: candidate.accountId, label: candidate.accountName }))}
            />
          )}
        </Field>
      ) : null}
      {preview === null ? null : (
        <div className="flex flex-col gap-2 rounded-[10px] border border-amber bg-amber-tint-1 p-3">
          <PreviewRows preview={preview} locale={locale} />
        </div>
      )}
      {failure === null ? null : <FormError>{failure}</FormError>}
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 text-[12px] text-subtle">
          <KbdHint keys={['mod', 'enter']} platform={platform} />
          {m.goals_save_hint()}
        </span>
        <span className="flex-1" />
        <Button
          variant="secondary"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          {m.goals_form_cancel()}
        </Button>
        <Button type="submit" pending={pending}>
          <ArrowUpFromLine aria-hidden="true" className="size-3.5" />
          {amount === null || amount <= 0n ? (
            m.goals_withdraw_submit_plain()
          ) : (
            <RichMessage
              message={m.goals_withdraw_submit}
              slots={{ amount: <Money minor={amount} currency={goal.currency} context="amount" locale={locale} /> }}
            />
          )}
        </Button>
      </div>
    </form>
  );
}

export interface CompleteDialogProps {
  readonly goal: GoalSummary | null;
  readonly today: LocalDate;
  readonly locale: Locale;
  readonly onOpenChange: (open: boolean) => void;
  /** "Tandai selesai"; `stopPlans` = "Hentikan setoran rutin". */
  readonly onComplete: (goal: GoalSummary, stopPlans: boolean) => Promise<void>;
}

/** FR-G4: a reached goal ("… tercapai") or "Tandai selesai" from the menu. */
export function CompleteDialog({ goal, today, locale, onOpenChange, onComplete }: CompleteDialogProps) {
  const title =
    goal === null
      ? ''
      : goalSnapshot(goalState(goal)).reached
        ? m.goals_reached_title({ name: goal.name })
        : m.goals_complete_title({ name: goal.name });
  return (
    <Modal open={goal !== null} onOpenChange={onOpenChange} title={title} hideTitle size="lg">
      {goal === null ? null : (
        <CompleteForm
          goal={goal}
          title={title}
          today={today}
          locale={locale}
          onOpenChange={onOpenChange}
          onComplete={onComplete}
        />
      )}
    </Modal>
  );
}

function CompleteForm({
  goal,
  title,
  today,
  locale,
  onOpenChange,
  onComplete,
}: Omit<CompleteDialogProps, 'goal'> & { readonly goal: GoalSummary; readonly title: string }) {
  const snapshot = goalSnapshot(goalState(goal));
  const active = goal.plans.filter((plan) => plan.active);
  const days = planDays(goal);
  const [choice, setChoice] = useState<'stop' | 'reserve'>('stop');
  const [pending, setPending] = useState(false);
  const saved = <Money minor={goal.savedMinor} currency={goal.currency} context="amount" locale={locale} />;
  const early = goal.deadlineMonth === null ? null : monthsBetween(today.slice(0, 7) as YearMonth, goal.deadlineMonth);
  // The next contribution that will no longer come: later this month, else next month's.
  const thisMonth = days.map((day) => dateInMonth(today.slice(0, 7) as YearMonth, day)).find((date) => date > today);
  const nextDate = thisMonth ?? (days[0] === undefined ? null : firstContribution(today, days[0]));
  return (
    <div className="flex flex-col gap-4">
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-[9px] bg-green-tint-2 text-green-fg"
      >
        <PartyPopper className="size-[18px]" />
      </span>
      <h2 className="-mb-2 text-[16px] font-semibold">{title}</h2>
      <p className="text-[13px] text-muted-fg">
        {!snapshot.reached ? (
          <RichMessage
            message={m.goals_complete_body}
            slots={{
              amount: saved,
              target: <Money minor={goal.targetMinor} currency={goal.currency} context="amount" locale={locale} />,
            }}
          />
        ) : early !== null && early > 0 && goal.deadlineMonth !== null ? (
          <RichMessage
            message={(inputs) => m.goals_reached_body({ ...inputs, count: early })}
            slots={{ amount: saved, month: periodLabel(goal.deadlineMonth, locale) }}
          />
        ) : (
          <RichMessage message={m.goals_reached_body_plain} slots={{ amount: saved }} />
        )}
      </p>
      {active.length === 0 ? null : (
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-2 text-[11.5px] font-medium tracking-wide text-muted-fg uppercase">
            <RichMessage
              message={m.goals_reached_plans}
              slots={{
                amount: (
                  <Money minor={goal.monthlyPlanMinor} currency={goal.currency} context="amount" locale={locale} />
                ),
                days: days.join(' & '),
              }}
            />
          </legend>
          {(['stop', 'reserve'] as const).map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-border p-3 has-checked:border-fg has-focus-visible:outline-2 has-focus-visible:outline-ring"
            >
              <input
                type="radio"
                name="goal-complete"
                value={option}
                checked={choice === option}
                onChange={() => {
                  setChoice(option);
                }}
                className="mt-0.5 accent-fg"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium text-fg">
                  {option === 'stop' ? m.goals_reached_stop() : m.goals_reached_reserve()}
                </span>
                <span className="text-[12px] text-muted-fg">
                  {option === 'stop' ? (
                    <RichMessage
                      message={m.goals_reached_stop_hint}
                      slots={{
                        date: nextDate === null ? '—' : formatDate(nextDate, locale, 'day'),
                        amount: (
                          <Money
                            minor={goal.monthlyPlanMinor}
                            currency={goal.currency}
                            context="amount"
                            locale={locale}
                          />
                        ),
                      }}
                    />
                  ) : (
                    m.goals_reached_reserve_hint()
                  )}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          {m.goals_reached_later()}
        </Button>
        {choice === 'reserve' && active.length > 0 ? (
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {m.goals_reached_keep()}
          </Button>
        ) : (
          <Button
            pending={pending}
            onClick={() => {
              setPending(true);
              void onComplete(goal, active.length > 0).finally(() => {
                setPending(false);
              });
            }}
          >
            <Check aria-hidden="true" className="size-3.5" />
            {m.goals_reached_complete()}
          </Button>
        )}
      </div>
    </div>
  );
}

export interface RemainderDialogProps {
  readonly goal: GoalSummary | null;
  readonly goals: readonly GoalSummary[];
  readonly locale: Locale;
  readonly onOpenChange: (open: boolean) => void;
  /** To another goal, or released (`null`). */
  readonly onMove: (goal: GoalSummary, toGoalId: string | null) => Promise<void>;
}

/** FR-G4 "Pindahkan sisa" of a used or completed goal. */
export function RemainderDialog({ goal, goals, locale, onOpenChange, onMove }: RemainderDialogProps) {
  return (
    <Modal
      open={goal !== null}
      onOpenChange={onOpenChange}
      title={goal === null ? '' : m.goals_move_title({ name: goal.name })}
      hideTitle
      size="lg"
    >
      {goal === null ? null : (
        <RemainderForm goal={goal} goals={goals} locale={locale} onOpenChange={onOpenChange} onMove={onMove} />
      )}
    </Modal>
  );
}

function RemainderForm({
  goal,
  goals,
  locale,
  onOpenChange,
  onMove,
}: Omit<RemainderDialogProps, 'goal'> & { readonly goal: GoalSummary }) {
  const candidates = goals.filter(
    (other) => other.id !== goal.id && other.status === 'active' && other.currency === goal.currency,
  );
  // A sinking fund's remainder goes to another sinking fund (design m535GI), the nearest due first.
  const sameKind = candidates.filter((other) => other.kind === goal.kind);
  const targets = sortGoals(sameKind.length > 0 ? sameKind : candidates, 'deadline', locale);
  const [choice, setChoice] = useState<string | null>(targets[0]?.id ?? null);
  const [pending, setPending] = useState(false);
  const where = [...new Set(goal.sources.map((source) => source.accountName))].join(', ');
  const options: {
    readonly id: string | null;
    readonly target: GoalSummary | null;
    readonly afterMinor: bigint;
    readonly bps: [number | null, number | null];
  }[] = [
    ...targets.map((target) => ({
      id: target.id,
      target,
      afterMinor: target.savedMinor + goal.savedMinor,
      bps: [
        ratioBps(target.savedMinor, target.targetMinor),
        ratioBps(target.savedMinor + goal.savedMinor, target.targetMinor),
      ] as [number | null, number | null],
    })),
    { id: null, target: null, afterMinor: 0n, bps: [null, null] },
  ];
  return (
    <div className="flex flex-col gap-4">
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-[9px] bg-amber-tint-2 text-amber-fg"
      >
        <ArrowLeftRight className="size-[18px]" />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-[16px] font-semibold">
          <RichMessage
            message={m.goals_move_heading}
            slots={{
              amount: <Money minor={goal.savedMinor} currency={goal.currency} context="amount" locale={locale} />,
            }}
          />
        </h2>
        <p className="text-[13px] text-muted-fg">
          {goal.status === 'used'
            ? m.goals_move_body_used({ name: goal.name, accounts: where })
            : m.goals_move_body_done({ name: goal.name, accounts: where })}
        </p>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 text-[11.5px] font-medium tracking-wide text-muted-fg uppercase">
          {m.goals_move_to()}
        </legend>
        {options.map(({ id, target, afterMinor, bps }) => {
          return (
            <label
              key={id ?? 'release'}
              className="flex cursor-pointer items-center gap-3 rounded-[10px] border border-border p-3 has-checked:border-fg has-focus-visible:outline-2 has-focus-visible:outline-ring"
            >
              <input
                type="radio"
                name="goal-remainder"
                checked={choice === id}
                onChange={() => {
                  setChoice(id);
                }}
                className="accent-fg"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[13px] font-medium text-fg">{target?.name ?? m.goals_move_release()}</span>
                <span className="text-[12px] text-muted-fg">
                  {target === null ? (
                    m.goals_move_release_hint({ accounts: where })
                  ) : (
                    <RichMessage
                      message={m.goals_move_option}
                      slots={{
                        before: (
                          <Money minor={target.savedMinor} currency={goal.currency} context="amount" locale={locale} />
                        ),
                        after: <Money minor={afterMinor} currency={goal.currency} context="amount" locale={locale} />,
                        target: (
                          <Money minor={target.targetMinor} currency={goal.currency} context="amount" locale={locale} />
                        ),
                      }}
                    />
                  )}
                </span>
              </span>
              {target === null ? null : (
                <span className="font-mono text-[12px] text-text-secondary">
                  <Pct bps={bps[0]} locale={locale} /> → <Pct bps={bps[1]} locale={locale} />
                </span>
              )}
            </label>
          );
        })}
      </fieldset>
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          {m.goals_form_cancel()}
        </Button>
        <Button
          pending={pending}
          onClick={() => {
            setPending(true);
            void onMove(goal, choice).finally(() => {
              setPending(false);
            });
          }}
        >
          <ArrowLeftRight aria-hidden="true" className="size-3.5" />
          {m.goals_move_submit()}
        </Button>
      </div>
    </div>
  );
}
