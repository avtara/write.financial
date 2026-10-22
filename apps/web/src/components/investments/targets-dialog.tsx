// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Target alokasi" (FR-I3, design 09 `w1jn3J`): the ideal share per asset class next to today's share and the
 * difference; the total must be exactly 100% ("Total 101% · Total target lebih 1% · Ambil 1% dari Saham AS"), and
 * "Simpan target" stays off until it is.
 */
import type { PortfolioView } from '@wf/db/investments';
import { ASSET_CLASSES, type AssetClass } from '@wf/domain/investments';
import { checkTargets } from '@wf/domain/valuation';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Percent } from '@wf/ui/percent';
import { useState, type SyntheticEvent } from 'react';
import { Button, FormError } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { allocationRows, points } from './allocation-card.tsx';
import { CLASS_TONE, classLabel } from './investments-model.ts';

export interface TargetsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly portfolio: PortfolioView;
  readonly locale: Locale;
  /** Saves; answers an error message, or `null` once saved. */
  readonly onSubmit: (targets: Partial<Record<AssetClass, number>>) => Promise<string | null>;
}

export function TargetsDialog({ open, onOpenChange, portfolio, locale, onSubmit }: TargetsDialogProps) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={m.invest_targets_title()}
      description={m.invest_targets_description()}
      size="xl"
    >
      <TargetsForm portfolio={portfolio} locale={locale} onSubmit={onSubmit} onCancel={() => onOpenChange(false)} />
    </Modal>
  );
}

/** Percent text ("12", "12,5") → bps; `null` when not a percentage 0–100 with ≤ 2 decimals. */
export function percentToBps(text: string): number | null {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (match === null) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bps > 10_000 ? null : bps;
}

const bpsToText = (bps: number, locale: Locale) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(bps / 100);

function TargetsForm({
  portfolio,
  locale,
  onSubmit,
  onCancel,
}: Omit<TargetsDialogProps, 'open' | 'onOpenChange'> & { readonly onCancel: () => void }) {
  const shares = new Map(allocationRows(portfolio).map((row) => [row.key, row.shareBps]));
  const initial = Object.fromEntries(
    ASSET_CLASSES.map((assetClass) => [assetClass, bpsToText(portfolio.targets[assetClass] ?? 0, locale)]),
  ) as Record<AssetClass, string>;
  const [texts, setTexts] = useState(initial);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const parsed = ASSET_CLASSES.map((assetClass) => [assetClass, percentToBps(texts[assetClass])] as const);
  const invalid = parsed.some(([, bps]) => bps === null);
  const targets = Object.fromEntries(parsed.filter(([, bps]) => bps !== null && bps > 0)) as Partial<
    Record<AssetClass, number>
  >;
  const check = checkTargets(Object.fromEntries(parsed.map(([key, bps]) => [key, bps ?? 0])));
  const changed = ASSET_CLASSES.filter((assetClass) => texts[assetClass] !== initial[assetClass]).length;

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (invalid || !check.valid) return;
    setPending(true);
    const failed = await onSubmit(targets);
    setPending(false);
    setFailure(failed);
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[11.5px] text-subtle">
            <th scope="col" className="pb-2 font-normal">
              {m.invest_targets_class()}
            </th>
            <th scope="col" className="pb-2 text-right font-normal">
              {m.invest_targets_now()}
            </th>
            <th scope="col" className="pb-2 text-right font-normal">
              {m.invest_targets_difference()}
            </th>
            <th scope="col" className="pb-2 text-right font-normal">
              {m.invest_targets_target()}
            </th>
          </tr>
        </thead>
        <tbody>
          {ASSET_CLASSES.map((assetClass) => {
            const share = shares.get(assetClass) ?? 0;
            const target = percentToBps(texts[assetClass]);
            return (
              <tr key={assetClass} className="border-t border-border">
                <th scope="row" className="py-2 text-left font-normal">
                  <span className="flex items-center gap-2 text-fg">
                    <span aria-hidden="true" className={`size-2 rounded-[2px] ${CLASS_TONE[assetClass].dot}`} />
                    {classLabel(assetClass)}
                  </span>
                </th>
                <td className="py-2 text-right">
                  <Percent value={share / 10_000} locale={locale} className="text-muted-fg" />
                </td>
                <td className="py-2 text-right font-mono text-[11.5px] text-subtle">
                  {target === null ? '—' : points(share - target, locale)}
                </td>
                <td className="py-2">
                  <span className="ml-auto flex w-[92px] items-center gap-1 rounded-[8px] border border-border-input bg-input px-2 focus-within:outline-2 focus-within:outline-ring">
                    <input
                      aria-label={m.invest_targets_input({ name: classLabel(assetClass) })}
                      aria-invalid={target === null}
                      inputMode="decimal"
                      value={texts[assetClass]}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setTexts((previous) => ({ ...previous, [assetClass]: value }));
                      }}
                      className="h-8 w-full min-w-0 bg-transparent text-right font-mono text-[13px] text-fg outline-none"
                    />
                    <span className="text-[12px] text-subtle">%</span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border-strong">
            <th scope="row" className="pt-2 text-left font-medium text-fg">
              {m.invest_targets_total()}
            </th>
            <td colSpan={3} className="pt-2 text-right">
              <Percent
                value={check.totalBps / 10_000}
                decimals={2}
                locale={locale}
                className={check.valid ? 'text-fg' : 'text-red-fg'}
              />
            </td>
          </tr>
        </tfoot>
      </table>
      {check.valid ? null : (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[10px] bg-red-tint-1 px-3 py-2.5">
          <span className="flex-1 text-[12.5px] text-red-fg">
            {check.excessBps > 0
              ? m.invest_targets_over({ points: points(check.excessBps, locale, false) })
              : m.invest_targets_under({ points: points(-check.excessBps, locale, false) })}
          </span>
          {check.fix === null ? null : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const fix = check.fix as { key: string; targetBps: number };
                setTexts((previous) => ({ ...previous, [fix.key]: bpsToText(fix.targetBps, locale) }));
              }}
            >
              {check.excessBps > 0
                ? m.invest_targets_take({
                    points: points(check.excessBps, locale, false),
                    name: classLabel(check.fix.key as AssetClass),
                  })
                : m.invest_targets_give({
                    points: points(-check.excessBps, locale, false),
                    name: classLabel(check.fix.key as AssetClass),
                  })}
            </Button>
          )}
        </div>
      )}
      {failure === null ? null : <FormError>{failure}</FormError>}
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-subtle">
          {changed === 0 ? m.invest_targets_unchanged() : m.invest_targets_changed({ count: changed })}
        </span>
        <span className="flex-1" />
        <Button variant="secondary" onClick={onCancel}>
          {m.invest_cancel()}
        </Button>
        <Button type="submit" pending={pending} disabled={invalid || !check.valid}>
          {m.invest_targets_save()}
        </Button>
      </div>
    </form>
  );
}
