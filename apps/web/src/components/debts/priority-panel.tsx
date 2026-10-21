// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Prioritas pembayaran kartu" (FR-U4, design `CUmaY`): the order in which a transfer into a card pays installments
 * and the current bill; an overpayment always becomes credit last. "Ubah" reorders the two with arrow buttons and saves
 * the order to `user_preferences.cc_payment_priority`.
 */
import type { CcPaymentBucket } from '@wf/domain/debt';
import { m } from '@wf/i18n/messages';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../form.tsx';

/** Label and note of each row, credit included. */
export const BUCKET_LABELS: Readonly<
  Record<CcPaymentBucket | 'credit', { readonly label: () => string; readonly note: () => string }>
> = {
  installments: { label: m.debts_bucket_installments, note: m.debts_bucket_installments_note },
  spending: { label: m.debts_bucket_spending, note: m.debts_bucket_spending_note },
  credit: { label: m.debts_bucket_credit, note: m.debts_bucket_credit_note },
};

/** `order` with the bucket at `index` moved one step by `delta`. */
export function moveBucket(order: readonly CcPaymentBucket[], index: number, delta: -1 | 1): CcPaymentBucket[] {
  const next = [...order];
  const [moved] = next.splice(index, 1);
  next.splice(index + delta, 0, moved as CcPaymentBucket);
  return next;
}

export interface PriorityPanelProps {
  readonly priority: readonly CcPaymentBucket[];
  /** Saves the order; resolves `false` when it failed (the panel stays in edit mode). */
  readonly onSave: (priority: CcPaymentBucket[]) => Promise<boolean>;
}

export function PriorityPanel({ priority, onSave }: PriorityPanelProps) {
  const [draft, setDraft] = useState<CcPaymentBucket[] | null>(null);
  const [pending, setPending] = useState(false);
  const order = draft ?? priority;
  const rows: (CcPaymentBucket | 'credit')[] = [...order, 'credit'];
  return (
    <section
      aria-labelledby="debts-priority"
      className="flex flex-col gap-3 rounded-[12px] border border-border bg-card p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="debts-priority" className="text-[14px] font-semibold text-fg">
          {m.debts_priority_title()}
        </h2>
        {draft === null ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft([...priority]);
            }}
          >
            {m.debts_priority_edit()}
          </Button>
        ) : null}
      </div>
      <ol className="flex flex-col gap-2.5">
        {rows.map((bucket, index) => (
          <li key={bucket} className="flex items-center gap-3">
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[12px] ${index === 0 ? 'bg-blue text-on-accent' : 'bg-surface-3 text-muted-fg'}`}
            >
              {index + 1}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13px] text-fg">{BUCKET_LABELS[bucket].label()}</span>
              <span className="text-[11.5px] text-subtle">{BUCKET_LABELS[bucket].note()}</span>
            </span>
            {draft === null || bucket === 'credit' ? null : (
              <span className="flex gap-1">
                <MoveButton
                  label={m.debts_priority_up({ name: BUCKET_LABELS[bucket].label() })}
                  disabled={index === 0}
                  onClick={() => {
                    setDraft(moveBucket(order, index, -1));
                  }}
                  up
                />
                <MoveButton
                  label={m.debts_priority_down({ name: BUCKET_LABELS[bucket].label() })}
                  disabled={index === order.length - 1}
                  onClick={() => {
                    setDraft(moveBucket(order, index, 1));
                  }}
                  up={false}
                />
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="text-[12px] leading-[18px] text-subtle">{m.debts_priority_note()}</p>
      {draft === null ? null : (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setDraft(null);
            }}
          >
            {m.debts_cancel()}
          </Button>
          <Button
            size="sm"
            pending={pending}
            onClick={() => {
              setPending(true);
              void onSave(draft).then((saved) => {
                setPending(false);
                if (saved) setDraft(null);
              });
            }}
          >
            {m.debts_priority_save()}
          </Button>
        </div>
      )}
    </section>
  );
}

/** An arrow button moving a priority row; also used by the Record sheet's allocation preview. */
export function MoveButton({
  label,
  disabled,
  onClick,
  up,
}: {
  readonly label: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly up: boolean;
}) {
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-[6px] border border-border text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
    >
      <Icon aria-hidden="true" className="size-3.5" />
    </button>
  );
}
