// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Perlu perhatian" (FR-B2/B3/B5, design `E86u2e`, dismissed `NpMMC`): lines over their limit (with the suggested
 * sources to cover them, FR-B3) or at their warning threshold, each with its action and "Abaikan" (hidden until the
 * period ends, FR-B5), and the dismissed ones behind "Tampilkan".
 */
import type { BudgetLineView, BudgetStatus } from '@wf/db/budgets';
import { suggestLeftoverSources } from '@wf/domain/budget';
import { m } from '@wf/i18n/messages';
import { CircleAlert, CircleCheck, EyeOff, TrendingUp } from 'lucide-react';
import { Fragment } from 'react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { Button } from '../form.tsx';
import { RichMessage } from '../rich-message.tsx';
import { Amount, Pct } from './budget-format.tsx';

export interface BudgetAttentionProps {
  readonly status: BudgetStatus;
  /** "Pindahkan RpX": opens the move dialog for `line` with `sources` prefilled. */
  readonly onCover: (line: BudgetLineView, sources: { categoryId: string; amountMinor: bigint }[]) => void;
  /** "Naikkan batas": the inline limit editor of `line`. */
  readonly onRaise: (line: BudgetLineView) => void;
  readonly onDismiss: (line: BudgetLineView) => void;
  readonly onRestore: (lines: readonly BudgetLineView[]) => void;
}

export function BudgetAttention({ status, onCover, onRaise, onDismiss, onRestore }: BudgetAttentionProps) {
  const byId = new Map(status.lines.map((line) => [line.categoryId, line]));
  const dismissed = status.lines.filter((line) => line.dismissed);
  const day = status.totals.day;
  // Over the limit first, then the warnings, each in budget order.
  const items = status.attention
    .toSorted((a, b) => Number(b.reason === 'over') - Number(a.reason === 'over'))
    .map(({ categoryId, reason }) => {
      const line = byId.get(categoryId) as BudgetLineView;
      const sources = reason === 'over' ? suggestLeftoverSources(status.lines, categoryId, -line.remainingMinor) : [];
      return { line, reason, sources, movableMinor: sources.reduce((total, source) => total + source.amountMinor, 0n) };
    });
  return (
    <section aria-labelledby="budget-attention-title" className="rounded-[14px] border border-border bg-card">
      <h2
        id="budget-attention-title"
        className="flex items-center gap-2 border-b border-border px-5 py-4 text-[15px] font-semibold text-fg"
      >
        {m.budget_attention_title()}
        {status.attention.length > 0 ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-tint-2 px-1.5 font-mono text-[11px] text-red-fg">
            {status.attention.length}
          </span>
        ) : null}
      </h2>
      {status.attention.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-4 text-[13px] text-muted-fg">
          <CircleCheck aria-hidden="true" className="size-4 text-green-fg" />
          {m.budget_attention_none()}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map(({ line, reason, sources, movableMinor }) => {
            const name = categoryName(line);
            return (
              <li key={line.categoryId} className="flex gap-3 px-5 py-4">
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-[7px] ${reason === 'over' ? 'bg-red-tint-2 text-red-fg' : 'bg-amber-tint-2 text-amber-fg'}`}
                >
                  {reason === 'over' ? (
                    <CircleAlert aria-hidden="true" className="size-3.5" />
                  ) : (
                    <TrendingUp aria-hidden="true" className="size-3.5" />
                  )}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-col gap-0.5">
                    <h3 className="text-[13.5px] font-medium text-fg">
                      {reason === 'over' ? (
                        <RichMessage
                          message={m.budget_attention_over_title}
                          slots={{ name, amount: <Amount valueMinor={-line.remainingMinor} /> }}
                        />
                      ) : (
                        <RichMessage
                          message={m.budget_attention_warning_title}
                          slots={{ name, used: <Pct bps={line.usedBps} />, day: String(day) }}
                        />
                      )}
                    </h3>
                    <p className="text-[12.5px] text-muted-fg">
                      {reason === 'over' ? (
                        sources.length === 0 ? (
                          m.budget_attention_over_no_source()
                        ) : (
                          <RichMessage
                            message={m.budget_attention_over_body}
                            slots={{
                              sources: sources.map((source, index) => {
                                const from = byId.get(source.categoryId) as BudgetLineView;
                                return (
                                  <Fragment key={source.categoryId}>
                                    {index === 0 ? null : index === sources.length - 1 ? m.budget_and() : ', '}
                                    {categoryName(from)} (<Amount valueMinor={source.amountMinor} />)
                                  </Fragment>
                                );
                              }),
                            }}
                          />
                        )
                      ) : line.safeDailyMinor === null ? (
                        <RichMessage
                          message={m.budget_attention_warning_fixed}
                          slots={{ amount: <Amount valueMinor={line.remainingMinor} /> }}
                        />
                      ) : (
                        <RichMessage
                          message={m.budget_attention_warning_body}
                          slots={{
                            projection: <Amount valueMinor={line.projectionMinor} />,
                            daily: <Amount valueMinor={line.safeDailyMinor} />,
                          }}
                        />
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {reason === 'over' ? (
                      movableMinor > 0n ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            onCover(line, sources);
                          }}
                        >
                          <RichMessage
                            message={m.budget_attention_move}
                            slots={{ amount: <Amount valueMinor={movableMinor} /> }}
                          />
                        </Button>
                      ) : null
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          onRaise(line);
                        }}
                      >
                        {m.budget_attention_raise()}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={m.budget_attention_dismiss_label({ name })}
                      onClick={() => {
                        onDismiss(line);
                      }}
                    >
                      {m.budget_attention_dismiss()}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {dismissed.length === 0 ? null : (
        <p className="flex items-center gap-2 border-t border-border px-5 py-3 text-[12px] text-subtle">
          <EyeOff aria-hidden="true" className="size-3.5" />
          <span className="flex-1">
            {m.budget_attention_dismissed({
              count: dismissed.length,
              names: dismissed.map((line) => categoryName(line)).join(', '),
            })}
          </span>
          <button
            type="button"
            onClick={() => {
              onRestore(dismissed);
            }}
            className="rounded-[5px] px-1 font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {m.budget_attention_show()}
          </button>
        </p>
      )}
    </section>
  );
}
