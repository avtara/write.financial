// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The account detail panel (FR-R2/R4/R6, design `ycP7T` right column, `I3a8q` low balance, `r3WDF7` needs adjusting):
 * balance, flags, the 6-month chart, this month's flows, and the latest transactions. Savings allocations arrive
 * with Savings (M4). Loads its data on the client (the chart can only render there).
 */
import { Link } from '@tanstack/react-router';
import type { AccountFlows, AccountView } from '@wf/db/accounts';
import { m } from '@wf/i18n/messages';
import { DateLabel } from '@wf/ui/date-label';
import { Money } from '@wf/ui/money';
import { PageState } from '@wf/ui/page-state';
import { Percent } from '@wf/ui/percent';
import { Switch } from '@wf/ui/switch';
import { Archive, ArrowLeftRight, CircleAlert, Pencil, Scale, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { accountMeta, axisStart, changeRatio, daysSinceCheck, STALE_AFTER_DAYS } from '../../lib/accounts.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { categoryName } from '../../lib/ledger-labels.ts';
import { getAccountDetail, type AccountDetail } from '../../server/fn/accounts.ts';
import type { Result } from '../../server/access.ts';
import { CategoryIcon } from '../category-icon.tsx';
import { Button } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { AccountLogo } from './account-logo.tsx';
import { BalanceChart } from './balance-chart.tsx';

/** Flags the panel toggles in place. */
export type AccountFlag = 'includeInAvailable' | 'isDefaultQuickEntry';

export interface AccountDetailPanelProps {
  readonly account: AccountView;
  /** Every account of the user, for transfer counterparts' names. */
  readonly accounts: readonly AccountView[];
  readonly timeZone: string;
  /** Another account already holds the third card slot (FR-R2). */
  readonly onReconcile: () => void;
  readonly onEdit: () => void;
  readonly onArchive: () => void;
  readonly onToggle: (flag: AccountFlag, value: boolean) => void;
}

export function AccountDetailPanel({
  account,
  accounts,
  timeZone,
  onReconcile,
  onEdit,
  onArchive,
  onToggle,
}: AccountDetailPanelProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const [detail, setDetail] = useState<{ id: string; result: Result<AccountDetail> } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { id, balanceMinor } = account;
  const updatedAt = account.updatedAt.getTime();

  useEffect(() => {
    let current = true;
    void getAccountDetail({ data: { id } }).then((result) => {
      if (current) setDetail({ id, result });
    });
    return () => {
      current = false;
    };
    // Reloads when the account's balance or fields change, and on "Coba lagi".
  }, [id, balanceMinor, updatedAt, attempt]);

  const archived = account.status === 'archived';
  const loaded = detail?.id === account.id ? detail.result : null;
  const money = { currency: account.currency, locale } as const;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 border-b border-border p-5">
        <AccountLogo account={account} size="lg" />
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate text-[15px] font-semibold text-fg">{account.displayName}</h2>
          <span className="font-mono text-[11.5px] text-subtle">{accountMeta(account)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-b border-border p-5">
        <Money minor={account.balanceMinor} {...money} context="amount" className="text-[28px] font-semibold text-fg" />
        <div className="flex flex-wrap gap-1.5 text-[11.5px]">
          {account.isDefaultQuickEntry ? (
            <span className="inline-flex items-center gap-1 rounded-[5px] border border-border px-1.5 py-0.5 text-muted-fg">
              <Zap aria-hidden="true" className="size-3" />
              {m.accounts_flag_default()}
            </span>
          ) : null}
          {loaded?.ok === true ? (
            <span className="inline-flex items-center gap-1 rounded-[5px] bg-tint-04 px-1.5 py-0.5 font-mono">
              <Money
                minor={
                  loaded.value.flows.inflowMinor -
                  loaded.value.flows.outflowMinor +
                  loaded.value.flows.transferInMinor -
                  loaded.value.flows.transferOutMinor
                }
                {...money}
                context="delta"
              />
              <span className="text-subtle">{m.accounts_this_month()}</span>
            </span>
          ) : null}
        </div>
        {archived ? null : (
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" onClick={onReconcile}>
              <Scale aria-hidden="true" className="size-3.5" />
              {m.accounts_adjust()}
            </Button>
            <Button size="sm" variant="secondary" onClick={onEdit}>
              <Pencil aria-hidden="true" className="size-3.5" />
              {m.accounts_edit()}
            </Button>
          </div>
        )}
        <Warnings account={account} timeZone={timeZone} today={loaded?.ok === true ? loaded.value.today : null} />
      </div>

      {loaded === null ? (
        <PageState kind="loading" title={m.accounts_detail_loading()} />
      ) : !loaded.ok ? (
        <PageState
          kind="error"
          title={ledgerErrorMessage(loaded.code, locale)}
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setAttempt((count) => count + 1);
              }}
            >
              {m.accounts_retry()}
            </Button>
          }
        />
      ) : (
        <>
          <section aria-label={m.accounts_chart_title()} className="flex flex-col gap-2 border-b border-border p-5">
            <ChartHeader detail={loaded.value} locale={locale} />
            <BalanceChart
              series={loaded.value.series}
              startMinor={axisStart(loaded.value.series.map(({ closingBalanceMinor }) => closingBalanceMinor))}
              locale={locale}
              label={m.accounts_chart_title()}
            />
            <p className="text-[11px] text-subtle">
              {m.accounts_chart_axis()}{' '}
              <Money
                minor={axisStart(loaded.value.series.map((point) => point.closingBalanceMinor))}
                {...money}
                context="amount"
              />
            </p>
          </section>

          <dl className="grid grid-cols-3 gap-3 border-b border-border p-5">
            {flowLines(loaded.value.flows).map(([label, minor]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <dt className="text-[11.5px] text-subtle">{label}</dt>
                <dd className="text-[13px] font-medium">
                  <Money minor={minor} {...money} context="delta" />
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {archived ? null : (
        <div className="flex flex-col gap-3 border-b border-border p-5">
          <Switch
            label={m.accounts_flag_available()}
            description={m.accounts_flag_available_hint()}
            checked={account.includeInAvailable}
            onChange={(event) => {
              onToggle('includeInAvailable', event.target.checked);
            }}
          />
          <Switch
            label={m.accounts_flag_default_long()}
            description={m.accounts_flag_default_hint()}
            disabled={account.isDefaultQuickEntry}
            checked={account.isDefaultQuickEntry}
            onChange={(event) => {
              onToggle('isDefaultQuickEntry', event.target.checked);
            }}
          />
        </div>
      )}

      {loaded?.ok === true ? (
        <section aria-label={m.accounts_recent()} className="flex flex-col gap-2 border-b border-border p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[12.5px] text-muted-fg">{m.accounts_recent()}</h3>
            <Link
              to="/transactions"
              search={{ account: account.id }}
              className="rounded-[6px] px-1.5 py-0.5 text-[12px] text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
            >
              {m.accounts_view_transactions_all()}
            </Link>
          </div>
          {loaded.value.recent.length === 0 ? (
            <p className="text-[12.5px] text-subtle">{m.accounts_recent_empty()}</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {loaded.value.recent.map((row) => {
                const category = loaded.value.categories.find((candidate) => candidate.id === row.categoryId);
                const incoming = row.accountId !== account.id;
                const counterpart = accounts.find((other) => other.id === (incoming ? row.accountId : row.toAccountId));
                const title =
                  row.merchant ??
                  row.description ??
                  (category === undefined ? null : categoryName(category)) ??
                  (row.type === 'transfer'
                    ? m.accounts_recent_transfer({ name: counterpart?.displayName ?? '—' })
                    : m.accounts_recent_untitled());
                return (
                  <li key={row.id} className="flex items-center gap-2.5">
                    {category === undefined ? (
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-tint-06 text-muted-fg">
                        <ArrowLeftRight aria-hidden="true" className="size-3.5" />
                      </span>
                    ) : (
                      <CategoryIcon icon={category.icon} color={category.color} />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13px] text-fg">{title}</span>
                      <DateLabel
                        instant={row.occurredAt}
                        timeZone={timeZone}
                        locale={locale}
                        format="day"
                        className="font-mono text-[11px] text-subtle"
                      />
                    </span>
                    <Money
                      minor={incoming ? (row.receivedMinor ?? 0n) : row.amountMinor}
                      currency={incoming ? (row.receivedCurrency ?? account.currency) : row.currency}
                      context="delta"
                      locale={locale}
                      className="text-[12.5px]"
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {archived ? null : (
        <div className="p-5">
          <button
            type="button"
            onClick={onArchive}
            className="flex w-full items-center gap-2 rounded-[8px] px-2 py-2 text-left text-[12.5px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Archive aria-hidden="true" className="size-3.5" />
            {m.accounts_archive_action()}
            <span className="text-subtle">· {m.accounts_archive_action_hint()}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** "Masuk", "Keluar", "Transfer keluar", and "Transfer masuk" when there was any; outgoing amounts negative. */
function flowLines(flows: AccountFlows): (readonly [string, bigint])[] {
  const lines = [
    [m.accounts_flow_in(), flows.inflowMinor],
    [m.accounts_flow_out(), -flows.outflowMinor],
    [m.accounts_flow_transfer_out(), -flows.transferOutMinor],
  ] as const;
  return flows.transferInMinor > 0n ? [...lines, [m.accounts_flow_transfer_in(), flows.transferInMinor]] : [...lines];
}

function ChartHeader({ detail, locale }: { detail: AccountDetail; locale: 'id' | 'en' }) {
  const first = detail.series[0]?.closingBalanceMinor ?? 0n;
  const last = detail.series.at(-1)?.closingBalanceMinor ?? 0n;
  const ratio = changeRatio(first, last);
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-[12.5px] text-muted-fg">{m.accounts_chart_title()}</h3>
      {ratio === null ? null : (
        <Percent
          value={ratio}
          locale={locale}
          signed
          className={`text-[12px] ${ratio < 0 ? 'text-red-fg' : 'text-green-fg'}`}
        />
      )}
    </div>
  );
}

/** "Perlu disesuaikan" after 14 days without a check (FR-R4), and the low-balance warning (FR-R2, `I3a8q`). */
function Warnings({ account, timeZone, today }: { account: AccountView; timeZone: string; today: string | null }) {
  const { preferences } = usePreferences();
  if (today === null || account.status === 'archived') return null;
  const days = daysSinceCheck(account, today as AccountDetail['today'], timeZone);
  const threshold = account.lowBalanceThresholdMinor;
  const low = threshold !== null && account.balanceMinor < threshold;
  if (days <= STALE_AFTER_DAYS && !low) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {days > STALE_AFTER_DAYS ? (
        <p className="flex items-center gap-2 rounded-[8px] bg-amber-tint-2 px-2.5 py-1.5 text-[12px] text-amber-fg">
          <CircleAlert aria-hidden="true" className="size-3.5" />
          {m.accounts_stale_warning({ days })}
        </p>
      ) : null}
      {low ? (
        <p className="flex items-center gap-2 rounded-[8px] bg-red-tint-2 px-2.5 py-1.5 text-[12px] text-red-fg">
          <CircleAlert aria-hidden="true" className="size-3.5" />
          {m.accounts_low_balance()}{' '}
          <Money minor={threshold} currency={account.currency} context="amount" locale={preferences.locale} />
        </p>
      ) : null}
    </div>
  );
}
