// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Overview (`/`, FR-D1/D2/D4): the header with the span switch and pickers, the Quick Add bar (FR-T1), and the
 * dashboard cards — KPIs, accounts, money flow, spending per category, income vs spending, budget, spending calendar,
 * subscriptions. A user without transactions gets the 3-step setup instead (design `olRpH`); while another span
 * loads the cards stay, dimmed, under "Memperbarui ringkasan…" (`IKIBD`); offline data shown from the last load
 * says so.
 */
import type { AccountsOverview } from '@wf/db/accounts';
import type { BudgetStatus } from '@wf/db/budgets';
import type { CategoryView } from '@wf/db/categories';
import type { Dashboard } from '@wf/db/dashboard';
import type { PeriodsOverview } from '@wf/db/periods';
import type { Profile } from '@wf/db/profiles';
import type { ScheduledItem, SubscriptionsOverview } from '@wf/db/schedules';
import type { TagView } from '@wf/db/tags';
import { m } from '@wf/i18n/messages';
import { toLocalDate } from '@wf/ui/dates';
import { PageState } from '@wf/ui/page-state';
import { WifiOff } from 'lucide-react';
import { adjacentSearch } from '../lib/dashboard-search.ts';
import { ledgerErrorMessage } from '../lib/ledger-errors.ts';
import type { Result } from '../server/access.ts';
import { AccountsCard } from './dashboard/accounts-card.tsx';
import { BudgetCard } from './dashboard/budget-card.tsx';
import { CalendarCard } from './dashboard/calendar-card.tsx';
import { CashflowCard } from './dashboard/cashflow-card.tsx';
import { CategorySpendingCard } from './dashboard/category-spending-card.tsx';
import { DashboardHeader } from './dashboard/dashboard-header.tsx';
import {
  comparisonLabel,
  greeting,
  longRange,
  periodButtonLabel,
  shortRange,
  summaryLine,
} from './dashboard/dashboard-format.ts';
import { DashboardSetup, loadedAtLabel } from './dashboard/dashboard-states.tsx';
import { KpiCards } from './dashboard/kpi-cards.tsx';
import { MoneyFlowCard } from './dashboard/money-flow-card.tsx';
import { SubscriptionsCard } from './dashboard/subscriptions-card.tsx';
import { QuickAddBar } from './ledger/quick-add-bar.tsx';
import { useRecordTransaction } from './ledger/record-transaction.tsx';
import type { LedgerData } from './ledger/use-transaction-form.ts';
import { usePreferences } from './preferences.tsx';

/** Everything the `/` loader reads; each part fails on its own. */
export interface OverviewData {
  readonly accounts: Result<AccountsOverview>;
  readonly categories: Result<CategoryView[]>;
  readonly tags: Result<TagView[]>;
  readonly periods: Result<PeriodsOverview>;
  readonly profile: Result<Profile>;
  readonly dashboard: Result<Dashboard>;
  /** The current period's budget (the Quick Add notes). */
  readonly budget: Result<BudgetStatus>;
  /** The budget of another period shown (month scope); `null` for the current one or other scopes. */
  readonly shownBudget: Result<BudgetStatus> | null;
  readonly subscriptions: Result<SubscriptionsOverview>;
  /** Scheduled bills in the dashboard's span; `null` without a dashboard. */
  readonly scheduled: Result<ScheduledItem[]> | null;
  readonly loadedAt: Date;
}

export interface OverviewPageProps {
  readonly data: OverviewData;
  readonly timeZone: string;
  /** Another span is loading: keep these cards, dimmed. */
  readonly refreshing?: boolean;
  /** Shown from the last load while offline. */
  readonly offline?: boolean;
}

const valueOf = <T,>(result: Result<T> | null): T | null => (result?.ok === true ? result.value : null);

export function OverviewPage({ data, timeZone, refreshing = false, offline = false }: OverviewPageProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const record = useRecordTransaction();
  const accounts = valueOf(data.accounts);
  const categories = valueOf(data.categories);
  const tags = valueOf(data.tags);
  const periods = valueOf(data.periods);
  const profile = valueOf(data.profile);
  const dashboard = valueOf(data.dashboard);
  const budget = valueOf(data.budget);
  const active = accounts?.accounts.filter((account) => account.status === 'active') ?? [];
  const hasTransactions = active.some((account) => account.transactionCount > 0);
  const ledger: LedgerData | null =
    accounts !== null && categories !== null && tags !== null && active.length > 0
      ? {
          baseCurrency: accounts.baseCurrency,
          accounts: accounts.accounts,
          categories,
          tags,
          ...(budget === null ? {} : { budget: { lines: budget.lines, currency: budget.baseCurrency } }),
        }
      : null;
  const name = profile?.nickname ?? profile?.name.split(' ')[0] ?? '';
  const empty = !hasTransactions;
  // Read only where one of these failed (the cards need all three), so it is set there.
  const failure = [data.dashboard, data.accounts, data.categories].find((result) => !result.ok) as {
    readonly ok: false;
    readonly code: string;
  };
  const title = empty
    ? m.overview_greeting_welcome({ name })
    : greeting(data.loadedAt, timeZone, name).replace(/, $/, '');

  return (
    <>
      <DashboardHeader
        title={title}
        description={
          empty ? m.overview_summary_empty() : dashboard === null ? undefined : summaryLine(dashboard, locale)
        }
        dashboard={empty ? null : dashboard}
        periods={periods}
        canRecord={ledger !== null}
        refreshing={refreshing}
      />
      {ledger === null ? null : (
        <QuickAddBar data={ledger} locale={locale} timeZone={timeZone} today={toLocalDate(new Date(), timeZone)} />
      )}
      {offline ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-[10px] border border-amber-tint-4 bg-amber-tint-1 px-4 py-2.5 text-[12.5px] text-amber-fg"
        >
          <WifiOff aria-hidden="true" className="size-3.5" />
          {m.overview_offline_showing({ at: loadedAtLabel(data.loadedAt, locale, timeZone) })}
        </p>
      ) : null}
      {empty ? (
        <div className="flex flex-col gap-4">
          <KpiCards kpis={null} comparison="" currency={accounts?.baseCurrency ?? 'IDR'} locale={locale} />
          <DashboardSetup
            hasAccount={active.length > 0}
            hasTransaction={false}
            hasBudget={(budget?.lines.length ?? 0) > 0}
            onRecord={() => {
              record.open();
            }}
          />
        </div>
      ) : dashboard === null || accounts === null || categories === null ? (
        <section className="rounded-[12px] border border-border bg-card">
          <PageState
            kind="error"
            title={m.overview_load_failed()}
            description={ledgerErrorMessage(failure.code, locale)}
          />
        </section>
      ) : (
        <div
          aria-busy={refreshing}
          className={`flex flex-col gap-4 transition-opacity ${refreshing ? 'opacity-50' : ''}`}
        >
          <KpiCards
            kpis={dashboard.kpis}
            comparison={comparisonLabel(dashboard, locale)}
            currency={dashboard.baseCurrency}
            locale={locale}
          />
          <AccountsCard overview={accounts} dashboard={dashboard} />
          <MoneyFlowCard
            dashboard={dashboard}
            categories={categories}
            accounts={accounts.accounts}
            locale={locale}
            timeZone={timeZone}
            loadedAt={data.loadedAt}
          />
          <CategorySpendingCard
            dashboard={dashboard}
            budget={dashboard.scope !== 'month' ? null : data.shownBudget === null ? budget : valueOf(data.shownBudget)}
            categories={categories}
            locale={locale}
            caption={
              dashboard.scope === 'month' && dashboard.period !== null
                ? longRange(dashboard.ranges.full, locale)
                : shortRange(dashboard.ranges.full, locale, dashboard.today)
            }
          />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <CashflowCard dashboard={dashboard} locale={locale} />
            <BudgetCard dashboard={dashboard} categories={categories} locale={locale} />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <CalendarCard
              key={`${dashboard.ranges.full.from}-${dashboard.scope}`}
              dashboard={dashboard}
              categories={categories}
              scheduled={valueOf(data.scheduled)}
              periodLabels={(periods?.periods ?? []).map((period) => period.label)}
              navigation={{
                label: periodButtonLabel(dashboard, locale),
                previous: adjacentSearch(dashboard, periods?.periods ?? [], -1),
                next: adjacentSearch(dashboard, periods?.periods ?? [], 1),
              }}
              locale={locale}
              timeZone={timeZone}
            />
            {data.subscriptions.ok ? <SubscriptionsCard overview={data.subscriptions.value} locale={locale} /> : null}
          </div>
        </div>
      )}
    </>
  );
}
