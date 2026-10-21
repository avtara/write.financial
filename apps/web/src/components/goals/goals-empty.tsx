// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Belum ada tujuan tabungan" (design 13 `a2uUH`): what goals do, "Buat tujuan pertama", and four templates to start
 * from ("Dana Darurat" at 3× the average monthly spending, "Liburan", "DP Rumah", "Gadget / laptop").
 */
import { dynamicTarget } from '@wf/domain/goals';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { EmptyState } from '@wf/ui/empty-state';
import { Money } from '@wf/ui/money';
import { ArrowRight, PiggyBank, Plus } from 'lucide-react';
import { CategoryIcon } from '../category-icon.tsx';
import { Button } from '../form.tsx';
import { RichMessage } from '../rich-message.tsx';
import type { GoalTemplate } from './goal-form.tsx';

/** In the current language, so built when rendered. */
export function goalTemplates(): (GoalTemplate & { readonly hint: () => string })[] {
  return [
    {
      name: m.goals_template_emergency(),
      icon: 'shield',
      color: 'blue',
      dynamic: true,
      hint: m.goals_template_emergency_hint_plain,
    },
    {
      name: m.goals_template_vacation(),
      icon: 'plane',
      color: 'violet',
      dynamic: false,
      hint: m.goals_template_vacation_hint,
    },
    {
      name: m.goals_template_house(),
      icon: 'house',
      color: 'green',
      dynamic: false,
      hint: m.goals_template_house_hint,
    },
    {
      name: m.goals_template_gadget(),
      icon: 'laptop',
      color: 'amber',
      dynamic: false,
      hint: m.goals_template_gadget_hint,
    },
  ];
}

export function GoalsEmpty({
  averageSpendingMinor,
  currency,
  locale,
  onCreate,
}: {
  readonly averageSpendingMinor: bigint;
  readonly currency: string;
  readonly locale: Locale;
  readonly onCreate: (template?: GoalTemplate) => void;
}) {
  return (
    <section className="flex flex-col gap-6 rounded-[12px] border border-border bg-card px-10 pb-10">
      <EmptyState
        icon={PiggyBank}
        title={m.goals_empty_title()}
        description={m.goals_empty_description()}
        actions={
          <Button
            size="sm"
            onClick={() => {
              onCreate();
            }}
          >
            <Plus aria-hidden="true" className="size-3.5" />
            {m.goals_empty_create()}
          </Button>
        }
      />
      <div className="flex flex-col gap-3">
        <h2 className="text-[11.5px] font-medium tracking-wide text-muted-fg uppercase">{m.goals_empty_templates()}</h2>
        <ul className="grid grid-cols-4 gap-3 max-xl:grid-cols-2">
          {goalTemplates().map((template) => (
            <li key={template.icon} className="flex flex-col gap-2 rounded-[12px] border border-border p-4">
              <CategoryIcon icon={template.icon} color={template.color} size="lg" />
              <span className="text-[14px] font-medium text-fg">{template.name}</span>
              <span className="text-[12.5px] text-muted-fg">
                {template.dynamic && averageSpendingMinor > 0n ? (
                  <RichMessage
                    message={m.goals_template_emergency_hint}
                    slots={{
                      amount: (
                        <Money
                          minor={dynamicTarget(averageSpendingMinor)}
                          currency={currency}
                          context="amount"
                          locale={locale}
                        />
                      ),
                    }}
                  />
                ) : (
                  template.hint()
                )}
              </span>
              <button
                type="button"
                aria-label={m.goals_template_use_label({ name: template.name })}
                onClick={() => {
                  onCreate(template);
                }}
                className="mt-auto inline-flex w-fit items-center gap-1 text-[12.5px] text-blue-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {m.goals_template_use()}
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
