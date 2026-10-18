// SPDX-License-Identifier: AGPL-3.0-only
import { m } from '@wf/i18n/messages';
import { Check } from 'lucide-react';

const STEPS = [m.setup_step_admin, m.setup_step_two_factor, m.setup_step_instance, m.setup_step_done] as const;

export type SetupStepNumber = 1 | 2 | 3 | 4;

/** The wizard's progress: 1 Admin · 2 Verifikasi dua langkah · 3 Instans · 4 Selesai. */
export function SetupSteps({ current }: { current: SetupStepNumber }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-medium tracking-[0.04em] text-subtle uppercase">
        {m.setup_step_progress({ current, total: STEPS.length })}
      </p>
      <ol aria-label={m.setup_steps_label()} className="flex flex-wrap gap-x-3.5 gap-y-1.5">
        {STEPS.map((label, index) => {
          const number = index + 1;
          const done = number < current;
          const active = number === current;
          return (
            <li
              key={number}
              aria-current={active ? 'step' : undefined}
              className={`flex items-center gap-1.5 text-[12px] ${active ? 'font-medium text-fg' : 'text-subtle'}`}
            >
              <span
                aria-hidden="true"
                className={`flex size-[18px] items-center justify-center rounded-full border text-[10.5px] font-semibold ${
                  done || active ? 'border-fg bg-fg text-primary-fg' : 'border-border'
                }`}
              >
                {done ? <Check className="size-3" /> : number}
              </span>
              {label()}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
