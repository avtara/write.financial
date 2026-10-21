// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Debts page KPI strip (FR-U1, design `qDXjl`/`bQZ9M`/`iSIXj`): "Sisa utang", "Harus dibayar", "Jatuh tempo
 * terdekat", and "Piutang" (read-only total of open receivables).
 */
import { countDays, type LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { CalendarClock, HandCoins, Landmark, Timer, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DebtKpis as Kpis } from '../../lib/debts.ts';

export interface DebtKpisProps {
  readonly kpis: Kpis;
  readonly receivablesMinor: bigint;
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

export function DebtKpis({ kpis, receivablesMinor, baseCurrency, today, locale }: DebtKpisProps) {
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
      <Kpi
        icon={Timer}
        label={m.debts_kpi_nearest()}
        note={
          nearest === null
            ? m.debts_kpi_nearest_none()
            : days === 0
              ? m.debts_kpi_nearest_today({ name: nearest.name })
              : m.debts_kpi_nearest_days({ name: nearest.name, days })
        }
      >
        <span className="font-mono text-[22px] leading-tight font-medium text-fg">
          {nearest === null ? '—' : formatDate(nearest.date, locale, 'day')}
        </span>
      </Kpi>
      <Kpi
        icon={HandCoins}
        label={m.debts_kpi_receivables()}
        note={receivablesMinor === 0n ? m.debts_kpi_receivables_none() : m.debts_kpi_receivables_open()}
      >
        {
          <Money
            minor={receivablesMinor}
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
  readonly note: string;
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
