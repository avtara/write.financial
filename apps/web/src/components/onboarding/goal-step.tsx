// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Onboarding 4 — tujuan pertama (design `RRyTG`, skippable with "Lewati"): a preset (Dana Darurat with its
 * "3× pengeluaran" estimate, Liburan, DP Rumah), the target, the account it is kept in ("Simpan di"), and an optional
 * monthly contribution ("Rp500.000 tiap tgl 1 dari BCA Tahapan"). The contribution is an M3 recurrence: every month it
 * waits in "Perlu ditinjau" and is recorded only once confirmed.
 */
import type { AccountView } from '@wf/db/accounts';
import { emergencyFundEstimate } from '@wf/domain/onboarding';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { Money } from '@wf/ui/money';
import { ArrowLeft, ArrowRight, House, Plane, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { colorProps } from '../../lib/colors.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import {
  GOAL_PRESETS,
  saveOnboardingGoal,
  skipOnboardingGoal,
  type GoalPreset,
  type OnboardingView,
} from '../../server/fn/onboarding.ts';
import { Button, Field, FormError, INPUT_FRAME, Select } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { RichMessage } from '../rich-message.tsx';
import { OnboardingFooter, OnboardingHeading } from './onboarding-layout.tsx';

const PRESETS: Readonly<Record<GoalPreset, { icon: LucideIcon; name: () => string; hint: () => string }>> = {
  emergency: { icon: ShieldCheck, name: m.onboarding_goal_emergency, hint: m.onboarding_goal_emergency_hint_plain },
  vacation: { icon: Plane, name: m.onboarding_goal_vacation, hint: m.onboarding_goal_vacation_hint },
  house: { icon: House, name: m.onboarding_goal_house, hint: m.onboarding_goal_house_hint },
};
const DAYS = Array.from({ length: 28 }, (_, index) => index + 1);

/** "Simpan di" by default: an account set aside, not the everyday one (Bank Jago next to BCA Tahapan). */
function defaultGoalAccount(accounts: readonly AccountView[]): AccountView | undefined {
  const savings = accounts.filter((account) => account.type !== 'credit_card');
  return savings.find((account) => !account.isDefaultQuickEntry) ?? savings[0];
}

export function GoalStep({ view, onSaved }: { view: OnboardingView; onSaved: () => void }) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const { baseCurrency } = view.progress;
  const accounts = view.accounts.accounts.filter((account) => account.status === 'active');
  const estimate = emergencyFundEstimate(view.expectedIncomeMinor);
  const [preset, setPreset] = useState<GoalPreset>('emergency');
  const [target, setTarget] = useState<bigint | null>(estimate);
  const [accountId, setAccountId] = useState(defaultGoalAccount(accounts)?.id ?? '');
  const [recurring, setRecurring] = useState(false);
  const [amount, setAmount] = useState<bigint | null>(null);
  const [day, setDay] = useState<number>(view.startDay);
  const daily = accounts.find((account) => account.isDefaultQuickEntry) ?? accounts[0];
  const [fromId, setFromId] = useState(daily?.id ?? '');
  const [errors, setErrors] = useState<Partial<Record<'target' | 'account' | 'amount' | 'from', string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<'create' | 'skip' | null>(null);

  const goalAccount = accounts.find((account) => account.id === accountId);
  const sources = accounts.filter(
    (account) => account.id !== accountId && account.currency === (goalAccount?.currency ?? baseCurrency),
  );
  const from = sources.find((account) => account.id === fromId);

  const finish = async (action: 'create' | 'skip') => {
    setPending(action);
    setFailure(null);
    const result =
      action === 'skip'
        ? await skipOnboardingGoal()
        : await saveOnboardingGoal({
            data: {
              preset,
              name: PRESETS[preset].name(),
              // `submit` checked the target and, with a contribution, its amount and accounts.
              targetMinor: target as bigint,
              accountId: goalAccount?.id ?? null,
              contribution:
                recurring && goalAccount !== undefined && from !== undefined
                  ? { amountMinor: amount as bigint, monthDay: day, fromAccountId: from.id }
                  : null,
            },
          });
    setPending(null);
    if (result.ok) onSaved();
    else setFailure(ledgerErrorMessage(result.code, locale));
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const found: typeof errors = {};
    if (target === null || target <= 0n) found.target = m.onboarding_goal_error_target();
    if (recurring) {
      if (goalAccount === undefined) found.account = m.onboarding_goal_error_account();
      if (amount === null || amount <= 0n) found.amount = m.onboarding_goal_error_amount();
      if (from === undefined) found.from = m.onboarding_goal_error_from();
    }
    setErrors(found);
    if (Object.keys(found).length === 0) void finish('create');
  };

  if (view.goal !== null) {
    return (
      <div className="flex flex-col gap-5">
        <OnboardingHeading title={m.onboarding_goal_title()} description={m.onboarding_goal_description()} />
        <p role="status" className="rounded-[10px] border border-border bg-surface-sunken px-4 py-3 text-[13px]">
          {m.onboarding_goal_exists({ name: view.goal.name })}
        </p>
        {failure === null ? null : <FormError>{failure}</FormError>}
        <OnboardingFooter step="goal">
          <Button size="sm" pending={pending === 'skip'} onClick={() => void finish('skip')}>
            <ArrowRight aria-hidden="true" className="size-3.5" />
            {m.onboarding_next()}
          </Button>
        </OnboardingFooter>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <OnboardingHeading title={m.onboarding_goal_title()} description={m.onboarding_goal_description()} />
      <fieldset>
        <legend className="sr-only">{m.onboarding_goal_presets()}</legend>
        <div className="grid grid-cols-3 gap-2.5 max-sm:grid-cols-1">
          {(Object.keys(PRESETS) as GoalPreset[]).map((key) => {
            const { icon: Icon, name, hint } = PRESETS[key];
            const checked = preset === key;
            return (
              <label
                key={key}
                className={`flex cursor-pointer flex-col gap-2.5 rounded-[10px] border p-3.5 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring ${
                  checked ? 'border-blue bg-blue-tint-1' : 'border-border hover:bg-muted'
                }`}
              >
                <input
                  type="radio"
                  name="goal-preset"
                  value={key}
                  checked={checked}
                  onChange={() => {
                    setPreset(key);
                    setTarget(key === 'emergency' ? estimate : null);
                  }}
                  className="sr-only"
                />
                <span
                  {...colorProps(GOAL_PRESETS[key].color)}
                  aria-hidden="true"
                  className="flex size-8 items-center justify-center rounded-[8px] bg-[color-mix(in_srgb,var(--wf-color,var(--subtle))_16%,transparent)] text-[var(--wf-color,var(--subtle))]"
                >
                  <Icon className="size-4" />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-[13.5px] font-medium">{name()}</span>
                  <span className="text-[12px] text-muted-fg">
                    {key === 'emergency' && estimate !== null ? (
                      <RichMessage
                        message={m.onboarding_goal_emergency_hint}
                        slots={{
                          amount: <Money minor={estimate} currency={baseCurrency} context="amount" locale={locale} />,
                        }}
                      />
                    ) : (
                      hint()
                    )}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <Field label={m.onboarding_goal_target()} error={errors.target ?? null}>
          {({ id, describedBy, invalid }) => (
            <div className={INPUT_FRAME.lg}>
              <AmountInput
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                size="inline"
                value={target}
                onValueChange={setTarget}
                currency={baseCurrency}
                locale={locale}
              />
            </div>
          )}
        </Field>
        <Field label={m.onboarding_goal_account()} error={errors.account ?? null}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={accountId}
              onChange={(event) => {
                setAccountId(event.target.value);
              }}
            >
              <option value="">{m.onboarding_goal_account_none()}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.displayName}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="flex flex-col gap-3 rounded-[10px] border border-border p-3.5">
        <label className="flex items-center gap-2.5 text-[13px] font-medium">
          <input
            type="checkbox"
            checked={recurring}
            onChange={(event) => {
              setRecurring(event.target.checked);
            }}
            className="size-4 accent-[var(--color-fg)]"
          />
          {m.onboarding_goal_contribution()}
        </label>
        {recurring ? (
          <>
            <div className="grid grid-cols-[1fr_110px_1fr] gap-3 max-sm:grid-cols-1">
              <Field label={m.onboarding_goal_contribution_amount()} error={errors.amount ?? null}>
                {({ id, describedBy, invalid }) => (
                  <div className={INPUT_FRAME.lg}>
                    <AmountInput
                      id={id}
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      size="inline"
                      value={amount}
                      onValueChange={setAmount}
                      currency={goalAccount?.currency ?? baseCurrency}
                      locale={locale}
                    />
                  </div>
                )}
              </Field>
              <Field label={m.onboarding_goal_contribution_day()}>
                {({ id }) => (
                  <Select
                    id={id}
                    value={day}
                    onChange={(event) => {
                      setDay(Number(event.target.value));
                    }}
                  >
                    {DAYS.map((option) => (
                      <option key={option} value={option}>
                        {m.onboarding_goal_contribution_day_option({ day: option })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={m.onboarding_goal_contribution_from()} error={errors.from ?? null}>
                {({ id, describedBy, invalid }) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    value={from?.id ?? ''}
                    onChange={(event) => {
                      setFromId(event.target.value);
                    }}
                  >
                    <option value="">{m.onboarding_goal_account_none()}</option>
                    {sources.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.displayName}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            {amount !== null && amount > 0n && from !== undefined ? (
              <p role="status" className="flex items-center gap-1.5 text-[13px]">
                <ArrowRight aria-hidden="true" className="size-3.5 text-subtle" />
                <RichMessage
                  message={m.onboarding_goal_contribution_summary}
                  slots={{
                    amount: <Money minor={amount} currency={from.currency} context="amount" locale={locale} />,
                    day: String(day),
                    account: from.displayName,
                  }}
                />
              </p>
            ) : null}
          </>
        ) : null}
        <span className="text-[12px] text-subtle">{m.onboarding_goal_contribution_hint()}</span>
      </div>
      {failure === null ? null : <FormError>{failure}</FormError>}
      <OnboardingFooter
        step="goal"
        start={
          <Button variant="secondary" size="sm" pending={pending === 'skip'} onClick={() => void finish('skip')}>
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            {m.onboarding_goal_skip()}
          </Button>
        }
      >
        <Button type="submit" size="sm" pending={pending === 'create'}>
          <ArrowRight aria-hidden="true" className="size-3.5" />
          {m.onboarding_goal_create()}
        </Button>
      </OnboardingFooter>
    </form>
  );
}
