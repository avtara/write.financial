// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Overview's page states (FR-D4): the first-run stepper (design `olRpH`: account → record → budget, with the
 * cards that fill in later), the loading skeleton (`CdNBN`), and the offline panel (`I2SEfl`: "Coba lagi", "Lihat
 * data terakhir · 15 Okt 16.40", `NETWORK_OFFLINE`).
 */
import { Link } from '@tanstack/react-router';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate, formatTime, toLocalDate } from '@wf/ui/dates';
import {
  CalendarDays,
  Check,
  Clock,
  History,
  Lock,
  NotebookPen,
  Plus,
  RefreshCw,
  Repeat,
  Target,
  Wallet,
  Waypoints,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../form.tsx';

const ACTION =
  'inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export interface DashboardSetupProps {
  readonly hasAccount: boolean;
  readonly hasTransaction: boolean;
  readonly hasBudget: boolean;
  /** Opens the Record sheet. */
  readonly onRecord: () => void;
}

interface Step {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly body: string;
  readonly done: boolean;
  readonly locked: boolean;
  readonly action: ReactNode;
  readonly aside?: ReactNode;
}

/** "Siapkan write.financial dalam 3 langkah" and the cards that appear once there is data. */
export function DashboardSetup({ hasAccount, hasTransaction, hasBudget, onRecord }: DashboardSetupProps) {
  const steps: Step[] = [
    {
      icon: Wallet,
      title: m.overview_setup_account_title(),
      body: m.overview_setup_account_body(),
      done: hasAccount,
      locked: false,
      action: (
        <Link
          to="/accounts"
          search={{ new: 'bank' }}
          className={`${ACTION} bg-fg text-primary-fg hover:bg-text-strong`}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          {m.overview_setup_account_action()}
        </Link>
      ),
      aside: (
        <>
          <Clock aria-hidden="true" className="size-3" />
          {m.overview_setup_account_time()}
        </>
      ),
    },
    {
      icon: NotebookPen,
      title: m.overview_setup_record_title(),
      body: m.overview_setup_record_body(),
      done: hasTransaction,
      locked: !hasAccount,
      action: (
        <button
          type="button"
          disabled={!hasAccount}
          onClick={onRecord}
          className={`${ACTION} border border-border text-fg hover:bg-muted disabled:text-subtle disabled:hover:bg-transparent`}
        >
          {m.overview_setup_record_action()}
        </button>
      ),
    },
    {
      icon: Target,
      title: m.overview_setup_budget_title(),
      body: m.overview_setup_budget_body(),
      done: hasBudget,
      locked: !hasAccount,
      action: hasAccount ? (
        <Link to="/budget" className={`${ACTION} border border-border text-fg hover:bg-muted`}>
          {m.overview_setup_budget_action()}
        </Link>
      ) : (
        <span aria-disabled="true" className={`${ACTION} border border-border text-subtle`}>
          {m.overview_setup_budget_action()}
        </span>
      ),
    },
  ];
  const done = steps.filter((step) => step.done).length;
  const placeholders: [LucideIcon, string, string][] = [
    [Waypoints, m.overview_flow_title(), m.overview_placeholder_flow()],
    [CalendarDays, m.overview_calendar_title(), m.overview_placeholder_calendar()],
    [Repeat, m.overview_subs_title(), m.overview_placeholder_subscriptions()],
  ];
  return (
    <>
      <section aria-labelledby="overview-setup" className="flex flex-col rounded-[12px] border border-border bg-card">
        <div className="flex flex-wrap items-start gap-4 border-b border-border px-6 py-5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id="overview-setup" className="text-[15px] font-semibold text-fg">
              {m.overview_setup_title()}
            </h2>
            <p className="text-[12.5px] text-muted-fg">{m.overview_setup_description()}</p>
          </div>
          <div className="flex w-[180px] flex-col items-end gap-1.5">
            <span className="font-mono text-[11.5px] text-subtle">{m.overview_setup_progress({ done })}</span>
            <svg aria-hidden="true" viewBox="0 0 3 1" preserveAspectRatio="none" className="block h-1 w-full">
              <rect width="3" height="1" className="fill-surface-3" />
              <rect width={done} height="1" className="fill-green" />
            </svg>
          </div>
        </div>
        <ol className="grid gap-3 p-6 md:grid-cols-3">
          {steps.map((step, index) => (
            <li
              key={step.title}
              className={`flex flex-col gap-3 rounded-[10px] border p-4 ${step.locked ? 'border-border opacity-70' : 'border-border-strong'}`}
            >
              <span className="flex items-center justify-between">
                <span className="flex size-8 items-center justify-center rounded-[8px] bg-tint-06 text-muted-fg">
                  <step.icon aria-hidden="true" className="size-4" />
                </span>
                <span className="font-mono text-[11px] text-subtle">{m.overview_setup_step({ step: index + 1 })}</span>
              </span>
              <span className="flex flex-col gap-1">
                <h3 className="text-[13.5px] font-semibold text-fg">{step.title}</h3>
                <p className="text-[12px] text-muted-fg">{step.body}</p>
              </span>
              {step.done ? (
                <span className="inline-flex items-center gap-1.5 text-[12.5px] text-green-fg">
                  <Check aria-hidden="true" className="size-3.5" />
                  {m.overview_setup_done()}
                </span>
              ) : (
                <span className="self-start">{step.action}</span>
              )}
              <span className="flex items-center gap-1.5 text-[11px] text-subtle">
                {step.locked ? (
                  <>
                    <Lock aria-hidden="true" className="size-3" />
                    {m.overview_setup_locked()}
                  </>
                ) : (
                  step.aside
                )}
              </span>
            </li>
          ))}
        </ol>
      </section>
      <ul className="grid gap-3 md:grid-cols-3">
        {placeholders.map(([Icon, title, body]) => (
          <li
            key={title}
            className="flex flex-col items-center gap-3 rounded-[12px] border border-border bg-card px-6 py-10 text-center"
          >
            <span className="flex size-10 items-center justify-center rounded-full border border-border text-muted-fg">
              <Icon aria-hidden="true" className="size-4" />
            </span>
            <h2 className="text-[14px] font-semibold text-fg">{title}</h2>
            <p className="max-w-[280px] text-[12.5px] text-muted-fg">{body}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

const BLOCK = 'animate-pulse rounded-[6px] bg-muted';
/** The error code under the offline panel (design `I2SEfl`), the same in every language. */
const OFFLINE_CODE = 'NETWORK_OFFLINE';

/** The cards' outlines while the first load runs. */
export function DashboardSkeleton() {
  return (
    <div role="status" aria-label={m.overview_loading()} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 overflow-hidden rounded-[12px] border border-border bg-card lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex flex-col gap-3 border-border p-5 not-last:border-r">
            <span className={`${BLOCK} h-3 w-24`} />
            <span className={`${BLOCK} h-6 w-36`} />
            <span className={`${BLOCK} h-3 w-20`} />
          </div>
        ))}
      </div>
      <div className="flex gap-3 overflow-hidden">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div
            key={index}
            className="flex h-[150px] w-[188px] shrink-0 flex-col gap-3 rounded-[10px] border border-border bg-card p-3.5"
          >
            <span className={`${BLOCK} size-[22px]`} />
            <span className={`${BLOCK} h-3 w-24`} />
            <span className={`${BLOCK} h-5 w-28`} />
          </div>
        ))}
      </div>
      <div className="flex h-[420px] flex-col gap-4 rounded-[12px] border border-border bg-card p-6">
        <span className={`${BLOCK} h-4 w-40`} />
        <span className={`${BLOCK} h-3 w-64`} />
        <span className={`${BLOCK} mt-6 flex-1`} />
      </div>
    </div>
  );
}

export interface DashboardOfflineProps {
  /** When the last data was loaded; `null` without any ("Lihat data terakhir" is left out). */
  readonly lastLoadedAt: Date | null;
  readonly onRetry: () => void;
  readonly onShowLast: () => void;
  readonly locale: Locale;
  readonly timeZone: string;
}

/** "15 Okt 16.40". */
export function loadedAtLabel(at: Date, locale: Locale, timeZone: string): string {
  return `${formatDate(toLocalDate(at, timeZone), locale, 'day')} ${formatTime(at, timeZone, locale)}`;
}

export function DashboardOffline({ lastLoadedAt, onRetry, onShowLast, locale, timeZone }: DashboardOfflineProps) {
  return (
    <section
      role="alert"
      className="flex flex-col items-center gap-4 rounded-[12px] border border-border bg-card px-6 py-20 text-center"
    >
      <span className="flex size-12 items-center justify-center rounded-[12px] bg-amber-tint-2 text-amber-fg">
        <WifiOff aria-hidden="true" className="size-5" />
      </span>
      <h2 className="text-[17px] font-semibold text-fg">{m.overview_offline_title()}</h2>
      <p className="max-w-[460px] text-[13px] text-muted-fg">{m.overview_offline_body()}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden="true" className="size-3.5" />
          {m.overview_offline_retry()}
        </Button>
        {lastLoadedAt === null ? null : (
          <Button size="sm" variant="secondary" onClick={onShowLast}>
            <History aria-hidden="true" className="size-3.5" />
            {m.overview_offline_last({ at: loadedAtLabel(lastLoadedAt, locale, timeZone) })}
          </Button>
        )}
      </div>
      <code className="rounded-[5px] bg-tint-06 px-2 py-0.5 font-mono text-[11px] text-subtle">{OFFLINE_CODE}</code>
    </section>
  );
}
