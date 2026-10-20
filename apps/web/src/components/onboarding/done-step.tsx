// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Onboarding 5 — selesai (design `S53M66`): what was set up (profile and currencies, the period, the accounts with
 * "saldo tersedia", the first goal against its account's balance) and "Ke Ringkasan", which completes the onboarding.
 * Optional cards only where they lead somewhere: "Kata sandi (opsional)" for Google-only accounts (Settings › Profil
 * sets it). The Assistant card waits for the Assistant (not built yet).
 */
import { periodFor, periodStartDay } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { ArrowRight, CalendarDays, KeyRound, Landmark, ShieldCheck, User, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { colorProps } from '../../lib/colors.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { periodPreview } from '../../lib/onboarding.ts';
import { finishOnboarding, type OnboardingView } from '../../server/fn/onboarding.ts';
import { Button, FormError } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { OnboardingFooter, OnboardingHeading } from './onboarding-layout.tsx';

/** Where the user goes once the onboarding is completed: "Ke Ringkasan" or "Atur sekarang" (Settings › Profil). */
export type DoneTarget = 'overview' | 'password';

function SummaryRow({
  icon: Icon,
  color,
  label,
  children,
}: {
  icon: LucideIcon;
  color: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 rounded-[10px] border border-border bg-surface-sunken px-3.5 py-3">
      <span
        {...colorProps(color)}
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-[color-mix(in_srgb,var(--wf-color,var(--subtle))_16%,transparent)] text-[var(--wf-color,var(--subtle))]"
      >
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 text-[13px]">{label}</span>
      <span className="flex items-center gap-2 font-mono text-[12px] text-muted-fg">{children}</span>
    </li>
  );
}

export function DoneStep({ view, onFinished }: { view: OnboardingView; onFinished: (target: DoneTarget) => void }) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const [pending, setPending] = useState<DoneTarget | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const { baseCurrency } = view.progress;
  const accounts = view.accounts.accounts.filter((account) => account.status === 'active');
  const period = periodPreview(periodFor(view.today, periodStartDay(view.startDay)), locale);
  const goalAccount = accounts.find((account) => account.id === view.goal?.accountId);
  const currencies = [baseCurrency, view.extraCurrencies.join(', ')].filter((part) => part !== '').join(' + ');

  const finish = async (target: DoneTarget) => {
    setPending(target);
    setFailure(null);
    const result = await finishOnboarding();
    if (result.ok) onFinished(target);
    else {
      setPending(null);
      setFailure(ledgerErrorMessage(result.code, locale));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <OnboardingHeading title={m.onboarding_done_title()} description={m.onboarding_done_description()} />
      <ul aria-label={m.onboarding_done_summary()} className="flex flex-col gap-2.5">
        <SummaryRow icon={User} color="blue" label={m.onboarding_done_profile({ currencies })}>
          {view.signIn.google ? m.onboarding_done_profile_google() : view.email}
        </SummaryRow>
        <SummaryRow icon={CalendarDays} color="blue" label={m.onboarding_done_period({ day: view.startDay })}>
          {m.onboarding_done_period_range({ month: period.month, range: period.range })}
        </SummaryRow>
        <SummaryRow icon={Landmark} color="green" label={m.onboarding_done_accounts({ count: accounts.length })}>
          <Money minor={view.accounts.availableMinor} currency={baseCurrency} context="amount" locale={locale} />
        </SummaryRow>
        {view.goal === null ? null : (
          <SummaryRow
            icon={ShieldCheck}
            color="blue"
            label={
              goalAccount === undefined
                ? view.goal.name
                : m.onboarding_done_goal({ name: view.goal.name, account: goalAccount.displayName })
            }
          >
            {goalAccount === undefined ? null : (
              <>
                <Money
                  minor={goalAccount.balanceMinor}
                  currency={goalAccount.currency}
                  context="amount"
                  locale={locale}
                />
                <span aria-hidden="true">/</span>
              </>
            )}
            <Money minor={view.goal.targetMinor} currency={view.goal.currency} context="table" locale={locale} />
          </SummaryRow>
        )}
        {view.signIn.google && !view.signIn.password ? (
          <SummaryRow icon={KeyRound} color="violet" label={m.onboarding_done_password()}>
            <span>{m.onboarding_done_password_hint()}</span>
            <Button
              variant="secondary"
              size="sm"
              className="font-sans"
              pending={pending === 'password'}
              disabled={pending !== null}
              onClick={() => void finish('password')}
            >
              <KeyRound aria-hidden="true" className="size-3.5" />
              {m.onboarding_done_password_action()}
            </Button>
          </SummaryRow>
        ) : null}
      </ul>
      {failure === null ? null : <FormError>{failure}</FormError>}
      <OnboardingFooter step="done">
        <Button
          size="sm"
          pending={pending === 'overview'}
          disabled={pending !== null}
          onClick={() => void finish('overview')}
        >
          <ArrowRight aria-hidden="true" className="size-3.5" />
          {m.onboarding_done_action()}
        </Button>
      </OnboardingFooter>
    </div>
  );
}
