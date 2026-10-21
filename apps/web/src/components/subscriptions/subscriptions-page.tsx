// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Langganan" (FR-SUB1–SUB6, design section 07): the header ("7 aktif · 4 tagihan tersisa bulan ini · berikutnya
 * Netflix, 3 hari lagi") with "Deteksi dari transaksi" and "Tambah langganan", the KPIs and cost chart, this month's
 * bill schedule with its warnings, the table with every action, and the review, savings and category cards. Marking a
 * bill paid ("Tandai sudah dibayar", "Ya, catat") goes through the Review queue (`confirmOccurrence`); nothing here
 * writes a transaction directly. Every change reloads the route's data.
 */
import { useRouter } from '@tanstack/react-router';
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import type { DetectedOverview, SubscriptionsOverview, SubscriptionView } from '@wf/db/schedules';
import type { CancelMode, PauseLength, SubscriptionStatus, UsageRating } from '@wf/domain/subscriptions';
import { m } from '@wf/i18n/messages';
import { ConfirmDialog } from '@wf/ui/confirm-dialog';
import { formatDate } from '@wf/ui/dates';
import { EmptyState } from '@wf/ui/empty-state';
import { toast } from '@wf/ui/toast';
import { Plus, Repeat } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { confirmOccurrence, listReviewItems, markReviewUnpaid } from '../../server/fn/review.ts';
import {
  addDetectedSubscriptions,
  cancelSubscription,
  changeSubscriptionAccount,
  deleteSubscription,
  dismissDetectedSubscriptions,
  pauseSubscription,
  rateSubscriptionUsage,
  reactivateSubscription,
} from '../../server/fn/schedules.ts';
import { Button } from '../form.tsx';
import { useRecordTransaction } from '../ledger/record-transaction.tsx';
import { PageHeader } from '../page-header.tsx';
import { usePreferences } from '../preferences.tsx';
import { BillSchedule } from './bill-schedule.tsx';
import { DetectionPanel } from './detection-panel.tsx';
import { CancelDialog, PauseDialog } from './subscription-dialogs.tsx';
import { SubscriptionDetail } from './subscription-detail.tsx';
import { SubscriptionForm } from './subscription-form.tsx';
import { CategoryShareCard, SavingsCard, UsageReviewCard } from './subscription-insights.tsx';
import { SubscriptionKpis } from './subscription-kpis.tsx';
import { SubscriptionTable, type SubscriptionActions, type TableFilter } from './subscription-table.tsx';
import { headerSummary } from './subscriptions-model.ts';

export interface SubscriptionsPageProps {
  readonly overview: SubscriptionsOverview;
  readonly detected: DetectedOverview | null;
  readonly accounts: readonly AccountView[];
  readonly categories: readonly CategoryView[];
  /** This period's spending and a month's expected income ("5,5% dari pengeluaran"); `null` when unknown. */
  readonly spentMinor: bigint | null;
  readonly incomeMinor: bigint | null;
  readonly timeZone: string;
  /** `?subscription=<id>` (⌘K, other pages): its detail opens. */
  readonly initialSubscriptionId?: string;
  /** `?new` (the Overview's "Tambah", ⌘K): the form opens. */
  readonly initialNew?: boolean;
  /** Clears the search params once they have been used. */
  readonly onConsumeSearch: () => void;
}

type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };

export function SubscriptionsPage({
  overview,
  detected,
  accounts,
  categories,
  spentMinor,
  incomeMinor,
  timeZone,
  initialSubscriptionId,
  initialNew = false,
  onConsumeSearch,
}: SubscriptionsPageProps) {
  const router = useRouter();
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const record = useRecordTransaction();
  const { today, baseCurrency } = overview;
  const [tab, setTab] = useState<SubscriptionStatus>('active');
  const [filter, setFilter] = useState<TableFilter | null>(null);
  const [form, setForm] = useState<{ readonly subscription?: SubscriptionView } | null>(initialNew ? {} : null);
  const [detailId, setDetailId] = useState<string | null>(initialSubscriptionId ?? null);
  const [pauseId, setPauseId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [detectOpen, setDetectOpen] = useState(false);
  const [snoozed, setSnoozed] = useState<readonly string[]>([]);
  const byId = (id: string | null) => overview.subscriptions.find((subscription) => subscription.id === id) ?? null;

  // The search can change while the page stays (⌘K on this page): open what it asks for, then drop it from the URL.
  const [search, setSearch] = useState({ id: initialSubscriptionId, isNew: initialNew });
  if (search.id !== initialSubscriptionId || search.isNew !== initialNew) {
    setSearch({ id: initialSubscriptionId, isNew: initialNew });
    if (initialSubscriptionId !== undefined) setDetailId(initialSubscriptionId);
    if (initialNew) setForm({});
  }
  useEffect(() => {
    if (initialSubscriptionId !== undefined || initialNew) onConsumeSearch();
    // onConsumeSearch is a fresh closure each render; the search values are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSubscriptionId, initialNew]);

  /** Runs a change; on success tells the user and reloads the page's data. */
  const run = async <T,>(
    pending: Promise<Result<T>>,
    success: (value: T) => {
      readonly title: string;
      readonly description?: string;
      readonly tone?: 'success' | 'warning';
    },
  ): Promise<boolean> => {
    const result = await pending;
    if (!result.ok) {
      toast({ tone: 'error', title: ledgerErrorMessage(result.code, locale) });
      return false;
    }
    const message = success(result.value);
    toast({
      tone: message.tone ?? 'success',
      title: message.title,
      ...(message.description === undefined ? {} : { description: message.description }),
    });
    await router.invalidate();
    return true;
  };

  const markPaid = (subscription: SubscriptionView, occurrenceId: string) => {
    void run(confirmOccurrence({ data: { occurrenceId } }), () => ({
      title: m.subscriptions_toast_paid({ name: subscription.name }),
      description: m.subscriptions_toast_paid_body(),
    }));
  };

  const notCharged = async (subscription: SubscriptionView, occurrenceId: string) => {
    const queue = await listReviewItems({ data: { reason: 'due_occurrence', limit: 200 } });
    const item = queue.ok
      ? queue.value.items.find((candidate) => candidate.occurrence?.id === occurrenceId)
      : undefined;
    if (item !== undefined) {
      const result = await markReviewUnpaid({ data: { itemId: item.id } });
      if (!result.ok) {
        toast({ tone: 'error', title: ledgerErrorMessage(result.code, locale) });
        return;
      }
    }
    setSnoozed((current) => [...current, occurrenceId]);
    toast({ tone: 'info', title: m.subscriptions_toast_not_charged({ name: subscription.name }) });
  };

  const changeAccount = (subscription: SubscriptionView, account: AccountView) => {
    void run(changeSubscriptionAccount({ data: { id: subscription.id, accountId: account.id } }), (result) => {
      const date = result.effectiveFrom === null ? null : formatDate(result.effectiveFrom, locale, 'day');
      if (result.insufficient !== null && date !== null) {
        return {
          tone: 'warning',
          title: m.subscriptions_toast_account_short({ account: account.displayName, date }),
        };
      }
      return {
        title: m.subscriptions_toast_account({ name: subscription.name, account: account.displayName }),
        ...(date === null ? {} : { description: m.subscriptions_menu_effective({ date }) }),
      };
    });
  };

  const rate = (subscription: SubscriptionView, rating: UsageRating) => {
    void run(rateSubscriptionUsage({ data: { id: subscription.id, rating } }), () => ({
      title: m.subscriptions_toast_rated({ name: subscription.name }),
    }));
  };

  const actions: SubscriptionActions = {
    open: (subscription) => {
      setDetailId(subscription.id);
    },
    edit: (subscription) => {
      setForm({ subscription });
    },
    markPaid,
    changeAccount,
    pause: (subscription) => {
      setPauseId(subscription.id);
    },
    cancel: (subscription) => {
      setCancelId(subscription.id);
    },
    reactivate: (subscription) => {
      void run(reactivateSubscription({ data: { id: subscription.id } }), () => ({
        title: m.subscriptions_toast_reactivated({ name: subscription.name }),
      }));
    },
    remove: (subscription) => {
      setRemoveId(subscription.id);
    },
  };

  const summary = headerSummary(overview);
  const detail = byId(detailId);
  const pausing = byId(pauseId);
  const cancelling = byId(cancelId);
  const removing = byId(removeId);
  const addButton = (
    <Button
      onClick={() => {
        setForm({});
      }}
    >
      <Plus aria-hidden="true" className="size-4" />
      {m.subscriptions_add()}
    </Button>
  );

  return (
    <>
      <PageHeader
        breadcrumb={[m.breadcrumb_finance(), m.nav_subscriptions()]}
        title={m.nav_subscriptions()}
        description={
          overview.subscriptions.length === 0
            ? m.subscriptions_header_empty()
            : [
                m.subscriptions_header_active({ count: summary.active }),
                m.subscriptions_header_remaining({ count: summary.remaining }),
                ...(summary.next === null
                  ? []
                  : [
                      summary.next.days === 0
                        ? m.subscriptions_header_next_today({ name: summary.next.name })
                        : summary.next.days === 1
                          ? m.subscriptions_header_next_tomorrow({ name: summary.next.name })
                          : m.subscriptions_header_next({ name: summary.next.name, days: summary.next.days }),
                    ]),
              ].join(' · ')
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <DetectionPanel
              detected={detected}
              baseCurrency={baseCurrency}
              accounts={accounts}
              categories={categories}
              locale={locale}
              open={detectOpen}
              onOpenChange={setDetectOpen}
              onAdd={async (ids) => {
                await run(addDetectedSubscriptions({ data: { ids: [...ids] } }), (value) => ({
                  title: m.subscriptions_toast_detected_added({ count: value.subscriptionIds.length }),
                }));
              }}
              onDismiss={async (ids) => {
                await run(dismissDetectedSubscriptions({ data: { ids: [...ids] } }), () => ({
                  title: m.subscriptions_toast_detected_dismissed(),
                }));
              }}
            />
            {addButton}
          </div>
        }
      />

      {overview.subscriptions.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title={m.subscriptions_empty_title()}
          description={m.subscriptions_empty_description()}
          actions={addButton}
          note={m.subscriptions_detect_none_hint({ months: 2 })}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <SubscriptionKpis overview={overview} spentMinor={spentMinor} incomeMinor={incomeMinor} locale={locale} />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex min-w-0 flex-col gap-4">
              <BillSchedule
                overview={overview}
                snoozed={snoozed}
                accounts={accounts}
                locale={locale}
                onConfirm={markPaid}
                onNotCharged={(subscription, occurrenceId) => void notCharged(subscription, occurrenceId)}
                onPause={actions.pause}
                onOpen={actions.open}
                onTopUp={(shortfall) => {
                  record.open({
                    type: 'transfer',
                    toAccountId: shortfall.account.id,
                    amountMinor: shortfall.shortMinor,
                  });
                }}
                onChangeAccount={actions.open}
              />
              <SubscriptionTable
                overview={overview}
                accounts={accounts}
                categories={categories}
                locale={locale}
                tab={tab}
                onTabChange={setTab}
                filter={filter}
                onClearFilter={() => {
                  setFilter(null);
                }}
                actions={actions}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <UsageReviewCard overview={overview} locale={locale} onRate={rate} onCancel={actions.cancel} />
              <SavingsCard
                overview={overview}
                detected={detected}
                locale={locale}
                onCancel={actions.cancel}
                onOpen={actions.open}
                onCompare={(ids, label) => {
                  setTab('active');
                  setFilter({ ids, label });
                }}
                onDetect={() => {
                  setDetectOpen(true);
                }}
              />
              <CategoryShareCard
                overview={overview}
                categories={categories}
                locale={locale}
                selected={filter === null || 'ids' in filter ? undefined : filter.categoryId}
                onSelect={(categoryId) => {
                  setTab('active');
                  setFilter((current) =>
                    current !== null && !('ids' in current) && current.categoryId === categoryId
                      ? null
                      : { categoryId },
                  );
                }}
              />
            </div>
          </div>
        </div>
      )}

      <SubscriptionForm
        open={form !== null}
        subscription={form?.subscription}
        accounts={accounts}
        categories={categories}
        baseCurrency={baseCurrency}
        today={today}
        locale={locale}
        onOpenChange={() => {
          setForm(null);
        }}
        onSaved={(saved, created) => {
          setForm(null);
          toast({
            tone: 'success',
            title: created
              ? m.subscriptions_toast_created({ name: saved.name })
              : m.subscriptions_toast_updated({ name: saved.name }),
          });
          void router.invalidate();
        }}
      />
      <SubscriptionDetail
        subscription={detail}
        accounts={accounts}
        categories={categories}
        today={today}
        timeZone={timeZone}
        locale={locale}
        onOpenChange={() => {
          setDetailId(null);
        }}
        onEdit={actions.edit}
        onMarkPaid={markPaid}
        onPause={actions.pause}
        onCancel={actions.cancel}
        onReactivate={actions.reactivate}
        onRate={rate}
        onChangeAccount={changeAccount}
      />
      <PauseDialog
        subscription={pausing}
        overview={overview}
        locale={locale}
        onOpenChange={() => {
          setPauseId(null);
        }}
        onPause={(subscription, length: PauseLength, remindDaysBefore) =>
          run(pauseSubscription({ data: { id: subscription.id, length, remindDaysBefore } }), (paused) => ({
            title: m.subscriptions_toast_paused({ name: paused.name }),
            ...(paused.pausedUntil === null
              ? {}
              : {
                  description: m.subscriptions_pause_resumes({
                    date: formatDate(paused.pausedUntil, locale, 'weekday'),
                  }),
                }),
          }))
        }
      />
      <CancelDialog
        subscription={cancelling}
        accountName={accounts.find((account) => account.id === cancelling?.payFromAccountId)?.displayName ?? '—'}
        locale={locale}
        onOpenChange={() => {
          setCancelId(null);
        }}
        onCancel={(subscription, mode: CancelMode) =>
          run(cancelSubscription({ data: { id: subscription.id, mode } }), (cancelled) => ({
            title: m.subscriptions_toast_cancelled({ name: cancelled.name }),
          }))
        }
      />
      {removing === null ? null : (
        <ConfirmDialog
          open
          onOpenChange={() => {
            setRemoveId(null);
          }}
          title={m.subscriptions_delete_title({ name: removing.name })}
          description={m.subscriptions_delete_description()}
          confirmLabel={m.subscriptions_menu_delete()}
          cancelLabel={m.subscriptions_form_cancel()}
          variant="destructive"
          onConfirm={() => {
            setRemoveId(null);
            void run(deleteSubscription({ data: { id: removing.id } }), () => ({
              title: m.subscriptions_toast_deleted({ name: removing.name }),
            }));
          }}
        />
      )}
    </>
  );
}
