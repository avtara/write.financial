// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Tujuan tabungan baru" / "Ubah …" (FR-G1, design 13 `q0jRa`, `IsSRI`): name, icon and color, the target (fixed, or
 * dynamic "3× pengeluaran bulanan" for an emergency fund), the deadline month, "Simpan di rekening" (where deposits
 * go), the account sources that count as its progress (whole balance or a fixed amount ≤ the free balance), the
 * investment assets (a percentage of the units or the whole asset, FR-G2), and on a new goal its monthly
 * contribution ("8× setoran (Nov 2026 – Jun 2027) · label
 * #laptop-kerja"), which enters "Perlu ditinjau" every due date. Saves through `createGoal` / `updateGoal`.
 */
import type { AccountView } from '@wf/db/accounts';
import type { GoalSourceMode, GoalView } from '@wf/db/goals';
import { safeDailyStepMinor } from '@wf/domain/budget';
import { dynamicTarget, sinkingFundPlan, type GoalKind } from '@wf/domain/goals';
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { normalizeTagSlug } from '@wf/domain/tags';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { Checkbox } from '@wf/ui/checkbox';
import { Money } from '@wf/ui/money';
import { Select } from '@wf/ui/select';
import { Switch } from '@wf/ui/switch';
import { CalendarClock, Info, Plus, Repeat, Target, X } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { createGoal, updateGoal, type GoalSummary } from '../../server/fn/goals.ts';
import type { GoalAssetOption } from '../../server/fn/investments.ts';
import { ColorPicker } from '../color-picker.tsx';
import { periodLabel } from '../dashboard/dashboard-format.ts';
import { Button, Field, FormError, INPUT_FRAME, Select as NativeSelect, TextInput } from '../form.tsx';
import { IconPicker } from '../icon-picker.tsx';
import { Modal } from '../modal.tsx';
import { RichMessage } from '../rich-message.tsx';
import {
  AssetSourceRows,
  assetDraftsOf,
  draftBps,
  draftProblem,
  type AssetSourceDraft,
} from './goal-asset-sources.tsx';
import { contributionCount, firstContribution } from './goals-model.ts';

/** "Atau mulai dari template" and the onboarding-like presets. */
export interface GoalTemplate {
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly dynamic: boolean;
}

const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);
const TARGET_MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
const DEFAULT_DAY = 25;

export interface SourceDraft {
  readonly key: number;
  readonly accountId: string | null;
  readonly mode: GoalSourceMode;
  readonly amountMinor: bigint | null;
}

/** An account's balance not held by other goals' fixed amounts (`null` when another goal holds it wholly). */
export function freeBalance(account: AccountView, goals: readonly GoalView[], goalId: string | null): bigint | null {
  let free = account.balanceMinor;
  for (const goal of goals) {
    if (goal.id === goalId) continue;
    for (const source of goal.sources) {
      if (source.accountId !== account.id) continue;
      if (source.mode === 'whole') return null;
      free -= source.amountMinor ?? 0n;
    }
  }
  return free;
}

/** The "Sumber dana" rows: an account, wholly or a fixed amount of it, with what is free there. */
export function SourceRows({
  sources,
  onChange,
  accounts,
  goals,
  goalId,
  currency,
  locale,
  showErrors,
}: {
  readonly sources: readonly SourceDraft[];
  readonly onChange: (sources: SourceDraft[]) => void;
  readonly accounts: readonly AccountView[];
  readonly goals: readonly GoalView[];
  readonly goalId: string | null;
  readonly currency: string;
  readonly locale: Locale;
  readonly showErrors: boolean;
}) {
  const usable = accounts.filter(
    (account) => account.status === 'active' && account.currency === currency && account.type !== 'credit_card',
  );
  const set = (key: number, patch: Partial<SourceDraft>) => {
    onChange(sources.map((source) => (source.key === key ? { ...source, ...patch } : source)));
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-1 text-[12.5px] font-medium text-muted-fg">{m.goals_form_sources()}</legend>
      <p className="text-[12px] text-subtle">{m.goals_form_sources_hint()}</p>
      {sources.map((source) => {
        const account = usable.find((candidate) => candidate.id === source.accountId);
        const free = account === undefined ? undefined : freeBalance(account, goals, goalId);
        const taken = new Set(sources.flatMap((other) => (other.key === source.key ? [] : (other.accountId ?? []))));
        const missing =
          showErrors && (source.accountId === null || (source.mode === 'fixed' && (source.amountMinor ?? 0n) <= 0n));
        return (
          <div key={source.key} className="flex flex-col gap-1.5 rounded-[10px] border border-border p-2.5">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,150px)_auto] items-center gap-2">
              <Select
                size="sm"
                aria-label={m.goals_form_source_account()}
                value={source.accountId}
                onValueChange={(accountId) => {
                  set(source.key, { accountId });
                }}
                placeholder={m.goals_deposit_pick()}
                options={usable
                  .filter((candidate) => !taken.has(candidate.id))
                  .map((candidate) => ({ value: candidate.id, label: candidate.displayName }))}
              />
              <Select
                size="sm"
                aria-label={m.goals_form_source_mode()}
                value={source.mode}
                onValueChange={(mode) => {
                  set(source.key, { mode });
                }}
                placeholder={m.goals_form_source_mode()}
                options={[
                  { value: 'fixed', label: m.goals_source_fixed() },
                  { value: 'whole', label: m.goals_source_whole() },
                ]}
              />
              <button
                type="button"
                aria-label={m.goals_form_source_remove({ name: account?.displayName ?? '' })}
                onClick={() => {
                  onChange(sources.filter((other) => other.key !== source.key));
                }}
                className="flex size-8 items-center justify-center rounded-[7px] text-subtle hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </div>
            {source.mode === 'fixed' ? (
              <div className={INPUT_FRAME.sm}>
                <AmountInput
                  aria-label={m.goals_form_source_amount()}
                  value={source.amountMinor}
                  onValueChange={(amountMinor) => {
                    set(source.key, { amountMinor });
                  }}
                  currency={currency}
                  locale={locale}
                  size="inline"
                  aria-invalid={missing}
                />
              </div>
            ) : null}
            {free === undefined ? null : (
              <span className={`text-[11.5px] ${free === null ? 'text-amber-fg' : 'text-subtle'}`}>
                {free === null ? (
                  m.goals_form_source_held()
                ) : (
                  <RichMessage
                    message={m.goals_form_source_free}
                    slots={{ amount: <Money minor={free} currency={currency} context="amount" locale={locale} /> }}
                  />
                )}
              </span>
            )}
            {missing ? (
              <p role="alert" className="text-[12px] text-red-fg">
                {m.goals_form_error_source()}
              </p>
            ) : null}
          </div>
        );
      })}
      <Button
        size="sm"
        variant="secondary"
        className="w-fit"
        onClick={() => {
          onChange([
            ...sources,
            {
              key: Math.max(0, ...sources.map((source) => source.key)) + 1,
              accountId: null,
              mode: 'fixed',
              amountMinor: null,
            },
          ]);
        }}
      >
        <Plus aria-hidden="true" className="size-3.5" />
        {m.goals_form_source_add()}
      </Button>
    </fieldset>
  );
}

export interface GoalFormProps {
  readonly open: boolean;
  /** Editing this goal; a new goal without it. */
  readonly goal?: GoalSummary | undefined;
  readonly template?: GoalTemplate | undefined;
  readonly goals: readonly GoalView[];
  readonly accounts: readonly AccountView[];
  /** Investment assets for asset sources (FR-G2); none: the form offers no asset rows. */
  readonly assets?: readonly GoalAssetOption[];
  readonly baseCurrency: string;
  readonly today: LocalDate;
  readonly averageSpendingMinor: bigint;
  readonly payday: number | null;
  readonly locale: Locale;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: (goal: GoalView, created: boolean) => void;
}

export function GoalForm(props: GoalFormProps) {
  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.goal === undefined ? m.goals_form_new_title() : m.goals_form_edit_title({ name: props.goal.name })}
      {...(props.goal === undefined ? { description: m.goals_form_new_description() } : {})}
      size="xl"
    >
      {props.open ? <GoalFormBody {...props} /> : null}
    </Modal>
  );
}

function GoalFormBody({
  goal,
  template,
  goals,
  accounts,
  assets = [],
  baseCurrency,
  today,
  averageSpendingMinor,
  payday,
  locale,
  onOpenChange,
  onSaved,
}: GoalFormProps) {
  const currency = goal?.currency ?? baseCurrency;
  const usable = accounts.filter(
    (account) => account.status === 'active' && account.currency === currency && account.type !== 'credit_card',
  );
  const [name, setName] = useState(goal?.name ?? template?.name ?? '');
  const [icon, setIcon] = useState(goal?.icon ?? template?.icon ?? 'target');
  const [color, setColor] = useState(goal?.color ?? template?.color ?? 'blue');
  const [dynamic, setDynamic] = useState(
    goal === undefined
      ? (template?.dynamic ?? false) && averageSpendingMinor > 0n
      : goal.targetMode === 'monthly_expenses',
  );
  const [months, setMonths] = useState(goal?.targetMonths ?? 3);
  const [target, setTarget] = useState<bigint | null>(goal?.targetMinor ?? null);
  const [deadline, setDeadline] = useState<string>(goal?.deadlineMonth ?? '');
  const [accountId, setAccountId] = useState<string | null>(goal?.accountId ?? null);
  const [sources, setSources] = useState<SourceDraft[]>(
    (goal?.sources ?? []).map((source, key) => ({
      key,
      accountId: source.accountId,
      mode: source.mode,
      amountMinor: source.amountMinor,
    })),
  );
  const [assetDrafts, setAssetDrafts] = useState<AssetSourceDraft[]>(() => assetDraftsOf(goal, locale));
  // Assets fund goals in the base currency only.
  const assetsAllowed = currency === baseCurrency && (assets.length > 0 || assetDrafts.length > 0);
  const [recurring, setRecurring] = useState(false);
  const [planAmount, setPlanAmount] = useState<bigint | null>(null);
  const [day, setDay] = useState(payday ?? DEFAULT_DAY);
  const [fromId, setFromId] = useState<string | null>(usable.find((account) => account.id !== accountId)?.id ?? null);
  const [showErrors, setShowErrors] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // An edited emergency fund keeps the target it has until its multiple changes (the spending moves every month).
  const keepsTarget = goal?.targetMode === 'monthly_expenses' && dynamic && months === goal.targetMonths;
  const targetMinor =
    dynamic && !keepsTarget && averageSpendingMinor > 0n ? dynamicTarget(averageSpendingMinor, months) : target;
  const deadlineMonth = /^\d{4}-\d{2}$/.test(deadline) ? (deadline as YearMonth) : null;
  const startOn = firstContribution(today, day);
  const count = contributionCount(startOn, deadlineMonth);
  const suggested =
    deadlineMonth === null || targetMinor === null || targetMinor <= 0n
      ? null
      : sinkingFundPlan({
          targetMinor,
          savedMinor: 0n,
          from: startOn.slice(0, 7) as YearMonth,
          deadline: deadlineMonth,
          stepMinor: safeDailyStepMinor(currency),
        }).monthlyMinor;
  const monthly = planAmount ?? suggested;
  const toAccountId = accountId ?? sources.find((source) => source.accountId !== null)?.accountId ?? null;
  const tag = normalizeTagSlug(name);
  const errors = {
    name: name.trim() === '' ? m.goals_form_error_name() : null,
    target: targetMinor === null || targetMinor <= 0n ? m.goals_form_error_target() : null,
    amount: recurring && (monthly === null || monthly <= 0n) ? m.goals_form_error_amount() : null,
    from: recurring && fromId === null ? m.goals_form_error_from() : null,
    account: recurring && (toAccountId === null || toAccountId === fromId) ? m.goals_form_error_account() : null,
    sources: sources.some(
      (source) => source.accountId === null || (source.mode === 'fixed' && (source.amountMinor ?? 0n) <= 0n),
    ),
    assetSources: assetDrafts.some((draft) => draftProblem(draft, assets, goal?.id ?? null, locale) !== null),
  };

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (Object.values(errors).some((error) => error !== null && error !== false)) return;
    setPending(true);
    setFailure(null);
    const fields = {
      name: name.trim(),
      icon,
      color,
      targetMinor: targetMinor as bigint,
      targetMode: dynamic ? ('monthly_expenses' as const) : ('fixed' as const),
      targetMonths: dynamic ? months : null,
      deadlineMonth,
      accountId,
    };
    const sourceInput = sources.map((source) => ({
      accountId: source.accountId as string,
      mode: source.mode,
      amountMinor: source.mode === 'fixed' ? source.amountMinor : null,
    }));
    const assetInput = assetDrafts.map((draft) =>
      draft.mode === 'whole'
        ? { assetId: draft.assetId as string, mode: draft.mode }
        : { assetId: draft.assetId as string, mode: draft.mode, pctBps: draftBps(draft) },
    );
    const result =
      goal === undefined
        ? await createGoal({
            data: {
              ...fields,
              kind: 'savings' satisfies GoalKind,
              currency,
              tag: name.trim(),
              sources: sourceInput,
              ...(assetsAllowed ? { assetSources: assetInput } : {}),
              plans:
                recurring && monthly !== null
                  ? [
                      {
                        amountMinor: monthly,
                        monthDay: day,
                        fromAccountId: fromId as string,
                        toAccountId,
                        startOn,
                        // "8× setoran (Nov 2026 – Jun 2027)": the months the form shows.
                        startMonth: startOn.slice(0, 7),
                        endMonth: deadlineMonth,
                      },
                    ]
                  : [],
            },
          }).catch(() => null)
        : await updateGoal({
            data: {
              id: goal.id,
              patch: fields,
              sources: sourceInput,
              ...(assetsAllowed ? { assetSources: assetInput } : {}),
            },
          }).catch(() => null);
    setPending(false);
    if (result === null || !result.ok) {
      setFailure(result === null ? m.goals_save_failed() : ledgerErrorMessage(result.code, locale));
    } else {
      onSaved(result.value, goal === undefined);
    }
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <Field label={m.goals_form_name()} error={showErrors ? errors.name : null}>
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
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 max-md:grid-cols-1">
        <IconPicker value={icon} onValueChange={setIcon} color={color} label={m.goals_form_icon()} />
        <ColorPicker value={color} onValueChange={setColor} label={m.goals_form_color()} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={m.goals_form_target()} error={showErrors ? errors.target : null}>
          {({ id, describedBy, invalid }) =>
            dynamic ? (
              <div id={id} className={`${INPUT_FRAME.lg} text-muted-fg`}>
                {/* A dynamic target always has a value: computed from the spending, or the edited goal's. */}
                <Money minor={targetMinor as bigint} currency={currency} context="amount" locale={locale} />
              </div>
            ) : (
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
            )
          }
        </Field>
        <Field
          label={m.goals_form_deadline()}
          aside={<span className="text-[11.5px] text-subtle">{m.goals_optional()}</span>}
        >
          {({ id }) => (
            <TextInput
              id={id}
              type="month"
              value={deadline}
              min={today.slice(0, 7)}
              onChange={(event) => {
                setDeadline(event.currentTarget.value);
              }}
            />
          )}
        </Field>
      </div>
      {averageSpendingMinor > 0n || dynamic ? (
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox
            label={m.goals_form_target_dynamic()}
            checked={dynamic}
            onChange={(event) => {
              setDynamic(event.currentTarget.checked);
            }}
          />
          {dynamic ? (
            <NativeSelect
              size="sm"
              aria-label={m.goals_form_target_months()}
              value={months}
              onChange={(event) => {
                setMonths(Number(event.currentTarget.value));
              }}
              className="w-auto"
            >
              {TARGET_MONTHS.map((option) => (
                <option key={option} value={option}>
                  {m.goals_form_target_months_option({ count: option })}
                </option>
              ))}
            </NativeSelect>
          ) : null}
          {averageSpendingMinor > 0n ? (
            <span className="text-[12px] text-subtle">
              <RichMessage
                message={m.goals_form_target_hint}
                slots={{
                  amount: <Money minor={averageSpendingMinor} currency={currency} context="amount" locale={locale} />,
                }}
              />
            </span>
          ) : null}
        </div>
      ) : null}
      <Field label={m.goals_form_account()} hint={m.goals_form_account_hint()}>
        {({ id, describedBy }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            value={accountId}
            onValueChange={setAccountId}
            placeholder={m.goals_deposit_pick()}
            options={usable.map((account) => ({ value: account.id, label: account.displayName }))}
          />
        )}
      </Field>
      <SourceRows
        sources={sources}
        onChange={setSources}
        accounts={accounts}
        goals={goals}
        goalId={goal?.id ?? null}
        currency={currency}
        locale={locale}
        showErrors={showErrors}
      />
      {assetsAllowed ? (
        <AssetSourceRows
          drafts={assetDrafts}
          onChange={setAssetDrafts}
          assets={assets}
          goalId={goal?.id ?? null}
          currency={currency}
          locale={locale}
          showErrors={showErrors}
        />
      ) : null}
      {goal === undefined ? (
        <div className="flex flex-col gap-3 rounded-[10px] border border-border p-3">
          <Switch
            label={
              <span className="flex items-center gap-2 font-medium">
                <Repeat aria-hidden="true" className="size-3.5 text-blue-fg" />
                {m.goals_form_plan()}
              </span>
            }
            description={m.goals_form_plan_hint()}
            checked={recurring}
            onChange={(event) => {
              setRecurring(event.currentTarget.checked);
            }}
          />
          {recurring ? (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,130px)_minmax(0,1fr)] gap-3 max-md:grid-cols-1">
                <Field label={m.goals_form_plan_amount()} error={showErrors ? errors.amount : null}>
                  {({ id, describedBy, invalid }) => (
                    <div className={INPUT_FRAME.lg}>
                      <AmountInput
                        id={id}
                        value={monthly}
                        onValueChange={setPlanAmount}
                        currency={currency}
                        locale={locale}
                        size="inline"
                        aria-describedby={describedBy}
                        aria-invalid={invalid}
                      />
                    </div>
                  )}
                </Field>
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
                        .filter((account) => account.id !== toAccountId)
                        .map((account) => ({ value: account.id, label: account.displayName }))}
                    />
                  )}
                </Field>
              </div>
              {showErrors && errors.account !== null ? (
                <p role="alert" className="text-[12px] text-red-fg">
                  {errors.account}
                </p>
              ) : null}
              <p className="flex items-center gap-2 rounded-[8px] bg-surface-2 px-3 py-2 text-[12.5px] text-text-secondary">
                <CalendarClock aria-hidden="true" className="size-3.5 shrink-0 text-muted-fg" />
                {count === null || deadlineMonth === null
                  ? m.goals_form_plan_summary_open({
                      from: periodLabel(startOn.slice(0, 7) as YearMonth, locale),
                      tag: tag ?? '—',
                    })
                  : m.goals_form_plan_summary({
                      count,
                      from: periodLabel(startOn.slice(0, 7) as YearMonth, locale),
                      to: periodLabel(deadlineMonth, locale),
                      tag: tag ?? '—',
                    })}
              </p>
            </>
          ) : null}
        </div>
      ) : null}
      {failure === null ? null : <FormError>{failure}</FormError>}
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-[12px] text-subtle">
          <Info aria-hidden="true" className="size-3.5" />
          {m.goals_form_hint()}
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
          {goal === undefined ? (
            <Plus aria-hidden="true" className="size-3.5" />
          ) : (
            <Target aria-hidden="true" className="size-3.5" />
          )}
          {goal === undefined ? m.goals_form_create() : m.goals_form_save()}
        </Button>
      </div>
    </form>
  );
}
