// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Setoran rutin" (FR-G1: several recurring contributions per goal, each with its date and from → to): every active
 * goal's contributions (or one goal's, from its ⋮ menu "Ubah setoran rutin"), to change the monthly amount, pause or
 * resume, and add another. A contribution is a share of a recurring transfer: each due date enters "Perlu ditinjau"
 * and becomes a Transfer only once confirmed (D14), so nothing here records a transaction.
 */
import type { AccountView } from '@wf/db/accounts';
import type { GoalPlanView } from '@wf/db/goals';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { Select } from '@wf/ui/select';
import { Sheet } from '@wf/ui/sheet';
import { Switch } from '@wf/ui/switch';
import { toast } from '@wf/ui/toast';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import {
  addGoalPlan,
  setGoalPlanActive,
  updateGoalPlan,
  type GoalSummary,
  type GoalsOverview,
} from '../../server/fn/goals.ts';
import { CategoryIcon } from '../category-icon.tsx';
import { Button, Field, INPUT_FRAME, Select as NativeSelect } from '../form.tsx';
import { firstContribution } from './goals-model.ts';

const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);
const DEFAULT_DAY = 25;

type Outcome = { readonly ok: true } | { readonly ok: false; readonly code: string };

export interface GoalPlansProps {
  readonly open: boolean;
  /** Only this goal's contributions; every active goal's when `null`. */
  readonly goalId: string | null;
  readonly overview: GoalsOverview;
  readonly accounts: readonly AccountView[];
  readonly locale: Locale;
  readonly onOpenChange: (open: boolean) => void;
  /** After a change was saved (reload the page's data). */
  readonly onChanged: () => void;
}

export function GoalPlans({ open, goalId, overview, accounts, locale, onOpenChange, onChanged }: GoalPlansProps) {
  const goals = overview.goals.filter((goal) => goal.status === 'active' && (goalId === null || goal.id === goalId));
  const only = goalId === null ? undefined : goals[0];
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={only === undefined ? m.goals_plans_title() : m.goals_plans_title_goal({ name: only.name })}
      description={m.goals_plans_description()}
      closeLabel={m.goals_close()}
    >
      {open ? (
        <PlansBody goals={goals} overview={overview} accounts={accounts} locale={locale} onChanged={onChanged} />
      ) : null}
    </Sheet>
  );
}

function PlansBody({
  goals,
  overview,
  accounts,
  locale,
  onChanged,
}: {
  readonly goals: readonly GoalSummary[];
  readonly overview: GoalsOverview;
  readonly accounts: readonly AccountView[];
  readonly locale: Locale;
  readonly onChanged: () => void;
}) {
  const report = (result: Outcome | null, success: string): boolean => {
    if (result === null || !result.ok) {
      toast({
        tone: 'error',
        title: result === null ? m.goals_save_failed() : ledgerErrorMessage(result.code, locale),
      });
      return false;
    }
    toast({ tone: 'success', title: success });
    onChanged();
    return true;
  };
  const name = (id: string) => accounts.find((account) => account.id === id)?.displayName ?? '—';
  return (
    <div className="flex flex-col gap-5">
      {goals.map((goal) => (
        <section key={goal.id} aria-label={goal.name} className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-[13px] font-medium text-fg">
            <CategoryIcon icon={goal.icon} color={goal.color} size="sm" />
            {goal.name}
          </h3>
          {goal.plans.length === 0 ? (
            <p className="text-[12.5px] text-muted-fg">{m.goals_plans_empty()}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {goal.plans.map((plan) => (
                <PlanRow
                  key={plan.id}
                  plan={plan}
                  currency={goal.currency}
                  route={`${name(plan.fromAccountId)} → ${name(plan.toAccountId)}`}
                  locale={locale}
                  onSave={async (amountMinor) =>
                    report(
                      await updateGoalPlan({ data: { planId: plan.id, amountMinor } }).catch(() => null),
                      m.goals_toast_plan_saved(),
                    )
                  }
                  onActive={async (active) =>
                    report(
                      await setGoalPlanActive({ data: { planId: plan.id, active } }).catch(() => null),
                      active ? m.goals_toast_resumed({ name: goal.name }) : m.goals_toast_paused({ name: goal.name }),
                    )
                  }
                />
              ))}
            </ul>
          )}
          <AddPlan
            goal={goal}
            overview={overview}
            accounts={accounts}
            locale={locale}
            onAdd={async (plan) =>
              report(
                await addGoalPlan({ data: { goalId: goal.id, plan } }).catch(() => null),
                m.goals_toast_plan_added(),
              )
            }
          />
        </section>
      ))}
    </div>
  );
}

function PlanRow({
  plan,
  currency,
  route,
  locale,
  onSave,
  onActive,
}: {
  readonly plan: GoalPlanView;
  readonly currency: string;
  readonly route: string;
  readonly locale: Locale;
  readonly onSave: (amountMinor: bigint) => Promise<boolean>;
  readonly onActive: (active: boolean) => Promise<boolean>;
}) {
  const [amount, setAmount] = useState<bigint | null>(plan.amountMinor);
  const [pending, setPending] = useState(false);
  const changed = amount !== null && amount > 0n && amount !== plan.amountMinor;
  return (
    <li className="flex flex-col gap-2 rounded-[10px] border border-border p-3">
      <Switch
        label={
          <span className="font-medium">
            {plan.monthDay === null ? m.goals_plan_monthly() : m.goals_plan_day({ day: plan.monthDay })}
            {' · '}
            {plan.active ? m.goals_plan_confirm() : m.goals_plan_paused()}
          </span>
        }
        description={route}
        checked={plan.active}
        onChange={(event) => {
          void onActive(event.currentTarget.checked);
        }}
      />
      <div className="flex items-center gap-2">
        <div className={`${INPUT_FRAME.sm} flex-1`}>
          <AmountInput
            aria-label={m.goals_form_plan_amount()}
            value={amount}
            onValueChange={setAmount}
            currency={currency}
            locale={locale}
            size="inline"
          />
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!changed}
          pending={pending}
          onClick={() => {
            setPending(true);
            void onSave(amount as bigint).finally(() => {
              setPending(false);
            });
          }}
        >
          {m.goals_form_save()}
        </Button>
      </div>
    </li>
  );
}

type NewPlan = Parameters<typeof addGoalPlan>[0]['data']['plan'];

function AddPlan({
  goal,
  overview,
  accounts,
  locale,
  onAdd,
}: {
  readonly goal: GoalSummary;
  readonly overview: GoalsOverview;
  readonly accounts: readonly AccountView[];
  readonly locale: Locale;
  readonly onAdd: (plan: NewPlan) => Promise<boolean>;
}) {
  const usable = accounts.filter(
    (account) => account.status === 'active' && account.currency === goal.currency && account.type !== 'credit_card',
  );
  const home = goal.accountId ?? goal.sources[0]?.accountId ?? null;
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<bigint | null>(null);
  const [day, setDay] = useState(overview.payday ?? DEFAULT_DAY);
  const [fromId, setFromId] = useState<string | null>(usable.find((account) => account.id !== home)?.id ?? null);
  const [toId, setToId] = useState<string | null>(home);
  const [pending, setPending] = useState(false);
  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="w-fit"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Plus aria-hidden="true" className="size-3.5" />
        {m.goals_plans_add()}
      </Button>
    );
  }
  const valid = amount !== null && amount > 0n && fromId !== null && toId !== null && fromId !== toId;
  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-dashed border-border p-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={m.goals_form_plan_amount()}>
          {({ id }) => (
            <div className={INPUT_FRAME.lg}>
              <AmountInput
                id={id}
                value={amount}
                onValueChange={setAmount}
                currency={goal.currency}
                locale={locale}
                size="inline"
                autoFocus
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
        <Field label={m.goals_form_plan_from()}>
          {({ id }) => (
            <Select
              id={id}
              value={fromId}
              onValueChange={setFromId}
              placeholder={m.goals_deposit_pick()}
              options={usable
                .filter((account) => account.id !== toId)
                .map((account) => ({ value: account.id, label: account.displayName }))}
            />
          )}
        </Field>
        <Field label={m.goals_form_plan_to()}>
          {({ id }) => (
            <Select
              id={id}
              value={toId}
              onValueChange={setToId}
              placeholder={m.goals_deposit_pick()}
              options={usable
                .filter((account) => account.id !== fromId)
                .map((account) => ({ value: account.id, label: account.displayName }))}
            />
          )}
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setOpen(false);
          }}
        >
          {m.goals_form_cancel()}
        </Button>
        <Button
          size="sm"
          disabled={!valid}
          pending={pending}
          onClick={() => {
            setPending(true);
            void onAdd({
              amountMinor: amount as bigint,
              monthDay: day,
              fromAccountId: fromId as string,
              toAccountId: toId,
              startOn: firstContribution(overview.today, day),
            }).then((added) => {
              setPending(false);
              if (added) setOpen(false);
            });
          }}
        >
          {m.goals_plans_add_submit()}
        </Button>
      </div>
    </div>
  );
}
