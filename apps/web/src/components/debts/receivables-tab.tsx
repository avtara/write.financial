// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The "Piutang" tab of the Debts page (FR-U7, design KZZZy): the active receivables (person, source — split bill or
 * cash loan — with what it was for, the lent date and account, the due date with its countdown and reminder, the
 * repaid share, and what is left) with "Terima pembayaran", "Salin pengingat" (a friendly message for the user to send
 * themselves; write.financial never contacts anyone), and "Hapuskan"; those settled or written off in the last 90
 * days; and "Cara write.financial menghitung".
 */
import type { AccountView } from '@wf/db/accounts';
import type { ReceivableView } from '@wf/db/receivables';
import { formatMoney } from '@wf/domain/money';
import type { LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate, toLocalDate } from '@wf/ui/dates';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@wf/ui/dropdown-menu';
import { EmptyState } from '@wf/ui/empty-state';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { usePrivacy } from '@wf/ui/privacy';
import { toast } from '@wf/ui/toast';
import {
  ArrowRightLeft,
  ChartPie,
  CircleCheck,
  CircleX,
  Copy,
  Ellipsis,
  HandCoins,
  Scale,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { avatarClass, receivableBadge, reminderClock, type ReceivableBadge } from '../../lib/receivables.ts';
import type { DebtsOverview } from '../../server/fn/debts.ts';
import { BudgetBar } from '../budget/budget-bar.tsx';
import { weekdayName } from '../dashboard/dashboard-format.ts';
import { Button } from '../form.tsx';
import { RichMessage } from '../rich-message.tsx';
import { initials } from '../user-menu.tsx';

/** "Cara write.financial menghitung" (design `Rfo4R`). */
const RULES: readonly { readonly icon: LucideIcon; readonly text: () => string }[] = [
  { icon: Scale, text: m.receivables_how_split },
  { icon: ArrowRightLeft, text: m.receivables_how_lend },
  { icon: Wallet, text: m.receivables_how_receive },
  { icon: ChartPie, text: m.receivables_how_net_worth },
  { icon: CircleX, text: m.receivables_how_write_off },
];

const BADGE_TONE = {
  partial: 'bg-blue-tint-2 text-blue-fg',
  neutral: 'bg-muted text-muted-fg',
  soon: 'bg-amber-tint-2 text-amber-fg',
  overdue: 'bg-red-tint-2 text-red-fg',
} as const;

export interface ReceivablesTabProps {
  readonly overview: DebtsOverview;
  readonly locale: Locale;
  readonly onRecord: () => void;
  readonly onReceive: (receivable: ReceivableView) => void;
  readonly onWriteOff: (receivable: ReceivableView) => void;
}

export function ReceivablesTab({ overview, locale, onRecord, onReceive, onWriteOff }: ReceivablesTabProps) {
  const { active, history, outstandingMinor } = overview.receivables;
  const { baseCurrency, accounts } = overview.accounts;
  const accountName = (id: string) => accounts.find((account) => account.id === id)?.displayName;
  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      {active.length === 0 && history.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title={m.receivables_empty_title()}
          description={m.receivables_empty_description()}
          actions={
            <Button variant="secondary" onClick={onRecord}>
              <HandCoins aria-hidden="true" className="size-3.5" />
              {m.debts_record_receivable()}
            </Button>
          }
        />
      ) : (
        <section aria-label={m.receivables_active()} className="min-w-0 rounded-[12px] border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-4 py-3.5">
            <h2 className="text-[14px] font-semibold text-fg">{m.receivables_active()}</h2>
            <Money
              minor={outstandingMinor}
              currency={baseCurrency}
              context="amount"
              locale={locale}
              className="text-[13px] font-medium text-fg"
            />
          </header>
          <ul>
            {active.map((receivable) => (
              <li key={receivable.id} className="border-b border-border last:border-b-0">
                <ReceivableItem
                  receivable={receivable}
                  today={overview.today}
                  account={accountName(receivable.fromAccountId)}
                  reminderTime={overview.reminderTime}
                  locale={locale}
                  onReceive={onReceive}
                  onWriteOff={onWriteOff}
                />
              </li>
            ))}
          </ul>
          {history.length === 0 ? null : (
            <section aria-label={m.receivables_history()} className="flex flex-col gap-2 border-t border-border p-4">
              <h3 className="text-[10.5px] font-medium tracking-[0.06em] text-subtle uppercase">
                {m.receivables_history()}
              </h3>
              <ul className="flex flex-col gap-2">
                {history.map((receivable) => (
                  <HistoryRow
                    key={receivable.id}
                    receivable={receivable}
                    accounts={accounts}
                    timeZone={overview.timeZone}
                    locale={locale}
                  />
                ))}
              </ul>
            </section>
          )}
        </section>
      )}
      <aside
        aria-labelledby="receivables-how"
        className="flex flex-col gap-3 rounded-[12px] border border-border bg-card p-4"
      >
        <h2 id="receivables-how" className="text-[10.5px] font-medium tracking-[0.06em] text-subtle uppercase">
          {m.receivables_how_title()}
        </h2>
        <ul className="flex flex-col gap-3">
          {RULES.map(({ icon: Icon, text }) => (
            <li key={text()} className="flex gap-2.5 text-[12.5px] text-text-secondary">
              <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-fg" />
              {text()}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function Badge({ badge }: { badge: ReceivableBadge }) {
  const tone = badge.kind === 'partial' ? 'partial' : badge.tone;
  const text =
    badge.kind === 'partial'
      ? m.receivables_badge_partial()
      : badge.days === 0
        ? m.receivables_badge_today()
        : badge.days < 0
          ? m.receivables_badge_overdue({ days: -badge.days })
          : m.receivables_badge_days({ days: badge.days });
  return <span className={`rounded-[5px] px-1.5 py-px text-[11px] font-medium ${BADGE_TONE[tone]}`}>{text}</span>;
}

function ReceivableItem({
  receivable,
  today,
  account,
  reminderTime,
  locale,
  onReceive,
  onWriteOff,
}: {
  readonly receivable: ReceivableView;
  readonly today: LocalDate;
  readonly account: string | undefined;
  readonly reminderTime: string;
  readonly locale: Locale;
  readonly onReceive: (receivable: ReceivableView) => void;
  readonly onWriteOff: (receivable: ReceivableView) => void;
}) {
  const { counterparty, currency, dueDate } = receivable;
  const { hidden } = usePrivacy();
  const badge = receivableBadge(receivable, today);
  // "Min, 18 Okt".
  const due = dueDate === null ? null : `${weekdayName(dueDate, locale)}, ${formatDate(dueDate, locale, 'day')}`;
  const source = [
    receivable.source === 'split_bill' ? m.receivables_source_split_bill() : m.receivables_source_loan(),
    receivable.description,
    formatDate(receivable.lentOn, locale, 'day'),
    account === undefined ? null : m.receivables_from({ account }),
  ]
    .filter((part) => part !== null)
    .join(' · ');
  const lastPayment = receivable.payments.at(-1);
  const schedule: ReactNode[] = [due === null ? m.receivables_no_due() : m.receivables_due({ date: due })];
  if (lastPayment !== undefined) {
    schedule.push(
      <RichMessage
        key="paid"
        message={m.receivables_last_paid}
        slots={{
          amount: <Money minor={lastPayment.amountMinor} currency={currency} context="amount" locale={locale} />,
          date: formatDate(lastPayment.receivedOn, locale, 'day'),
        }}
      />,
    );
  } else if (receivable.remind && due !== null) {
    schedule.push(m.receivables_reminder({ time: reminderClock(reminderTime, locale) }));
  }

  const copy = () => {
    const amount = formatMoney(receivable.remainingMinor, currency, {
      locale,
      context: 'amount',
      privacy: hidden,
    });
    const what = receivable.description ?? m.receivables_reminder_loan();
    const text =
      due === null
        ? m.receivables_reminder_text({ name: counterparty, what, amount })
        : m.receivables_reminder_text_due({ name: counterparty, what, amount, date: due });
    navigator.clipboard.writeText(text).then(
      () => {
        toast({ tone: 'success', title: m.receivables_copied({ name: counterparty }) });
      },
      () => {
        toast({ tone: 'error', title: m.receivables_copy_failed() });
      },
    );
  };

  return (
    <article aria-label={counterparty} className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`flex size-[34px] shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${avatarClass(counterparty)}`}
        >
          {initials({ name: counterparty, email: counterparty })}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold text-fg">{counterparty}</span>
            {badge === null ? null : <Badge badge={badge} />}
          </span>
          <span className="text-[12px] text-subtle">{source}</span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <Money
            minor={receivable.remainingMinor}
            currency={currency}
            context="amount"
            locale={locale}
            className="text-[15px] font-medium text-fg"
          />
          <span className="text-[11.5px] text-subtle">
            {receivable.paidMinor === 0n ? (
              m.receivables_unpaid()
            ) : (
              <RichMessage
                message={m.receivables_progress}
                slots={{
                  principal: (
                    <Money minor={receivable.principalMinor} currency={currency} context="amount" locale={locale} />
                  ),
                  percent: <Percent value={receivable.repaidBps / 10_000} decimals={0} locale={locale} />,
                }}
              />
            )}
          </span>
        </div>
      </div>
      <BudgetBar usedBps={receivable.repaidBps} tone="ok" idealBps={null} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-[12px] text-muted-fg">
          {schedule.map((part, index) => (
            <span key={index}>
              {index === 0 ? null : ' · '}
              {part}
            </span>
          ))}
        </span>
        <Button
          size="sm"
          onClick={() => {
            onReceive(receivable);
          }}
        >
          <HandCoins aria-hidden="true" className="size-3.5" />
          {m.receivables_receive()}
        </Button>
        <Button size="sm" variant="secondary" onClick={copy}>
          <Copy aria-hidden="true" className="size-3.5" />
          {m.receivables_copy()}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={m.receivables_more({ name: counterparty })}
            className="flex h-8 w-8 items-center justify-center rounded-[7px] border border-border text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Ellipsis aria-hidden="true" className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem
                icon={CircleX}
                variant="destructive"
                onSelect={() => {
                  onWriteOff(receivable);
                }}
              >
                {m.receivables_write_off()}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}

function HistoryRow({
  receivable,
  accounts,
  timeZone,
  locale,
}: {
  readonly receivable: ReceivableView;
  readonly accounts: readonly AccountView[];
  readonly timeZone: string;
  readonly locale: Locale;
}) {
  const settled = receivable.status === 'settled';
  const Icon = settled ? CircleCheck : CircleX;
  const lastPayment = receivable.payments.at(-1);
  const into = accounts.find((account) => account.id === lastPayment?.accountId)?.displayName;
  const closedOn = settled
    ? (lastPayment?.receivedOn as LocalDate)
    : toLocalDate(receivable.writtenOffAt as Date, timeZone);
  const date = formatDate(closedOn, locale, 'day');
  return (
    <li className="flex flex-wrap items-center gap-2.5 text-[12.5px]">
      <Icon aria-hidden="true" className={`size-3.5 shrink-0 ${settled ? 'text-green-fg' : 'text-subtle'}`} />
      <span className="font-medium text-fg">{receivable.counterparty}</span>
      <span className="min-w-0 flex-1 text-muted-fg">
        {receivable.description ?? m.receivables_source_loan()}
        {' · '}
        <Money minor={receivable.principalMinor} currency={receivable.currency} context="amount" locale={locale} />
      </span>
      <span className="text-[12px] text-subtle">
        {!settled
          ? m.receivables_written_off({ date })
          : into === undefined
            ? m.receivables_settled_plain({ date })
            : m.receivables_settled({ date, account: into })}
      </span>
    </li>
  );
}
