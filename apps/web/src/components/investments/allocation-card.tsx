// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Alokasi aset" (FR-I3, design 09 `bgmSP`): the share of each asset class as a donut and a list with its distance
 * from the target in points ("Saham AS 50,8% +0,8"), the drift (½ Σ |share − target|), the class furthest from its
 * target ("Kripto 2,0 poin di atas target · Lihat saran rebalancing di bawah"), and "Atur target".
 */
import type { PortfolioView } from '@wf/db/investments';
import { ratioBps } from '@wf/domain/budget';
import type { AssetClass } from '@wf/domain/investments';
import { classItems } from '@wf/domain/valuation';
import { formatNumber } from '@wf/i18n/format';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Percent } from '@wf/ui/percent';
import { Scale, SlidersHorizontal } from 'lucide-react';
import { Button } from '../form.tsx';
import { CLASS_TONE, classLabel } from './investments-model.ts';

/** "+0,8" / "−1,0": a deviation in percentage points. */
export function points(bps: number, locale: Locale, signed = true): string {
  return formatNumber(bps / 100, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1, signed });
}

export interface AllocationRowView {
  readonly key: AssetClass;
  readonly shareBps: number;
  readonly targetBps: number | null;
  readonly deviationBps: number | null;
}

/** The class rows: the allocation against the targets, or plain shares without targets. */
export function allocationRows(portfolio: PortfolioView): AllocationRowView[] {
  if (portfolio.allocation !== null) {
    return portfolio.allocation.rows.map((row) => ({
      key: row.key as AssetClass,
      shareBps: row.shareBps,
      targetBps: row.targetBps,
      deviationBps: row.deviationBps,
    }));
  }
  const total = portfolio.summary.valueBaseMinor;
  return classItems(portfolio.summary.positions).map((item) => ({
    key: item.key as AssetClass,
    shareBps: ratioBps(item.valueMinor, total) ?? 0,
    targetBps: null,
    deviationBps: null,
  }));
}

export interface AllocationCardProps {
  readonly portfolio: PortfolioView;
  readonly locale: Locale;
  readonly onEditTargets: () => void;
}

const RADIUS = 15.915;

export function AllocationCard({ portfolio, locale, onEditTargets }: AllocationCardProps) {
  const rows = allocationRows(portfolio);
  const { allocation } = portfolio;
  const largest = allocation?.largest ?? null;
  let offset = 0;
  return (
    <section
      aria-labelledby="invest-allocation"
      className="flex min-w-0 flex-col gap-4 rounded-[12px] border border-border bg-card px-6 py-5"
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id="invest-allocation" className="text-[15px] font-semibold text-fg">
            {m.invest_allocation_title()}
          </h2>
          <p className="text-[12.5px] text-muted-fg">
            {m.invest_allocation_subtitle()}
            {allocation === null ? null : (
              <>
                {' · '}
                {m.invest_allocation_drift()}{' '}
                <Percent value={allocation.driftBps / 10_000} locale={locale} className="text-fg" />
              </>
            )}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onEditTargets}>
          <SlidersHorizontal aria-hidden="true" className="size-3.5" />
          {m.invest_allocation_edit()}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-muted-fg">{m.invest_allocation_empty()}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-5">
          <div className="relative size-[132px] shrink-0">
            <svg aria-hidden="true" viewBox="0 0 42 42" className="size-full -rotate-90">
              <circle cx="21" cy="21" r={RADIUS} fill="none" strokeWidth="6" className="stroke-tint-06" />
              {rows.map((row) => {
                const length = row.shareBps / 100;
                const start = offset;
                offset += length;
                return (
                  <circle
                    key={row.key}
                    cx="21"
                    cy="21"
                    r={RADIUS}
                    fill="none"
                    strokeWidth="6"
                    strokeDasharray={`${String(Math.max(length - 0.6, 0))} ${String(100 - Math.max(length - 0.6, 0))}`}
                    strokeDashoffset={-start}
                    className={CLASS_TONE[row.key].stroke}
                  />
                );
              })}
            </svg>
            <span className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono text-[20px] font-medium text-fg">{rows.length}</span>
              <span className="text-[10.5px] text-subtle">{m.invest_allocation_classes()}</span>
            </span>
          </div>
          <ul className="grid min-w-[220px] flex-1 grid-cols-1 gap-x-5 gap-y-1.5 sm:grid-cols-2">
            {rows.map((row) => (
              <li key={row.key} className="flex items-center gap-2 text-[12.5px]">
                <span aria-hidden="true" className={`size-2 shrink-0 rounded-[2px] ${CLASS_TONE[row.key].dot}`} />
                <span className="min-w-0 flex-1 truncate text-muted-fg">{classLabel(row.key)}</span>
                <Percent value={row.shareBps / 10_000} locale={locale} className="text-fg" />
                {row.deviationBps === null ? null : (
                  <span
                    className={`w-9 text-right font-mono text-[11px] ${Math.abs(row.deviationBps) >= 150 ? 'text-amber-fg' : 'text-subtle'}`}
                  >
                    {points(row.deviationBps, locale)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {largest === null ? null : (
        <p className="flex items-center gap-2.5 rounded-[10px] border border-border bg-surface-2 px-3 py-2.5">
          <Scale aria-hidden="true" className="size-4 shrink-0 text-amber-fg" />
          <span className="flex min-w-0 flex-col">
            <span className="text-[12.5px] font-medium text-fg">
              {largest.deviationBps > 0
                ? m.invest_allocation_above({
                    name: classLabel(largest.key as AssetClass),
                    points: points(Math.abs(largest.deviationBps), locale, false),
                  })
                : m.invest_allocation_below({
                    name: classLabel(largest.key as AssetClass),
                    points: points(Math.abs(largest.deviationBps), locale, false),
                  })}
            </span>
            <span className="text-[11.5px] text-subtle">{m.invest_allocation_hint()}</span>
          </span>
        </p>
      )}
    </section>
  );
}
