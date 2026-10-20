// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Onboarding 2 — periode & pemasukan (design `N1A49s`): the payday (1, 25, 28, or any day 1–28) becomes the monthly
 * period start (preview "Okt 2026 = 1–31 Okt"), and the average monthly income the expected income of the budget.
 */
import { periodFor, periodStartDay } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { ArrowRight, Wallet } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { periodPreview } from '../../lib/onboarding.ts';
import { saveOnboardingPeriod, type OnboardingView } from '../../server/fn/onboarding.ts';
import { Button, Field, FormError, INPUT_FRAME } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { OnboardingBack, OnboardingFooter, OnboardingHeading } from './onboarding-layout.tsx';

/** The design's chips; any other day comes from "Pilih 1–28…". */
const PAYDAYS = [1, 25, 28] as const;
const DAYS = Array.from({ length: 28 }, (_, index) => index + 1);

const CHIP =
  'flex h-9 cursor-pointer items-center rounded-[8px] border px-3.5 text-[13px] font-medium has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring';
const CHIP_ON = 'border-blue bg-blue-tint-1 text-blue-fg';
const CHIP_OFF = 'border-border text-fg hover:bg-muted';

export function PeriodStep({ view, onSaved }: { view: OnboardingView; onSaved: () => void }) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const [day, setDay] = useState<number>(view.startDay);
  const [income, setIncome] = useState<bigint | null>(view.expectedIncomeMinor);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const preview = periodPreview(periodFor(view.today, periodStartDay(day)), locale);
  const custom = !(PAYDAYS as readonly number[]).includes(day);

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setPending(true);
    setFailure(null);
    const result = await saveOnboardingPeriod({ data: { day, expectedIncomeMinor: income } });
    setPending(false);
    if (result.ok) onSaved();
    else setFailure(ledgerErrorMessage(result.code, locale));
  };

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-5">
      <OnboardingHeading title={m.onboarding_period_title()} description={m.onboarding_period_description()} />
      <fieldset className="flex flex-col gap-2" aria-describedby="onboarding-period-preview">
        <legend className="pb-2 text-[12.5px] font-medium text-muted-fg">{m.onboarding_payday()}</legend>
        <div className="flex flex-wrap items-center gap-2">
          {PAYDAYS.map((option, index) => (
            <label key={option} className={`${CHIP} ${day === option ? CHIP_ON : CHIP_OFF}`}>
              <input
                type="radio"
                name="payday"
                value={option}
                checked={day === option}
                onChange={() => {
                  setDay(option);
                }}
                className="sr-only"
              />
              {/* "Tanggal 1 · 25 · 28": only the first chip says "Tanggal"; every radio is named in full. */}
              <span aria-hidden="true">{index === 0 ? m.onboarding_payday_day({ day: option }) : option}</span>
              <span className="sr-only">{m.onboarding_payday_day({ day: option })}</span>
            </label>
          ))}
          <label className={`${CHIP} relative ${custom ? CHIP_ON : CHIP_OFF}`}>
            <span aria-hidden="true">{custom ? m.onboarding_payday_day({ day }) : m.onboarding_payday_other()}</span>
            <select
              aria-label={m.onboarding_payday_other_label()}
              value={custom ? day : ''}
              onChange={(event) => {
                setDay(Number(event.target.value));
              }}
              className="absolute inset-0 cursor-pointer opacity-0"
            >
              <option value="" disabled>
                {m.onboarding_payday_other()}
              </option>
              {DAYS.map((option) => (
                <option key={option} value={option}>
                  {m.onboarding_payday_day({ day: option })}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p id="onboarding-period-preview" className="text-[12px] text-subtle">
          {m.onboarding_period_preview(preview)}
        </p>
      </fieldset>
      <Field label={m.onboarding_income()} hint={m.onboarding_income_hint()}>
        {({ id, describedBy }) => (
          <div className={`${INPUT_FRAME.lg} gap-2.5`}>
            <Wallet aria-hidden="true" className="size-4 shrink-0 text-subtle" />
            <AmountInput
              id={id}
              aria-describedby={describedBy}
              size="inline"
              value={income}
              onValueChange={setIncome}
              currency={view.progress.baseCurrency}
              locale={locale}
            />
          </div>
        )}
      </Field>
      {failure === null ? null : <FormError>{failure}</FormError>}
      <OnboardingFooter step="period" start={<OnboardingBack to="profile" />}>
        <Button type="submit" size="sm" pending={pending}>
          <ArrowRight aria-hidden="true" className="size-3.5" />
          {m.onboarding_next()}
        </Button>
      </OnboardingFooter>
    </form>
  );
}
