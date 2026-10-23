// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The period switcher (design `ogfhy`): the segmented Bulan/Kuartal/Tahunan/Kustom control with its options — the
 * saved months (openable when the page holds their period id), the quarters that already ended, the last two years,
 * and the custom range with "Terapkan" and its invalid-range message.
 */
import { useState } from 'react';
import type { ReportKind } from '@wf/domain/report';
import type { ReportSummary, ReportView } from '@wf/db/reports';
import type { LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Button, TextInput } from '../form.tsx';
import { RichMessage } from '../rich-message.tsx';
import {
  isCustomRangeValid,
  monthlyOptions,
  neutralLabel,
  quarterOptions,
  yearOptions,
  type ReportSelection,
} from './reports-model.ts';

const KINDS: readonly ReportKind[] = ['monthly', 'quarterly', 'yearly', 'custom'];

const CHIP =
  'h-7 rounded-[6px] px-2.5 font-mono text-[11.5px] text-muted-fg hover:text-fg aria-pressed:bg-muted aria-pressed:text-fg focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-muted-fg';

export interface ReportsPickerProps {
  readonly reports: readonly ReportSummary[];
  readonly latestFinal: ReportView | null;
  readonly today: LocalDate;
  readonly locale: Locale;
  readonly selection: ReportSelection | null;
  readonly onSelect: (selection: ReportSelection) => void;
}

export function ReportsPicker({ reports, latestFinal, today, locale, selection, onSelect }: ReportsPickerProps) {
  const [kind, setKind] = useState<ReportKind>(selection?.kind ?? 'monthly');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const months = monthlyOptions(reports, latestFinal);
  const customComplete = from !== '' && to !== '';
  const customValid = customComplete && isCustomRangeValid(from as LocalDate, to as LocalDate);
  return (
    <div className="flex flex-col gap-3">
      <div
        role="group"
        aria-label={m.reports_title()}
        className="flex w-fit items-center gap-0.5 rounded-[8px] border border-border p-0.5"
      >
        {KINDS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={kind === option}
            onClick={() => {
              setKind(option);
            }}
            className="h-7 rounded-[6px] px-2.5 text-[12.5px] text-muted-fg hover:text-fg aria-pressed:bg-muted aria-pressed:text-fg focus-visible:outline-2 focus-visible:outline-ring"
          >
            {option === 'monthly'
              ? m.reports_kind_monthly()
              : option === 'quarterly'
                ? m.reports_kind_quarterly()
                : option === 'yearly'
                  ? m.reports_kind_yearly()
                  : m.reports_kind_custom()}
          </button>
        ))}
      </div>
      {kind === 'monthly' ? (
        <div className="flex flex-col gap-2">
          <div role="group" aria-label={m.reports_kind_monthly()} className="flex flex-wrap items-center gap-1">
            {months.map((month) => {
              const { periodId } = month;
              return periodId === null ? (
                <span
                  key={month.id}
                  className="inline-flex h-7 items-center rounded-[6px] px-2.5 font-mono text-[11.5px] text-subtle"
                >
                  {neutralLabel(month.label, locale, today)}
                </span>
              ) : (
                <button
                  key={month.id}
                  type="button"
                  aria-pressed={selection?.kind === 'monthly' && selection.id === month.id}
                  onClick={() => {
                    onSelect({ kind: 'monthly', id: month.id, periodId });
                  }}
                  className={CHIP}
                >
                  {neutralLabel(month.label, locale, today)}
                </button>
              );
            })}
          </div>
          {latestFinal === null ? null : (
            <p className="text-[12px] text-subtle">
              <RichMessage
                message={m.reports_final_until}
                slots={{ label: neutralLabel(latestFinal.label, locale, today) }}
              />
            </p>
          )}
        </div>
      ) : kind === 'quarterly' ? (
        <div role="group" aria-label={m.reports_kind_quarterly()} className="flex flex-wrap items-center gap-1">
          {quarterOptions(today).map((option) => (
            <button
              key={`${option.year}-Q${option.quarter}`}
              type="button"
              aria-pressed={
                selection?.kind === 'quarterly' &&
                selection.year === option.year &&
                selection.quarter === option.quarter
              }
              onClick={() => {
                onSelect({ kind: 'quarterly', ...option });
              }}
              className={CHIP}
            >
              {`Q${option.quarter} ${option.year}`}
            </button>
          ))}
        </div>
      ) : kind === 'yearly' ? (
        <div role="group" aria-label={m.reports_kind_yearly()} className="flex flex-wrap items-center gap-1">
          {yearOptions(today).map((year) => (
            <button
              key={year}
              type="button"
              aria-pressed={selection?.kind === 'yearly' && selection.year === year}
              onClick={() => {
                onSelect({ kind: 'yearly', year });
              }}
              className={CHIP}
            >
              {year}
            </button>
          ))}
        </div>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            // "Terapkan" is disabled (and implicit submission blocked) unless the range is valid.
            event.preventDefault();
            onSelect({ kind: 'custom', from: from as LocalDate, to: to as LocalDate });
          }}
        >
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted-fg">
            {m.reports_custom_from()}
            <TextInput
              size="sm"
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
              }}
            />
          </label>
          <span className="text-[12.5px] text-subtle">{m.reports_custom_to()}</span>
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted-fg">
            <span className="sr-only">{m.reports_custom_to()}</span>
            <TextInput
              size="sm"
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
              }}
            />
          </label>
          <Button size="sm" type="submit" disabled={!customValid}>
            {m.reports_custom_apply()}
          </Button>
          {customComplete && !customValid ? (
            <p role="alert" className="text-[12px] text-red-fg">
              {m.reports_custom_invalid()}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}
