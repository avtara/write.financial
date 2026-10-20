// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Onboarding 1 — profil & mata uang (design `CsGVt`): who signs in (prefilled from Google when the account is linked),
 * full and preferred name with the greeting preview, the base currency (fixed once an account exists, FR-ST1), the
 * additional currencies with today's reference rates, language (applied at once, FR-S8) and time zone (the
 * device's on the first visit).
 */
import type { ReferenceRate } from '@wf/db/fx-rates';
import { LOCALES, type Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { ArrowRight, BadgeCheck, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore, type SyntheticEvent } from 'react';
import { authErrorMessage } from '../../lib/auth-errors.ts';
import { timeZoneLabel } from '../../lib/time-zones.ts';
import { getReferenceRate } from '../../server/fn/ledger.ts';
import { MAX_EXTRA_CURRENCIES, saveOnboardingProfile, type OnboardingView } from '../../server/fn/onboarding.ts';
import { Button, Field, FormError, Select, TextInput } from '../form.tsx';
import { unitValue } from '../ledger/transaction-draft.ts';
import { usePreferences } from '../preferences.tsx';
import { initials } from '../user-menu.tsx';
import { OnboardingFooter, OnboardingHeading } from './onboarding-layout.tsx';

const LOCALE_NAME: Readonly<Record<Locale, () => string>> = { id: m.language_name_id, en: m.language_name_en };
/** Provider id of ExchangeRate-API's open endpoint, whose terms require an attribution next to its rates. */
const EXCHANGE_RATE_API = 'open-er-api';

/**
 * The currencies offered (the fx sources cover them). A fixed list, not `Intl.supportedValuesOf('currency')`: the
 * server's and the browser's ICU differ there (withdrawn codes), which would break hydration.
 */
const CURRENCIES = [
  'IDR',
  'USD',
  'SGD',
  'EUR',
  'JPY',
  'AUD',
  'MYR',
  'CNY',
  'GBP',
  'HKD',
  'KRW',
  'THB',
  'SAR',
  'AED',
  'CHF',
  'CAD',
  'NZD',
  'INR',
  'PHP',
  'VND',
  'TWD',
] as const;

/** The device's time zone does not change while the page is open. */
const subscribeNever = () => () => undefined;

/** The greeting name: the preferred name, else the first word of the full name (as the dashboard does). */
function greetingName(name: string, nickname: string): string {
  return nickname.trim() === '' ? name.trim().replace(/\s.*$/s, '') : nickname.trim();
}

/** Today's reference rate of each code to `quote` (`undefined` while loading, `null` when none is known). */
function useRates(codes: readonly string[], quote: string) {
  const [rates, setRates] = useState<Readonly<Record<string, ReferenceRate | null>>>({});
  const key = codes.join(',');
  useEffect(() => {
    for (const base of key === '' ? [] : key.split(',')) {
      const pair = `${base}/${quote}`;
      void getReferenceRate({ data: { base, quote } }).then((result) => {
        setRates((current) => ({ ...current, [pair]: result.ok ? result.value : null }));
      });
    }
  }, [key, quote]);
  return (base: string) => rates[`${base}/${quote}`];
}

export function ProfileStep({ view, onSaved }: { view: OnboardingView; onSaved: () => void }) {
  const { preferences, setLocale } = usePreferences();
  const { locale } = preferences;
  const { profile, signIn } = view;
  const [name, setName] = useState(profile.name);
  // Suggested from the full name, as the greeting would use it ("Avtara" from "Avtara K.").
  const [nickname, setNickname] = useState(profile.nickname ?? greetingName(profile.name, ''));
  const [baseCurrency, setBaseCurrency] = useState(view.progress.baseCurrency);
  const [extras, setExtras] = useState<readonly string[]>(view.extraCurrencies);
  // First visit: the device's time zone, known only in the browser (`null` while rendering on the server).
  const device = useSyncExternalStore(
    subscribeNever,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => null,
  );
  const [chosenZone, setChosenZone] = useState<string | null>(null);
  const fromDevice =
    chosenZone === null && view.progress.step === 'profile' && device !== null && device !== profile.timezone;
  const timezone = chosenZone ?? (fromDevice ? device : profile.timezone);
  const [nameError, setNameError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const locked = view.accounts.accounts.length > 0;
  const rate = useRates(extras, baseCurrency);

  const currencies = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: 'currency' });
    // `of` falls back to the code itself.
    return CURRENCIES.map((code) => ({ code, name: String(names.of(code)) }));
  }, [locale]);
  const zones = useMemo(() => {
    const all = Intl.supportedValuesOf('timeZone');
    const list = all.includes(timezone) ? all : [timezone, ...all];
    const now = new Date();
    return list.map((zone) => ({ zone, label: timeZoneLabel(zone, locale, now) }));
  }, [timezone, locale]);
  const shownRates = extras.map((code) => ({ code, rate: rate(code) }));

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (name.trim() === '') {
      setNameError(m.onboarding_error_required());
      return;
    }
    setNameError(null);
    setPending(true);
    setFailure(null);
    const result = await saveOnboardingProfile({
      data: {
        name: name.trim(),
        nickname: nickname.trim() === '' ? null : nickname.trim(),
        locale,
        timezone,
        baseCurrency,
        extraCurrencies: [...extras],
      },
    });
    setPending(false);
    if (result.ok) onSaved();
    else {
      setFailure(
        result.code === 'ACCOUNT_LOCKED'
          ? m.onboarding_base_currency_locked()
          : authErrorMessage({ code: result.code }, locale),
      );
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-5">
      <OnboardingHeading
        title={m.onboarding_profile_title({ name: greetingName(profile.name, profile.nickname ?? '') })}
        description={signIn.google ? m.onboarding_profile_description_google() : m.onboarding_profile_description()}
      />
      <section
        aria-label={m.onboarding_profile_account()}
        className="flex items-center gap-3 rounded-[10px] border border-border bg-surface-sunken px-3.5 py-3"
      >
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-[12px] font-semibold"
        >
          {initials({ name: profile.name, email: view.email })}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-medium">{view.email}</span>
          <span className="text-[11.5px] text-subtle">
            {signIn.google ? m.onboarding_profile_google_hint() : m.onboarding_profile_email_hint()}
          </span>
        </span>
        {signIn.google && view.emailVerified ? (
          <span className="flex items-center gap-1.5 rounded-full bg-green-tint-1 px-2.5 py-1 text-[11.5px] text-green-fg">
            <BadgeCheck aria-hidden="true" className="size-3.5" />
            {m.onboarding_profile_verified()}
          </span>
        ) : null}
      </section>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <Field
          label={m.profile_name()}
          aside={
            signIn.google ? (
              <span className="text-[11.5px] text-subtle">{m.onboarding_profile_from_google()}</span>
            ) : undefined
          }
          error={nameError}
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              autoComplete="name"
              maxLength={100}
              required
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </Field>
        <Field
          label={m.profile_nickname()}
          aside={
            <span className="text-[11.5px] text-subtle">
              {m.profile_nickname_hint({ name: greetingName(name, nickname) })}
            </span>
          }
        >
          {({ id }) => (
            <TextInput
              id={id}
              autoComplete="nickname"
              maxLength={100}
              value={nickname}
              onChange={(event) => {
                setNickname(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      <Field
        label={m.onboarding_base_currency()}
        hint={locked ? m.onboarding_base_currency_locked() : m.onboarding_base_currency_hint()}
      >
        {({ id, describedBy }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            disabled={locked}
            value={baseCurrency}
            onChange={(event) => {
              const code = event.target.value;
              setBaseCurrency(code);
              setExtras((current) => current.filter((extra) => extra !== code));
            }}
          >
            {currencies.map(({ code, name: label }) => (
              <option key={code} value={code}>
                {m.onboarding_currency_option({ code, name: label })}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span id="onboarding-extra-currencies" className="text-[12.5px] font-medium text-muted-fg">
            {m.onboarding_extra_currencies()}
          </span>
          <span className="text-[11.5px] text-subtle">{m.onboarding_optional()}</span>
        </div>
        <div
          role="group"
          aria-labelledby="onboarding-extra-currencies"
          className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-[9px] border border-border-input bg-input px-1.5 py-1.5"
        >
          {extras.map((code) => (
            <span
              key={code}
              className="flex items-center gap-1.5 rounded-[6px] border border-border bg-card py-0.5 pr-1 pl-2 text-[12px]"
            >
              <span className="font-mono font-semibold">{code}</span>
              <span className="text-muted-fg">{currencies.find((entry) => entry.code === code)?.name ?? code}</span>
              <button
                type="button"
                aria-label={m.onboarding_extra_currency_remove({ code })}
                onClick={() => {
                  setExtras((current) => current.filter((extra) => extra !== code));
                }}
                className="rounded-[4px] p-0.5 text-subtle hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </span>
          ))}
          {extras.length < MAX_EXTRA_CURRENCIES ? (
            <label className="relative flex items-center gap-1 rounded-[6px] px-1.5 text-[12.5px] font-medium text-blue-fg has-focus-visible:outline-2 has-focus-visible:outline-ring">
              <Plus aria-hidden="true" className="size-3.5" />
              {m.onboarding_extra_currency_add()}
              <select
                aria-label={m.onboarding_extra_currency_add_label()}
                value=""
                onChange={(event) => {
                  const code = event.target.value;
                  setExtras((current) => [...current, code]);
                }}
                className="absolute inset-0 cursor-pointer opacity-0"
              >
                <option value="" disabled>
                  {m.onboarding_extra_currency_add_label()}
                </option>
                {currencies
                  .filter(({ code }) => code !== baseCurrency && !extras.includes(code))
                  .map(({ code, name: label }) => (
                    <option key={code} value={code}>
                      {m.onboarding_currency_option({ code, name: label })}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
        </div>
        <span className="text-[12px] text-subtle">{m.onboarding_extra_currencies_hint()}</span>
      </div>
      {shownRates.length === 0 ? null : (
        <section
          aria-label={m.onboarding_rates_label()}
          className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[9px] bg-surface-sunken px-3.5 py-2.5 text-[12.5px]"
        >
          {shownRates.map(({ code, rate: reference }) => (
            <span key={code} className="font-mono">
              {m.onboarding_rate_one({ currency: code })}{' '}
              {reference == null ? (
                <span className="font-sans text-subtle">
                  {reference === null ? m.onboarding_rate_missing() : m.onboarding_rate_loading()}
                </span>
              ) : (
                <Money minor={unitValue(reference)} currency={reference.quote} context="amount" locale={locale} />
              )}
            </span>
          ))}
          {shownRates.some(({ rate: reference }) => reference?.provider === EXCHANGE_RATE_API) ? (
            <span className="ml-auto text-[11.5px] text-subtle">{m.record_rate_attribution()}</span>
          ) : null}
        </section>
      )}
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <Field label={m.profile_language()}>
          {({ id }) => (
            <Select
              id={id}
              value={locale}
              onChange={(event) => {
                // Applied and saved to the account at once (the root's `onLocaleChange`).
                setLocale(event.target.value as Locale);
              }}
            >
              {LOCALES.map((option) => (
                <option key={option} value={option}>
                  {LOCALE_NAME[option]()}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={m.profile_timezone()}
          aside={
            fromDevice ? (
              <span className="text-[11.5px] text-subtle">{m.onboarding_timezone_from_device()}</span>
            ) : undefined
          }
        >
          {({ id }) => (
            <Select
              id={id}
              value={timezone}
              onChange={(event) => {
                setChosenZone(event.target.value);
              }}
            >
              {zones.map(({ zone, label }) => (
                <option key={zone} value={zone}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {failure === null ? null : <FormError>{failure}</FormError>}
      <OnboardingFooter step="profile">
        <Button type="submit" size="sm" pending={pending}>
          <ArrowRight aria-hidden="true" className="size-3.5" />
          {m.onboarding_next()}
        </Button>
      </OnboardingFooter>
    </form>
  );
}
