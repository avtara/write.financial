// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Pindahkan sisa" (FR-B3, design `FgYBA`): moves leftover of other categories into one, the total budget unchanged.
 * "Tutup kekurangan …" opens with the target fixed and the suggested sources (largest remainder first) ticked;
 * "Pindahkan sisa ke…" from a row opens with that row as the only source and a target to pick. HASIL shows the
 * target's limit and % used after the move.
 */
import type { BudgetLineView } from '@wf/db/budgets';
import { ratioBps } from '@wf/domain/budget';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { Checkbox } from '@wf/ui/checkbox';
import { ArrowLeftRight, ArrowRight, Info } from 'lucide-react';
import { useState } from 'react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { CategoryIcon } from '../category-icon.tsx';
import { Button, Field, Select } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { RichMessage } from '../rich-message.tsx';
import { BudgetBar } from './budget-bar.tsx';
import { Amount, Pct, useBudgetFormat } from './budget-format.tsx';

export interface MoveRequest {
  /** `null`: the user picks it ("Pindahkan sisa ke…"). */
  readonly targetId: string | null;
  readonly sources: readonly { readonly categoryId: string; readonly amountMinor: bigint }[];
}

export interface MoveLeftoverDialogProps {
  readonly request: MoveRequest | null;
  readonly lines: readonly BudgetLineView[];
  readonly totalLimitMinor: bigint;
  readonly onClose: () => void;
  /** Resolves `true` once moved (the dialog then closes). */
  readonly onMove: (target: BudgetLineView, sources: { categoryId: string; amountMinor: bigint }[]) => Promise<boolean>;
}

function MoveForm({
  request,
  lines,
  totalLimitMinor,
  onClose,
  onMove,
}: MoveLeftoverDialogProps & { request: MoveRequest }) {
  const { currency, locale } = useBudgetFormat();
  const [targetId, setTargetId] = useState(request.targetId);
  const [amounts, setAmounts] = useState<Record<string, bigint | null>>(() =>
    Object.fromEntries(request.sources.map((source) => [source.categoryId, source.amountMinor])),
  );
  const [pending, setPending] = useState(false);
  const target = lines.find((line) => line.categoryId === targetId);
  const candidates = lines.filter((line) => line.categoryId !== targetId && !line.isFixed && line.remainingMinor > 0n);
  const chosen = candidates.flatMap((line) => {
    const amount = amounts[line.categoryId];
    return amount === undefined || amount === null || amount <= 0n ? [] : [{ line, amountMinor: amount }];
  });
  const sourceViews = candidates.map((line) => {
    const amount = amounts[line.categoryId] ?? null;
    return { line, amount, afterMinor: line.remainingMinor - (amount ?? 0n) };
  });
  const totalMinor = chosen.reduce((total, source) => total + source.amountMinor, 0n);
  const invalid = chosen.some((source) => source.amountMinor > source.line.remainingMinor);
  const afterLimitMinor = target === undefined ? 0n : target.limitMinor + totalMinor;
  const afterBps = target === undefined ? null : ratioBps(target.spentMinor, afterLimitMinor);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (target === undefined || totalMinor === 0n || invalid) return;
        setPending(true);
        void onMove(
          target,
          chosen.map((source) => ({ categoryId: source.line.categoryId, amountMinor: source.amountMinor })),
        ).then((moved) => {
          if (!moved) setPending(false);
        });
      }}
    >
      {request.targetId === null ? (
        <Field label={m.budget_move_target()}>
          {(props) => (
            <Select
              {...props}
              size="sm"
              value={targetId ?? ''}
              onChange={(event) => {
                setTargetId(event.target.value === '' ? null : event.target.value);
              }}
            >
              <option value="">{m.budget_move_target_placeholder()}</option>
              {lines
                .filter((line) => !request.sources.some((source) => source.categoryId === line.categoryId))
                .map((line) => (
                  <option key={line.categoryId} value={line.categoryId}>
                    {categoryName(line)}
                  </option>
                ))}
            </Select>
          )}
        </Field>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 text-[11px] font-medium text-subtle uppercase">{m.budget_move_from()}</legend>
        {candidates.length === 0 ? <p className="text-[12.5px] text-muted-fg">{m.budget_move_no_source()}</p> : null}
        {sourceViews.map(({ line, amount, afterMinor }) => {
          const name = categoryName(line);
          const checked = amount !== null && amount > 0n;
          const short = afterMinor < 0n;
          return (
            <div
              key={line.categoryId}
              className={`flex items-center gap-3 rounded-[10px] border px-3 py-2.5 ${checked ? 'border-border-strong bg-surface-2' : 'border-border'}`}
            >
              <Checkbox
                label={
                  <span className="flex items-center gap-2 text-[13px] font-medium text-fg">
                    <CategoryIcon icon={line.icon} color={line.color} size="sm" />
                    {name}
                  </span>
                }
                description={
                  <span className={`font-mono ${short ? 'text-red-fg' : ''}`}>
                    <RichMessage
                      message={m.budget_move_source_after}
                      slots={{
                        before: <Amount valueMinor={line.remainingMinor} />,
                        after: <Amount valueMinor={afterMinor} />,
                      }}
                    />
                  </span>
                }
                checked={checked}
                onChange={(event) => {
                  const on = event.currentTarget.checked;
                  setAmounts((current) => ({ ...current, [line.categoryId]: on ? line.remainingMinor : null }));
                }}
                className="min-w-0 flex-1"
              />
              <div className="w-[128px]">
                <AmountInput
                  value={amount}
                  onValueChange={(value) => {
                    setAmounts((current) => ({ ...current, [line.categoryId]: value }));
                  }}
                  currency={currency}
                  locale={locale}
                  size="inline"
                  aria-label={m.budget_move_amount_label({ name })}
                  aria-invalid={short}
                />
              </div>
            </div>
          );
        })}
      </fieldset>
      {target === undefined ? null : (
        <section aria-label={m.budget_move_result()} className="flex flex-col gap-2">
          <h3 className="text-[11px] font-medium text-subtle uppercase">{m.budget_move_result()}</h3>
          <div className="flex flex-col gap-2 rounded-[10px] border border-border px-3.5 py-3">
            <div className="flex items-center justify-between text-[13px] text-fg">
              <span>{categoryName(target)}</span>
              <span className="flex items-center gap-1 font-mono text-[12px]">
                <Pct bps={target.usedBps} className="text-red-fg" />
                <ArrowRight aria-hidden="true" className="size-3 text-subtle" />
                <Pct bps={afterBps} className="font-semibold text-amber-fg" />
              </span>
            </div>
            <BudgetBar
              usedBps={afterBps}
              tone={afterBps !== null && afterBps > 10_000 ? 'over' : 'warning'}
              idealBps={null}
            />
            <p className="font-mono text-[11.5px] text-muted-fg">
              <RichMessage
                message={m.budget_move_result_limit}
                slots={{
                  from: <Amount valueMinor={target.limitMinor} />,
                  to: <Amount valueMinor={afterLimitMinor} />,
                  spent: <Amount valueMinor={target.spentMinor} />,
                }}
              />
            </p>
            {afterLimitMinor === target.spentMinor && totalMinor > 0n ? (
              <p className="flex items-center gap-1.5 text-[12px] text-muted-fg">
                <Info aria-hidden="true" className="size-3.5" />
                {m.budget_move_result_exact({ name: categoryName(target) })}
              </p>
            ) : null}
          </div>
          <p className="text-[12px] text-subtle">
            <RichMessage
              message={m.budget_move_total_unchanged}
              slots={{ amount: <Amount valueMinor={totalLimitMinor} /> }}
            />
          </p>
        </section>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <span className="font-mono text-[12px] text-muted-fg">
          <RichMessage
            message={m.budget_move_summary}
            slots={{ amount: <Amount valueMinor={totalMinor} />, count: String(chosen.length) }}
          />
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {m.settings_cancel()}
          </Button>
          <Button
            type="submit"
            size="sm"
            pending={pending}
            disabled={target === undefined || totalMinor === 0n || invalid}
          >
            <ArrowLeftRight aria-hidden="true" className="size-3.5" />
            <RichMessage message={m.budget_move_submit} slots={{ amount: <Amount valueMinor={totalMinor} /> }} />
          </Button>
        </div>
      </div>
    </form>
  );
}

export function MoveLeftoverDialog(props: MoveLeftoverDialogProps) {
  const { request, lines } = props;
  const target = lines.find((line) => line.categoryId === request?.targetId);
  return (
    <Modal
      open={request !== null}
      // Without a trigger the dialog only ever asks to close.
      onOpenChange={props.onClose}
      size="lg"
      title={target === undefined ? m.budget_move_title_any() : m.budget_move_title({ name: categoryName(target) })}
      description={m.budget_move_description()}
    >
      {request === null ? null : <MoveForm {...props} request={request} />}
    </Modal>
  );
}
