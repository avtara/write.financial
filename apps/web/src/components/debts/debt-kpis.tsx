// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Debts page KPI strip (FR-U1, design `qDXjl`/`bQZ9M`/`iSIXj`): "Sisa utang", "Harus dibayar", "Jatuh tempo
 * terdekat" (the nearest receivable due date when no debt is due, design KZZZy), and "Piutang" (Σ open receivables,
 * how many people, and how many are due soonest).
 */
import type { ReceivablesOverview } from '@wf/db/receivables';
import { countDays, type LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { CalendarClock, HandCoins, Landmark, Timer, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DebtKpis as Kpis } from '../../lib/debts.ts';
import { receivableKpis } from '../../lib/receivables.ts';
import { RichMessage } from '../rich-message.tsx';

export interface DebtKpisProps {
  readonly kpis: Kpis;
  readonly receivables: Pick<ReceivablesOverview, 'active' | 'outstandingMinor'>;
  readonly baseCurrency: string;
  readonly today: LocalDate;
  readonly locale: Locale;
}

/** "1 cicilan · 1 tagihan berjalan" / "1 tagihan kartu kredit" / "tidak ada utang aktif". */
function remainingNote(kpis: Kpis): string {
  if (kpis.installmentCount === 0) {
    return kpis.billCount === 0 ? m.debts_kpi_remaining_none() : m.debts_kpi_card_bills({ count: kpis.billCount });
  }
  const installments = m.debts_kpi_installments({ count: kpis.installmentCount });
  return kpis.billCount === 0 ? installments : `${installments} · ${m.debts_kpi_bills({ count: kpis.billCount })}`;
}

export function DebtKpis({ kpis, receivables, baseCurrency, today, locale }: DebtKpisProps) {
  const card = kpis.dueCard;
  let dueNote = m.debts_kpi_due_none();
  if (card?.cycle != null) {
    const due = formatDate(card.cycle.dueOn, locale, 'day');
    dueNote =
      card.statementMinor > card.status.currentBillMinor
        ? m.debts_kpi_due_statement({ statement: formatDate(card.cycle.statementOn, locale, 'day'), due })
        : m.debts_kpi_due_card({ name: card.card.name, due });
  } else if (kpis.dueMinor > 0n) {
    dueNote = m.debts_kpi_due_month();
  }
  const { nearest } = kpis;
  const days = nearest === null ? 0 : countDays(today, nearest.date) - 1;
  const owed = receivableKpis(receivables, today);
  const lent = owed.nearest;
  const fallback = nearest === null ? lent : null;
  let nearestNote: ReactNode = m.debts_kpi_nearest_none();
  if (nearest !== null) {
    nearestNote =
      days === 0
        ? m.debts_kpi_nearest_today({ name: nearest.name })
        : m.debts_kpi_nearest_days({ name: nearest.name, days });
  } else if (fallback !== null) {
    nearestNote = (
      <RichMessage
        message={m.debts_kpi_nearest_receivable}
        slots={{
          name: fallback.name,
          amount: (
            <Money minor={fallback.remainingMinor} currency={fallback.currency} context="amount" locale={locale} />
          ),
        }}
      />
    );
  }
  const receivablesNote =
    owed.people === 0
      ? m.debts_kpi_receivables_none()
      : [
          m.debts_kpi_receivables_people({ count: owed.people }),
          lent === null
            ? null
            : lent.days === 0
              ? m.debts_kpi_receivables_due_today({ count: lent.count })
              : m.debts_kpi_receivables_due_days({ count: lent.count, days: lent.days }),
        ]
          .filter((part) => part !== null)
          .join(' · ');
  const nearestDate = nearest?.date ?? fallback?.date ?? null;
  return (
    <section
      aria-label={m.debts_kpis_label()}
      className="grid grid-cols-2 overflow-hidden rounded-[12px] border border-border bg-card xl:grid-cols-4"
    >
      <Kpi icon={Landmark} label={m.debts_kpi_remaining()} note={remainingNote(kpis)}>
        {
          <Money
            minor={kpis.remainingMinor}
            currency={baseCurrency}
            context="amount"
            locale={locale}
            className="text-[22px] leading-tight font-medium text-fg"
          />
        }
      </Kpi>
      <Kpi icon={CalendarClock} label={m.debts_kpi_due()} note={dueNote}>
        {
          <Money
            minor={kpis.dueMinor}
            currency={baseCurrency}
            context="amount"
            locale={locale}
            className="text-[22px] leading-tight font-medium text-fg"
          />
        }
      </Kpi>
      <Kpi icon={Timer} label={m.debts_kpi_nearest()} note={nearestNote}>
        <span className="font-mono text-[22px] leading-tight font-medium text-fg">
          {nearestDate === null ? '—' : formatDate(nearestDate, locale, 'day')}
        </span>
      </Kpi>
      <Kpi icon={HandCoins} label={m.debts_kpi_receivables()} note={receivablesNote}>
        {
          <Money
            minor={receivables.outstandingMinor}
            currency={baseCurrency}
            context="amount"
            locale={locale}
            className="text-[22px] leading-tight font-medium text-fg"
          />
        }
      </Kpi>
    </section>
  );
}

function Kpi({
  icon: Icon,
  label,
  note,
  children,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly note: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-b border-border px-5 py-4 odd:border-r xl:border-r xl:border-b-0 xl:last:border-r-0">
      <span className="flex items-center gap-1.5 text-[12.5px] text-muted-fg">
        <Icon aria-hidden="true" className="size-3.5" />
        {label}
      </span>
      {children}
      <span className="text-[12px] text-subtle">{note}</span>
    </div>
  );
}
