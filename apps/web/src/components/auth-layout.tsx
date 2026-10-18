// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The signed-out layout (design Section 16 `GNOjT` and Section 19 `ZAD9u`): the brand panel on the left (640 px at
 * 1440, narrower on tablets, hidden on phones) and the form column on the right, 380 px wide, with the language
 * switcher (FR-S8) in its top corner. Also frames the setup wizard and the forced 2FA enrollment.
 */
import { m } from '@wf/i18n/messages';
import { LOCALES, type Locale } from '@wf/i18n/locale';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import type { ReactNode } from 'react';
import { LogoTile } from './logo-mark.tsx';
import { usePreferences } from './preferences.tsx';

const LOCALE_LABEL: Readonly<Record<Locale, () => string>> = {
  id: m.language_name_id,
  en: m.language_name_en,
};

/** Changes the interface language at once, without a reload (FR-S8). */
export function LocaleSwitcher() {
  const { preferences, setLocale } = usePreferences();
  return (
    <select
      aria-label={m.locale_switcher_label()}
      value={preferences.locale}
      onChange={(event) => {
        const locale = LOCALES.find((candidate) => candidate === event.target.value);
        if (locale !== undefined) setLocale(locale);
      }}
      className="h-8 rounded-[7px] border border-border bg-transparent px-2 text-[12.5px] text-text-secondary hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
    >
      {LOCALES.map((locale) => (
        <option key={locale} value={locale}>
          {LOCALE_LABEL[locale]()}
        </option>
      ))}
    </select>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex w-[168px] flex-col gap-1.5 rounded-[12px] border border-border bg-card p-4">
      <span className="text-[12px] text-muted-fg">{label}</span>
      <span className="text-[20px] font-medium">{children}</span>
    </div>
  );
}

function BrandPanel() {
  const { preferences } = usePreferences();
  return (
    <aside className="hidden w-[42%] max-w-[640px] shrink-0 flex-col justify-between border-r border-border bg-surface-sunken p-10 md:flex xl:w-[640px] xl:p-14">
      <div className="flex items-center gap-2.5">
        <LogoTile variant="rail" />
        <span className="text-[18px] font-semibold text-fg">{m.app_name()}</span>
      </div>
      <div className="flex max-w-[500px] flex-col gap-3.5">
        <p className="text-[28px] leading-tight font-semibold tracking-[-0.01em] text-fg xl:text-[34px]">
          {m.auth_brand_pitch()}
        </p>
        <p className="max-w-[460px] text-[15px] text-muted-fg">{m.auth_brand_promise()}</p>
      </div>
      {/* An illustration of the product, not the visitor's data. */}
      <div aria-hidden="true" className="hidden gap-3 xl:flex">
        <Stat label={m.auth_brand_saving_rate()}>
          <Percent value={0.365} locale={preferences.locale} className="text-green-fg" />
        </Stat>
        <Stat label={m.auth_brand_saved()}>
          <Money minor={9_500_000n} currency="IDR" context="amount" locale={preferences.locale} />
        </Stat>
        <Stat label={m.auth_brand_emergency_fund()}>
          <Percent value={0.21} decimals={0} locale={preferences.locale} className="text-blue-fg" />
        </Stat>
      </div>
    </aside>
  );
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-bg text-fg">
      <BrandPanel />
      <main id="main" className="relative flex min-w-0 flex-1 items-center justify-center px-6 py-16">
        <div className="absolute top-6 right-6">
          <LocaleSwitcher />
        </div>
        <div className="flex w-full max-w-[380px] flex-col gap-[18px]">{children}</div>
      </main>
    </div>
  );
}

/** Title and description at the top of an auth form (26 px / 14 px). */
export function AuthHeading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.01em] text-fg">{title}</h1>
      {description === undefined ? null : <p className="text-[14px] text-muted-fg">{description}</p>}
    </div>
  );
}
