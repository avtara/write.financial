// SPDX-License-Identifier: AGPL-3.0-only
/** The due-date presets of a receivable (FR-U7, FR-L5): 1 minggu · 2 minggu · Akhir bulan · 31 Okt · Tanpa tenggat. */
import type { LocalDate } from '@wf/domain/period';
import { DUE_PRESETS, dueDateFor, type DuePreset } from '@wf/domain/receivables';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';

export interface DuePresetChipsProps {
  readonly value: DuePreset;
  readonly onChange: (preset: DuePreset) => void;
  /** The day the presets count from. */
  readonly from: LocalDate;
  readonly locale: Locale;
  readonly label: string;
}

export function DuePresetChips({ value, onChange, from, locale, label }: DuePresetChipsProps) {
  const text: Readonly<Record<DuePreset, string>> = {
    one_week: m.receivables_due_one_week(),
    two_weeks: m.receivables_due_two_weeks(),
    end_of_month: m.receivables_due_end_of_month({
      date: formatDate(dueDateFor('end_of_month', from) as LocalDate, locale, 'day'),
    }),
    none: m.receivables_due_none(),
  };
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {DUE_PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          aria-pressed={preset === value}
          onClick={() => {
            onChange(preset);
          }}
          className="rounded-[6px] border border-border px-[9px] py-1 text-[11.5px] font-medium text-muted-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-blue-tint-4 aria-pressed:bg-blue-tint-2 aria-pressed:text-blue-fg"
        >
          {text[preset]}
        </button>
      ))}
    </div>
  );
}
