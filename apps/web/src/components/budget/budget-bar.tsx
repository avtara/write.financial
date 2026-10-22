// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A budget progress bar (design "garis putih = posisi ideal hari ini"): the used share in the line's tone and a white
 * marker at the ideal share for today. Nothing used draws nothing (no track, no marker; the row's note says "belum
 * terpakai"), while the empty SVG keeps the row's height. Over the limit the whole bar turns red and the marker moves
 * to where 100% sits; at or under the limit there is no 100% marker. Drawn as SVG with attributes only: the production
 * CSP allows no `style` attributes, so no CSS widths.
 */
import { barLength, type BudgetTone } from './budget-model.ts';

const FILL: Readonly<Record<BudgetTone, string>> = {
  over: 'fill-red',
  warning: 'fill-amber',
  ok: 'fill-green',
  idle: 'fill-surface-4',
};

export interface BudgetBarProps {
  readonly usedBps: number | null;
  readonly tone: BudgetTone;
  /** Today's ideal share; `null` hides the marker (fixed budgets, closed periods). */
  readonly idealBps: number | null;
  /** `sm` 6 px (rows), `lg` 10 px (hero). */
  readonly size?: 'sm' | 'lg';
  /** A blue/violet group bar instead of the tone. */
  readonly fillClassName?: string;
  readonly className?: string;
}

export function BudgetBar({ usedBps, tone, idealBps, size = 'sm', fillClassName, className = '' }: BudgetBarProps) {
  const used = barLength(usedBps);
  const over = usedBps !== null && usedBps > 10_000;
  // Over the limit: the marker shows where the limit ends (2.000.000 of 2.400.000 → 83%).
  const marker =
    used === 0
      ? null
      : over
        ? barLength(Math.round(10_000 ** 2 / usedBps))
        : idealBps === null
          ? null
          : barLength(idealBps);
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1000 10"
      preserveAspectRatio="none"
      className={`block w-full overflow-visible ${size === 'sm' ? 'h-1.5' : 'h-2.5'} ${className}`}
    >
      {used === 0 ? null : (
        <>
          <rect width="1000" height="10" rx="5" className="fill-surface-3" />
          <rect
            width={used}
            height="10"
            rx="5"
            className={fillClassName ?? `${FILL[tone]} ${over ? 'opacity-90' : ''}`}
          />
        </>
      )}
      {marker === null ? null : <rect x={Math.max(marker - 2, 0)} y="-2" width="4" height="14" className="fill-fg" />}
    </svg>
  );
}
