// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Detail transaksi" (FR-L4, design `t7l0Cj` right column, `jibQf` transfer parts): what was recorded, where it came
 * from, its attachments, the category's budget this period, and the history ("Riwayat"). "Ubah" edits in place with
 * the Record Transaction form; Duplikat, Pisah, and Hapus go through the page's actions. A deleted transaction (e.g.
 * just split, or opened from an old link) is shown read-only. Beside the table from 1280 px, in a Sheet below.
 */
import { useRouter } from '@tanstack/react-router';
import type { BudgetStatus } from '@wf/db/budgets';
import type { ActivityEntry } from '@wf/db/activity';
import type { TransactionDetail } from '@wf/db/transactions';
import type { Locale } from '@wf/domain/money';
import type { LocalDate } from '@wf/domain/period';
import type { IsoWeekday } from '@wf/domain/recurrence';
import type { TransactionSource } from '@wf/domain/transactions';
import { m } from '@wf/i18n/messages';
import { formatDate, formatTime, toLocalDate, weekdayName } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { PageState } from '@wf/ui/page-state';
import { toast } from '@wf/ui/toast';
import { usePrivacy } from '@wf/ui/privacy';
import { ArrowRight, Check, Copy, History, Pencil, Split, Trash2, X, Zap } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { colorProps } from '../../lib/colors.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { categoryName } from '../../lib/ledger-labels.ts';
import { getBudgetStatus } from '../../server/fn/budget.ts';
import { getTransactionDetail, updateTransaction } from '../../server/fn/transactions.ts';
import { CategoryIcon } from '../category-icon.tsx';
import { valuesFromDetail } from '../ledger/transaction-draft.ts';
import { TransactionForm } from '../ledger/transaction-form.tsx';
import type { LedgerData } from '../ledger/use-transaction-form.ts';
import { usePreferences } from '../preferences.tsx';
import { actionRowOf, rowLabel } from './action-row.ts';
import { RecurrenceBadge, RecurrenceSection, useTransactionRecurrence } from './recurrence-section.tsx';
import { Attachments } from './attachments.tsx';
import { useTransactionActions } from './transaction-actions.tsx';
import { SignedMoney } from './transaction-row.tsx';

export interface TransactionDetailPanelProps {
  readonly id: string;
  readonly ledger: LedgerData;
  readonly timeZone: string;
  readonly today: LocalDate;
  /** `aside`: its own header with ×; `sheet`: inside a Sheet that has them. */
  readonly variant: 'aside' | 'sheet';
  readonly onClose: () => void;
}

type Load =
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly code: string }
  | { readonly state: 'ready'; readonly detail: TransactionDetail };

const SOURCE_LABELS: Readonly<Record<TransactionSource, () => string>> = {
  manual: m.transactions_detail_source_manual,
  quick: m.transactions_detail_source_quick,
  assistant: m.transactions_detail_source_assistant,
  receipt: m.transactions_detail_source_receipt,
  import: m.transactions_detail_source_import,
  gmail: m.transactions_detail_source_gmail,
  recurring: m.transactions_detail_source_recurring,
  period_close: m.transactions_detail_source_period_close,
};

const ACTION_BUTTON =
  'inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-border px-2.5 text-[12.5px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring';

export function TransactionDetailPanel({ id, ledger, timeZone, today, variant, onClose }: TransactionDetailPanelProps) {
  const actions = useTransactionActions();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let live = true;
    void getTransactionDetail({ data: { id } }).then((result) => {
      if (!live) return;
      setLoad(result.ok ? { state: 'ready', detail: result.value } : { state: 'failed', code: result.code });
    });
    return () => {
      live = false;
    };
  }, [id, reload, actions.version]);

  return (
    <div
      className={variant === 'aside' ? 'flex flex-col rounded-[12px] border border-border bg-card' : 'flex flex-col'}
    >
      {variant === 'aside' ? (
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-[13.5px] font-semibold text-fg">{m.transactions_detail_title()}</h2>
          <button
            type="button"
            aria-label={m.transactions_detail_close()}
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-[6px] text-subtle hover:bg-tint-06 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}
      {load.state === 'loading' ? <PageState kind="loading" title={m.transactions_detail_loading()} /> : null}
      {load.state === 'failed' ? <Failed code={load.code} /> : null}
      {load.state === 'ready' ? (
        editing ? (
          <Edit
            detail={load.detail}
            ledger={ledger}
            timeZone={timeZone}
            today={today}
            onDone={(saved) => {
              setEditing(false);
              if (saved) setReload((current) => current + 1);
            }}
          />
        ) : (
          <View
            detail={load.detail}
            ledger={ledger}
            timeZone={timeZone}
            today={today}
            onEdit={() => {
              setEditing(true);
            }}
            onChanged={() => {
              setReload((current) => current + 1);
            }}
          />
        )
      ) : null}
    </div>
  );
}

function Failed({ code }: { code: string }) {
  const { preferences } = usePreferences();
  return (
    <PageState
      kind="error"
      title={m.transactions_detail_failed()}
      description={ledgerErrorMessage(code, preferences.locale)}
    />
  );
}

function Edit({
  detail,
  ledger,
  timeZone,
  today,
  onDone,
}: {
  detail: TransactionDetail;
  ledger: LedgerData;
  timeZone: string;
  today: LocalDate;
  onDone: (saved: boolean) => void;
}) {
  const router = useRouter();
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const [initial] = useState(() => valuesFromDetail(detail, { timeZone, locale }));
  return (
    <div className="p-4">
      <TransactionForm
        mode="edit"
        initial={initial}
        data={ledger}
        locale={locale}
        timeZone={timeZone}
        today={today}
        onCancel={() => {
          onDone(false);
        }}
        onSubmit={async (input) => {
          const result = await updateTransaction({ data: { id: detail.id, input } });
          if (!result.ok) return ledgerErrorMessage(result.code, locale);
          toast({ title: m.transactions_detail_saved() });
          onDone(true);
          await router.invalidate();
          return null;
        }}
      />
    </div>
  );
}

/** One "label: value" row of the panel. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-border py-2.5 last:border-b-0">
      <dt className="w-[84px] shrink-0 text-[12.5px] text-muted-fg">{label}</dt>
      <dd className="min-w-0 flex-1 text-[13px] text-fg">{children}</dd>
    </div>
  );
}

function View({
  detail,
  ledger,
  timeZone,
  today,
  onEdit,
  onChanged,
}: {
  detail: TransactionDetail;
  ledger: LedgerData;
  timeZone: string;
  today: LocalDate;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const { hidden, hiddenLabel } = usePrivacy();
  const actions = useTransactionActions();
  const row = actionRowOf(detail);
  const category = ledger.categories.find((candidate) => candidate.id === detail.categoryId);
  const account = (accountId: string | null) => ledger.accounts.find((candidate) => candidate.id === accountId);
  const deleted = detail.deletedAt !== null;
  const title = detail.merchant ?? detail.description ?? rowLabel(row, ledger);
  const subtitle = detail.merchant === null ? null : detail.description;
  // Its fee and tax are their own transactions, so they come with the detail as `fees`.
  const fees = detail.fees.map((line) => ({
    line,
    category: ledger.categories.find((candidate) => candidate.id === line.categoryId),
  }));
  const date = toLocalDate(detail.occurredAt, timeZone);
  const { recurrence, reload } = useTransactionRecurrence(detail.id, detail.activity.length);
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-start gap-3">
        {category === undefined ? null : <CategoryIcon icon={category.icon} color={category.color} />}
        <div className="flex min-w-0 flex-col">
          <h3 className="truncate text-[15px] font-semibold text-fg">{title}</h3>
          {subtitle === null ? null : <p className="truncate text-[12.5px] text-muted-fg">{subtitle}</p>}
        </div>
      </div>
      <SignedMoney
        amountMinor={detail.type === 'transfer' && row.amountMinor < 0n ? -row.amountMinor : row.amountMinor}
        currency={row.currency}
        locale={locale}
        className="text-[28px] leading-none font-semibold text-fg"
      />
      <div className="flex flex-wrap gap-1.5 text-[11.5px]">
        {deleted ? (
          <span className="rounded-[5px] bg-red-tint-2 px-1.5 py-0.5 text-red-fg">
            {m.transactions_detail_deleted()}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-[5px] bg-green-tint-2 px-1.5 py-0.5 text-green-fg">
            <Check aria-hidden="true" className="size-3" />
            {m.transactions_detail_recorded()}
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-[5px] bg-tint-06 px-1.5 py-0.5 text-muted-fg">
          <Zap aria-hidden="true" className="size-3" />
          {SOURCE_LABELS[detail.source]()}
        </span>
        {recurrence == null ? null : <RecurrenceBadge recurrence={recurrence} />}
      </div>
      {deleted ? <p className="text-[12.5px] text-muted-fg">{m.transactions_detail_deleted_note()}</p> : null}
      {detail.splitParentId === null ? null : (
        <p className="rounded-[8px] bg-tint-06 px-3 py-2 text-[12px] text-muted-fg">
          {m.transactions_detail_split_part()}
        </p>
      )}
      {deleted ? null : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={ACTION_BUTTON} onClick={onEdit}>
            <Pencil aria-hidden="true" className="size-3.5" />
            {m.transactions_detail_edit()}
          </button>
          <button
            type="button"
            className={ACTION_BUTTON}
            onClick={() => {
              actions.duplicate(detail.id);
            }}
          >
            <Copy aria-hidden="true" className="size-3.5" />
            {m.transactions_detail_duplicate()}
          </button>
          {detail.type === 'transfer' ? null : (
            <button
              type="button"
              className={ACTION_BUTTON}
              onClick={() => {
                actions.split(detail.id);
              }}
            >
              <Split aria-hidden="true" className="size-3.5" />
              {m.transactions_detail_split()}
            </button>
          )}
          <button
            type="button"
            className={`${ACTION_BUTTON} text-red-fg`}
            onClick={() => {
              actions.remove([row]);
            }}
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
            {m.transactions_detail_delete()}
          </button>
        </div>
      )}
      <dl className="flex flex-col">
        {detail.type === 'transfer' ? (
          <>
            <Row label={m.transactions_detail_from()}>{account(row.accountId)?.displayName}</Row>
            <Row label={m.transactions_detail_to()}>
              <span className="inline-flex items-center gap-1.5">
                <ArrowRight aria-hidden="true" className="size-3.5 text-subtle" />
                {account(row.toAccountId)?.displayName}
                {detail.transfer !== null && detail.transfer.receivedCurrency !== detail.transfer.sentCurrency ? (
                  <Money
                    minor={detail.transfer.receivedMinor}
                    currency={detail.transfer.receivedCurrency}
                    context="amount"
                    locale={locale}
                    className="text-muted-fg"
                  />
                ) : null}
              </span>
            </Row>
            {fees.map(({ line, category: feeCategory }) => (
              <Row
                key={line.id}
                label={feeCategory === undefined ? m.transactions_detail_fee() : categoryName(feeCategory)}
              >
                <Money minor={line.amountMinor} currency={line.currency} context="delta" locale={locale} />
              </Row>
            ))}
            {detail.transfer === null || detail.transfer.fxDiffBaseMinor === 0n ? null : (
              <Row label={m.transactions_detail_fx_difference()}>
                <Money
                  minor={detail.transfer.fxDiffBaseMinor}
                  currency={ledger.baseCurrency}
                  context="delta"
                  locale={locale}
                />
              </Row>
            )}
          </>
        ) : (
          <>
            <Row label={m.transactions_detail_category()}>
              {category === undefined ? (
                <span className="text-subtle">{m.transactions_detail_uncategorized()}</span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <span
                    {...colorProps(category.color)}
                    aria-hidden="true"
                    className="size-2 rounded-full bg-[var(--wf-color,var(--subtle))]"
                  />
                  {categoryName(category)}
                </span>
              )}
            </Row>
            <Row label={m.transactions_detail_account()}>{account(row.accountId)?.displayName}</Row>
            {fees.map(({ line, category: feeCategory }) => (
              <Row
                key={line.id}
                label={feeCategory === undefined ? m.transactions_detail_fee() : categoryName(feeCategory)}
              >
                <Money minor={line.amountMinor} currency={line.currency} context="delta" locale={locale} />
              </Row>
            ))}
          </>
        )}
        <Row label={m.transactions_detail_date()}>
          {formatDate(date, locale, 'weekday')} {date.slice(0, 4)} · {formatTime(detail.occurredAt, timeZone, locale)}
        </Row>
        {detail.note === null ? null : <Row label={m.transactions_detail_note()}>{detail.note}</Row>}
        <Row label={m.transactions_detail_tags()}>
          {detail.tags.length === 0 ? (
            <span className="text-subtle">{m.transactions_detail_no_tags()}</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {detail.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-[4px] border border-border px-1.5 font-mono text-[11.5px] text-muted-fg"
                >
                  #{tag}
                </span>
              ))}
            </span>
          )}
        </Row>
      </dl>
      {detail.gmailEvidence == null ? null : (
        <details className="rounded-[8px] border border-border p-3 text-[12px]">
          <summary className="cursor-pointer font-medium text-fg">{m.gmail_source()}</summary>
          <p className="mt-2 break-words text-muted-fg">
            {hidden ? hiddenLabel : `${detail.gmailEvidence.from} · ${detail.gmailEvidence.subject}`}
          </p>
          <blockquote className="mt-2 break-words text-muted-fg">
            {hidden ? hiddenLabel : detail.gmailEvidence.excerpt}
          </blockquote>
          <p className="mt-2 text-muted-fg">
            {m.review_amount_label()} ·{' '}
            {m.gmail_confidence({ percent: detail.gmailEvidence.extraction.confidence.amount })}
            {' · '}
            {m.record_date()} · {m.gmail_confidence({ percent: detail.gmailEvidence.extraction.confidence.date })}
            {' · '}
            {m.review_ai_merchant()} ·{' '}
            {m.gmail_confidence({ percent: detail.gmailEvidence.extraction.confidence.merchant })}
            {' · '}
            {m.record_account()} · {m.gmail_confidence({ percent: detail.gmailEvidence.extraction.confidence.account })}
            {' · '}
            {m.review_category_label()} ·{' '}
            {m.gmail_confidence({ percent: detail.gmailEvidence.extraction.confidence.category })}
          </p>
          <a
            className="mt-2 inline-block text-blue-fg underline"
            target="_blank"
            rel="noopener noreferrer"
            href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(detail.gmailEvidence.messageId)}`}
          >
            {m.gmail_open()}
          </a>
          <p className="mt-2 text-subtle">{m.gmail_readonly_note()}</p>
        </details>
      )}
      <Attachments
        transactionId={detail.id}
        attachments={detail.attachments}
        readOnly={deleted}
        label={title}
        timeZone={timeZone}
        onChanged={onChanged}
      />
      {recurrence == null || deleted ? null : (
        <RecurrenceSection
          recurrence={recurrence}
          title={title}
          transactionDate={date}
          route={
            detail.type === 'transfer'
              ? `${account(row.accountId)?.displayName ?? ''} → ${account(row.toAccountId)?.displayName ?? ''}`
              : (account(row.accountId)?.displayName ?? '')
          }
          locale={locale}
          timeZone={timeZone}
          today={today}
          onChanged={() => {
            reload();
            onChanged();
          }}
        />
      )}
      {detail.type === 'expense' && !deleted && category !== undefined ? (
        <BudgetBar categoryId={category.id} label={categoryName(category)} date={date} today={today} />
      ) : null}
      <Timeline activity={detail.activity} timeZone={timeZone} ledger={ledger} />
    </div>
  );
}

/** "56% dari anggaran Belanja Online (Rp2.000.000)" for an expense in the current period's budget. */
function BudgetBar({
  categoryId,
  label,
  date,
}: {
  categoryId: string;
  label: string;
  date: LocalDate;
  today: LocalDate;
}) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const [status, setStatus] = useState<BudgetStatus | null>(null);
  useEffect(() => {
    let live = true;
    void getBudgetStatus({ data: {} }).then((result) => {
      if (live && result.ok) setStatus(result.value);
    });
    return () => {
      live = false;
    };
  }, []);
  const line = status?.lines.find((candidate) => candidate.categoryId === categoryId);
  if (status === null || line === undefined || line.usedBps === null) return null;
  if (date < status.period.start || date > status.period.end) return null;
  const percent = Math.round(line.usedBps / 100);
  return (
    <section aria-label={m.transactions_detail_budget_label()} className="flex flex-col gap-1.5">
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(percent, 100)}
        aria-label={m.transactions_detail_budget_label()}
        className="h-1.5 overflow-hidden rounded-full bg-tint-06"
      >
        <svg viewBox="0 0 100 1" preserveAspectRatio="none" className="block h-full w-full">
          <rect width={Math.min(percent, 100)} height={1} className={percent > 100 ? 'fill-red' : 'fill-violet'} />
        </svg>
      </div>
      <p className="text-[12px] text-muted-fg">
        {m.transactions_detail_budget({ percent, category: label })} (
        <Money minor={line.limitMinor} currency={status.baseCurrency} context="amount" locale={locale} />)
      </p>
    </section>
  );
}

/** "Diulang tiap bulan, tgl 14" for the history entry of a new recurrence. */
function repeatText(meta: ActivityEntry['meta'], locale: Locale): string {
  if (meta['freq'] === 'weekly') {
    return m.transactions_activity_repeat_weekly({
      weekday: weekdayName(Number(meta['weekday']) as IsoWeekday, locale),
    });
  }
  if (meta['freq'] === 'monthly') return m.transactions_activity_repeat_monthly({ day: Number(meta['monthDay']) });
  return m.transactions_activity_repeat_yearly();
}

/** A sentence for one history entry. */
function activityText(entry: ActivityEntry, locale: Locale): string {
  switch (entry.action) {
    case 'recurrence_set':
      return repeatText(entry.meta, locale);
    case 'recurrence_stopped':
      return m.transactions_activity_repeat_stopped({ count: Number(entry.meta['deleted']) });
    case 'recurrence_resumed':
      return m.transactions_activity_repeat_resumed();
    case 'created': {
      const source = entry.meta['source'];
      return source === 'quick' ? m.transactions_activity_created_quick() : m.transactions_activity_created();
    }
    case 'updated': {
      const fields = Array.isArray(entry.meta['fields']) ? entry.meta['fields'] : [];
      if (fields.includes('attachments')) return m.transactions_activity_attachments();
      if (fields.includes('tags') && fields.length === 1) return m.transactions_activity_tags();
      if (fields.includes('categoryId') && fields.length === 1) return m.transactions_activity_category();
      if (fields.includes('accountId') && fields.length === 1) return m.transactions_activity_account();
      return m.transactions_activity_updated();
    }
    case 'deleted':
      return m.transactions_activity_deleted();
    case 'restored':
      return m.transactions_activity_restored();
    case 'duplicated':
      return m.transactions_activity_duplicated();
    case 'split':
      return m.transactions_activity_split();
    default:
      return m.transactions_activity_updated();
  }
}

/** "Riwayat": newest first. */
function Timeline({
  activity,
  timeZone,
}: {
  activity: readonly ActivityEntry[];
  timeZone: string;
  ledger: LedgerData;
}) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  if (activity.length === 0) return null;
  return (
    <section aria-labelledby="transaction-history" className="flex flex-col gap-2">
      <h3 id="transaction-history" className="text-[12.5px] font-medium text-muted-fg">
        {m.transactions_activity_title()}
      </h3>
      <ol className="flex flex-col gap-2.5">
        {[...activity].reverse().map((entry, index) => (
          <li key={`${entry.at.toISOString()}-${String(index)}`} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-tint-06 text-subtle">
              <History aria-hidden="true" className="size-3" />
            </span>
            <span className="flex flex-col">
              <span className="text-[12.5px] text-fg">{activityText(entry, locale)}</span>
              <time dateTime={entry.at.toISOString()} className="font-mono text-[11px] text-subtle">
                {formatDate(toLocalDate(entry.at, timeZone), locale, 'day')} · {formatTime(entry.at, timeZone, locale)}
              </time>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
