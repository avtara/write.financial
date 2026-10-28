// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Overview (`/`, FR-D1/D2/D4): the header with the span switch and pickers, the Quick Add bar (FR-T1), and the
 * dashboard cards — KPIs on top, then accounts, money flow, spending per category, income vs spending, budget,
 * spending calendar, subscriptions, and the addable investments, goals, and bills cards in the user's layout (FR-D3,
 * "Atur dashboard": reorder, hide, ⅓/⅔/full width, saved to the account with "Reset ke default" and "Urungkan"). A user
 * without transactions gets the 3-step setup instead (design `olRpH`); while another span loads the cards stay,
 * dimmed, under "Memperbarui ringkasan…" (`IKIBD`); offline data shown from the last load says so.
 */
import { useRouter } from '@tanstack/react-router';
import type { AccountsOverview } from '@wf/db/accounts';
import type { BudgetStatus } from '@wf/db/budgets';
import type { CategoryView } from '@wf/db/categories';
import type { Dashboard } from '@wf/db/dashboard';
import type { GoalView } from '@wf/db/goals';
import type { PeriodsOverview } from '@wf/db/periods';
import type { Profile } from '@wf/db/profiles';
import type { ScheduledItem, SubscriptionsOverview } from '@wf/db/schedules';
import type { TagView } from '@wf/db/tags';
import type { AutoRuleView } from '@wf/domain/rules';
import { m } from '@wf/i18n/messages';
import { toLocalDate } from '@wf/ui/dates';
import { PageState } from '@wf/ui/page-state';
import { toast } from '@wf/ui/toast';
import { WifiOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  ADDABLE_CARDS,
  DEFAULT_DASHBOARD_LAYOUT,
  sameLayout,
  type DashboardCard,
  type DashboardLayout,
} from '../lib/dashboard-layout.ts';
import { adjacentSearch } from '../lib/dashboard-search.ts';
import { ledgerErrorMessage } from '../lib/ledger-errors.ts';
import type { Result } from '../server/access.ts';
import { saveDashboardLayout } from '../server/fn/dashboard-layout.ts';
import type { InvestmentsOverview } from '../server/fn/investments.ts';
import { AccountsCard } from './dashboard/accounts-card.tsx';
import { BudgetCard } from './dashboard/budget-card.tsx';
import { CalendarCard } from './dashboard/calendar-card.tsx';
import { CashflowCard } from './dashboard/cashflow-card.tsx';
import { CategorySpendingCard } from './dashboard/category-spending-card.tsx';
import { CARD_NAME, DashboardEditor, DashboardGrid, ManageCards } from './dashboard/dashboard-grid.tsx';
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
import { BillsCard, GoalsCard, InvestmentsMiniCard } from './dashboard/extra-cards.tsx';
import { KpiCards } from './dashboard/kpi-cards.tsx';
import { MoneyFlowCard } from './dashboard/money-flow-card.tsx';
import { SubscriptionsCard } from './dashboard/subscriptions-card.tsx';
import { Button } from './form.tsx';
import { QuickAddBar } from './ledger/quick-add-bar.tsx';
import { useRecordTransaction } from './ledger/record-transaction.tsx';
import type { LedgerData } from './ledger/use-transaction-form.ts';
import { usePreferences } from './preferences.tsx';

/** Everything the `/` loader reads; each part fails on its own. */
export interface OverviewData {
  readonly accounts: Result<AccountsOverview>;
  readonly categories: Result<CategoryView[]>;
  readonly tags: Result<TagView[]>;
  readonly rules: Result<AutoRuleView[]>;
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
  /** The saved card layout (FR-D3); the defaults when it could not be read. */
  readonly layout: Result<DashboardLayout>;
  /** The addable cards' data, read only while the card is shown (`null` otherwise). */
  readonly investments: Result<InvestmentsOverview> | null;
  readonly goals: Result<GoalView[]> | null;
  /** Scheduled items from today through 6 days later. */
  readonly bills: Result<ScheduledItem[]> | null;
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

const shown = (layout: DashboardLayout, id: DashboardCard) =>
  layout.cards.some((card) => card.id === id && card.visible);

/** An addable card switched on in a layout not saved yet: its data is read after "Simpan tata letak". */
function PendingCard({ id }: { readonly id: DashboardCard }) {
  return (
    <section className="flex flex-col gap-2 rounded-[12px] border border-border bg-card px-6 py-5">
      <h2 className="text-[15px] font-semibold text-fg">{CARD_NAME[id]()}</h2>
      <p className="text-[13px] text-subtle">{m.dashboard_card_after_save()}</p>
    </section>
  );
}

export function OverviewPage({ data, timeZone, refreshing = false, offline = false }: OverviewPageProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const record = useRecordTransaction();
  const router = useRouter();
  const loadedLayout = valueOf(data.layout) ?? DEFAULT_DASHBOARD_LAYOUT;
  // The layout as saved: from the loader, or from the last "Simpan tata letak" until the loader catches up.
  const [saved, setSaved] = useState(loadedLayout);
  const [layoutSource, setLayoutSource] = useState(data.layout);
  if (layoutSource !== data.layout) {
    setLayoutSource(data.layout);
    setSaved(loadedLayout);
  }
  /** The layout being edited ("Atur dashboard"); `null` outside the edit mode. */
  const [draft, setDraft] = useState<DashboardLayout | null>(null);
  const [managing, setManaging] = useState(false);
  const [saving, setSaving] = useState(false);
  const accounts = valueOf(data.accounts);
  const categories = valueOf(data.categories);
  const tags = valueOf(data.tags);
  const rules = valueOf(data.rules);
  const subscriptions = valueOf(data.subscriptions);
  const periods = valueOf(data.periods);
  const profile = valueOf(data.profile);
  const dashboard = valueOf(data.dashboard);
  const budget = valueOf(data.budget);
  const active = accounts?.accounts.filter((account) => account.status === 'active') ?? [];
  const hasTransactions = active.some((account) => account.transactionCount > 0);
  const ledger: LedgerData | null =
    accounts !== null && categories !== null && tags !== null && rules !== null && active.length > 0
      ? {
          baseCurrency: accounts.baseCurrency,
          accounts: accounts.accounts,
          categories,
          tags,
          rules,
          subscriptionNames: subscriptions?.subscriptions.map((subscription) => subscription.name) ?? [],
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
  const ready = !empty && dashboard !== null && accounts !== null && categories !== null;
  const customizable = ready && !offline && data.layout.ok && draft === null;

  /** Saves `next` over `previous`; reads the data of a card it switched on. `false` when it failed. */
  const persist = async (next: DashboardLayout, previous: DashboardLayout): Promise<boolean> => {
    setSaving(true);
    const result = await saveDashboardLayout({ data: next }).catch(() => null);
    setSaving(false);
    if (result?.ok !== true) {
      toast({ tone: 'error', title: m.dashboard_save_failed() });
      return false;
    }
    setSaved(result.value);
    setDraft(null);
    setManaging(false);
    if (ADDABLE_CARDS.some((id) => shown(result.value, id) && !shown(previous, id))) void router.invalidate();
    return true;
  };
  const save = async (next: DashboardLayout) => {
    const previous = saved;
    if (!(await persist(next, previous))) return;
    toast.undo({
      title: m.dashboard_saved(),
      description: m.dashboard_saved_note(),
      undoLabel: m.record_undo(),
      onUndo: () => {
        void persist(previous, next).then((restored) => {
          if (restored) toast({ tone: 'info', title: m.dashboard_restored() });
        });
      },
    });
  };

  /** The cards' content, from the parts every card needs (all three loaded). */
  const cardsOf =
    (dashboard: Dashboard, accounts: AccountsOverview, categories: CategoryView[]) =>
    (id: DashboardCard): ReactNode => {
      switch (id) {
        case 'accounts':
          return <AccountsCard overview={accounts} dashboard={dashboard} />;
        case 'flow':
          return (
            <MoneyFlowCard
              dashboard={dashboard}
              categories={categories}
              accounts={accounts.accounts}
              locale={locale}
              timeZone={timeZone}
              loadedAt={data.loadedAt}
            />
          );
        case 'categories':
          return (
            <CategorySpendingCard
              dashboard={dashboard}
              budget={
                dashboard.scope !== 'month' ? null : data.shownBudget === null ? budget : valueOf(data.shownBudget)
              }
              categories={categories}
              locale={locale}
              caption={
                dashboard.scope === 'month' && dashboard.period !== null
                  ? longRange(dashboard.ranges.full, locale)
                  : shortRange(dashboard.ranges.full, locale, dashboard.today)
              }
            />
          );
        case 'cashflow':
          return <CashflowCard dashboard={dashboard} locale={locale} />;
        case 'budget':
          return <BudgetCard dashboard={dashboard} categories={categories} locale={locale} />;
        case 'calendar':
          return (
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
          );
        case 'subscriptions':
          return subscriptions === null ? null : <SubscriptionsCard overview={subscriptions} locale={locale} />;
        case 'investments':
          return data.investments === null ? (
            <PendingCard id={id} />
          ) : (
            <InvestmentsMiniCard overview={valueOf(data.investments)} locale={locale} />
          );
        case 'goals':
          return data.goals === null ? (
            <PendingCard id={id} />
          ) : (
            <GoalsCard goals={valueOf(data.goals)} locale={locale} />
          );
        case 'bills':
          return data.bills === null ? (
            <PendingCard id={id} />
          ) : (
            <BillsCard items={valueOf(data.bills)} today={dashboard.today} locale={locale} />
          );
      }
    };

  const hiddenCount = draft?.cards.filter((card) => !card.visible && !ADDABLE_CARDS.includes(card.id)).length ?? 0;

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
        {...(customizable
          ? {
              onCustomize: () => {
                setDraft(saved);
              },
            }
          : {})}
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
      ) : !ready ? (
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
          {draft === null ? null : (
            <section
              aria-labelledby="dashboard-edit-title"
              className="sticky top-2 z-20 flex flex-wrap items-center gap-3 rounded-[12px] border border-border-strong bg-card px-4 py-3 shadow-[0_8px_24px_var(--shadow)]"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <h2 id="dashboard-edit-title" className="text-[14px] font-semibold text-fg">
                  {m.dashboard_edit_title()}
                </h2>
                <p className="text-[12px] text-muted-fg">
                  {m.dashboard_edit_hint()}
                  {hiddenCount === 0 ? null : ` · ${m.dashboard_hidden_count({ count: hiddenCount })}`}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setManaging(true);
                }}
              >
                {m.dashboard_manage()}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={sameLayout(draft, DEFAULT_DASHBOARD_LAYOUT)}
                onClick={() => {
                  setDraft(DEFAULT_DASHBOARD_LAYOUT);
                }}
              >
                {m.dashboard_reset()}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={saving}
                onClick={() => {
                  setDraft(null);
                }}
              >
                {m.dashboard_cancel()}
              </Button>
              <Button
                size="sm"
                pending={saving}
                disabled={sameLayout(draft, saved)}
                onClick={() => {
                  void save(draft);
                }}
              >
                {m.dashboard_save()}
              </Button>
              <ManageCards open={managing} onOpenChange={setManaging} layout={draft} onChange={setDraft} />
            </section>
          )}
          <KpiCards
            kpis={dashboard.kpis}
            comparison={comparisonLabel(dashboard, locale)}
            currency={dashboard.baseCurrency}
            locale={locale}
          />
          {draft === null ? (
            <DashboardGrid layout={saved} render={cardsOf(dashboard, accounts, categories)} />
          ) : (
            <DashboardEditor layout={draft} onChange={setDraft} render={cardsOf(dashboard, accounts, categories)} />
          )}
        </div>
      )}
    </>
  );
}
