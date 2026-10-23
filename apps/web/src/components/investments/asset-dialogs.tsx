// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dialogs of an asset's ⋮ menu: "Sesuaikan kepemilikan" (FR-I2, design 09 `j2SH8r` / `oExkI`: platform units vs the
 * recorded ones, the difference explained as an unrecorded buy, a DRIP dividend or a correction — fewer units go on
 * to "Catat jual" or a correction, with the goals' impact and, for two or more goals, the goal reduced), "Pindah ke
 * kategori…" (`hP70H`), and "Atur alokasi ke tujuan…" (FR-G2, `Oi44y`: each goal's share, Σ ≤ 100%).
 */
import type { AssetView, CategoryView } from '@wf/db/investments';
import { parseDecimal } from '@wf/domain/decimal';
import {
  checkAssetAllocations,
  goalImpact,
  needsGoalChoice,
  type GoalAssetSource,
  type GoalAssetSourceMode,
} from '@wf/domain/goal-assets';
import { adjustmentPreview, type AdjustmentPreview } from '@wf/domain/investments';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { useState, type SyntheticEvent } from 'react';
import { Button, Field, FormError, TextInput } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { percentToBps } from './targets-dialog.tsx';
import { assetSources, decimalInput, decimalText, formatUnits } from './investments-model.ts';

export type AdjustReason = 'unrecorded_buy' | 'drip' | 'correction';

/** "Sesuaikan kepemilikan" as entered; the page adds the time. */
export interface AdjustDraft {
  readonly clientId: string;
  readonly assetId: string;
  readonly units: string;
  readonly reason: AdjustReason;
  readonly amountMinor: bigint | null;
  readonly price: string | null;
  readonly fxRate: string | null;
  readonly reduceGoalId: string | null;
}

export interface AdjustDialogProps {
  readonly asset: AssetView | null;
  readonly rate: string | null;
  readonly base: string;
  readonly locale: Locale;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (draft: AdjustDraft) => Promise<string | null>;
  /** "Lanjut ke Catat jual" with the missing units. */
  readonly onSell: (asset: AssetView, amountMinor: bigint) => void;
}

export function AdjustDialog({ asset, onOpenChange, ...props }: AdjustDialogProps) {
  return (
    <Modal
      open={asset !== null}
      onOpenChange={onOpenChange}
      title={asset === null ? '' : m.invest_adjust_title({ symbol: asset.symbol })}
      description={m.invest_adjust_description()}
      size="xl"
    >
      {asset === null ? null : (
        <AdjustForm
          asset={asset}
          {...props}
          onCancel={() => {
            onOpenChange(false);
          }}
        />
      )}
    </Modal>
  );
}

function AdjustForm({
  asset,
  rate,
  base,
  locale,
  onSubmit,
  onSell,
  onCancel,
}: Omit<AdjustDialogProps, 'asset' | 'onOpenChange'> & { readonly asset: AssetView; readonly onCancel: () => void }) {
  const [unitsText, setUnitsText] = useState('');
  const [reason, setReason] = useState<'sale' | AdjustReason | null>(null);
  const [reduceGoalId, setReduceGoalId] = useState<string | null>(null);
  const [clientId] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const units = unitsText.trim() === '0' ? '0' : decimalInput(unitsText, locale);
  const price = asset.quote?.price ?? null;
  const fxRate = asset.quoteCurrency === base ? '1' : rate;
  const preview: AdjustmentPreview | null =
    units === null || price === null || fxRate === null
      ? null
      : adjustmentPreview(asset.holding, units, { price, fxRate }, { quote: asset.quoteCurrency, base });
  const delta = preview === null ? 0n : parseDecimal(preview.unitsDelta);
  const fewer = delta < 0n;
  const chosen: 'sale' | AdjustReason = fewer
    ? reason === null || reason === 'sale'
      ? 'sale'
      : 'correction'
    : reason === null || reason === 'sale'
      ? 'unrecorded_buy'
      : reason;
  const sources = assetSources(asset);
  const missingUnits = preview === null ? '0' : preview.unitsDelta.slice(1);
  const choose = fewer && chosen === 'correction' && needsGoalChoice(asset.holding.units, sources, missingUnits);
  const valueNow = asset.value?.valueBaseMinor ?? 0n;
  const impact =
    preview === null || sources.length === 0 ? [] : goalImpact(valueNow, valueNow + preview.valueBaseMinor, sources);

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (preview === null || units === null || delta === 0n) return;
    if (chosen === 'sale') {
      onSell(asset, -preview.valueMinor);
      return;
    }
    if (choose && reduceGoalId === null) return;
    setPending(true);
    const failed = await onSubmit({
      clientId,
      assetId: asset.id,
      units,
      reason: chosen,
      amountMinor: chosen === 'correction' ? null : preview.valueMinor,
      price,
      fxRate: asset.quoteCurrency === base ? null : fxRate,
      reduceGoalId: choose ? reduceGoalId : null,
    });
    setPending(false);
    setFailure(failed);
  };

  const options: readonly { readonly value: 'sale' | AdjustReason; readonly label: string; readonly hint: string }[] =
    fewer
      ? [
          { value: 'sale', label: m.invest_adjust_sale(), hint: m.invest_adjust_sale_hint() },
          { value: 'correction', label: m.invest_adjust_fix(), hint: m.invest_adjust_fix_down_hint() },
        ]
      : [
          { value: 'unrecorded_buy', label: m.invest_adjust_unrecorded(), hint: m.invest_adjust_unrecorded_hint() },
          { value: 'drip', label: m.invest_adjust_drip(), hint: m.invest_adjust_drip_hint() },
          { value: 'correction', label: m.invest_adjust_fix(), hint: m.invest_adjust_fix_up_hint() },
        ];
  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 rounded-[10px] border border-border p-3">
          <span className="text-[11.5px] text-subtle">{m.invest_adjust_recorded()}</span>
          <span className="font-mono text-[15px] text-fg">{formatUnits(asset.holding.units, locale)}</span>
        </div>
        <Field label={m.invest_adjust_platform({ platform: asset.platformName })}>
          {({ id }) => (
            <TextInput
              id={id}
              inputMode="decimal"
              autoFocus
              value={unitsText}
              placeholder={decimalText(asset.holding.units, locale)}
              onChange={(event) => {
                setUnitsText(event.currentTarget.value);
              }}
            />
          )}
        </Field>
      </div>
      {price === null ? <p className="text-[12.5px] text-amber-fg">{m.invest_adjust_no_price()}</p> : null}
      {preview === null || delta === 0n ? null : (
        <>
          <p className="text-[12.5px] text-muted-fg">
            {m.invest_adjust_difference({ units: formatUnits(preview.unitsDelta, locale) })}{' '}
            <Money minor={preview.valueBaseMinor} currency={base} context="delta" locale={locale} />
          </p>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[12.5px] font-medium text-fg">{m.invest_adjust_why()}</legend>
            {options.map((option) => (
              <label key={option.value} className="flex items-start gap-2 text-[12.5px]">
                <input
                  type="radio"
                  name="adjust-reason"
                  checked={chosen === option.value}
                  onChange={() => {
                    setReason(option.value);
                  }}
                  className="mt-0.5 size-4 accent-fg"
                />
                <span className="flex flex-col">
                  <span className="text-fg">{option.label}</span>
                  <span className="text-[11.5px] text-subtle">{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {choose ? (
            <fieldset className="flex flex-col gap-2 rounded-[10px] border border-amber-tint-3 p-3">
              <legend className="px-1 text-[12.5px] font-medium text-fg">
                {m.invest_trade_goal_choice({ symbol: asset.symbol, count: asset.goals.length })}
              </legend>
              {asset.goals.map((goal) => (
                <label key={goal.goalId} className="flex items-center gap-2 text-[12.5px] text-muted-fg">
                  <input
                    type="radio"
                    name="adjust-goal"
                    checked={reduceGoalId === goal.goalId}
                    onChange={() => {
                      setReduceGoalId(goal.goalId);
                    }}
                    className="size-4 accent-fg"
                  />
                  {m.invest_trade_goal_reduce({ name: goal.goalName })}
                </label>
              ))}
            </fieldset>
          ) : null}
          {impact.length === 0 ? null : (
            <ul className="flex flex-col gap-1 rounded-[10px] bg-surface-2 p-3 text-[12.5px] text-muted-fg">
              {impact.map((entry) => (
                <li key={entry.goalId} className="flex justify-between gap-2">
                  <span>{asset.goals.find((goal) => goal.goalId === entry.goalId)?.goalName}</span>
                  <Money minor={entry.deltaMinor} currency={base} context="delta" locale={locale} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {failure === null ? null : <FormError>{failure}</FormError>}
      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {m.invest_cancel()}
        </Button>
        <Button type="submit" pending={pending} disabled={preview === null || delta === 0n}>
          {chosen === 'sale' ? m.invest_adjust_to_sell() : m.invest_adjust_save()}
        </Button>
      </div>
    </form>
  );
}

export interface MoveDialogProps {
  readonly asset: AssetView | null;
  readonly categories: readonly CategoryView[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (asset: AssetView, categoryId: string | null) => Promise<string | null>;
}

/** "Pindahkan {symbol} ke…": a category or no category ("Aset tunggal"). */
export function MoveDialog({ asset, categories, onOpenChange, onSubmit }: MoveDialogProps) {
  return (
    <Modal
      open={asset !== null}
      onOpenChange={onOpenChange}
      title={asset === null ? '' : m.invest_move_title({ symbol: asset.symbol })}
      description={m.invest_move_description()}
    >
      {asset === null ? null : (
        <MoveForm
          asset={asset}
          categories={categories}
          onSubmit={onSubmit}
          onCancel={() => {
            onOpenChange(false);
          }}
        />
      )}
    </Modal>
  );
}

function MoveForm({
  asset,
  categories,
  onSubmit,
  onCancel,
}: Omit<MoveDialogProps, 'asset' | 'onOpenChange'> & { readonly asset: AssetView; readonly onCancel: () => void }) {
  const [categoryId, setCategoryId] = useState<string | null>(asset.categoryId);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setPending(true);
    setFailure(await onSubmit(asset, categoryId));
    setPending(false);
  };
  const choices = [
    { id: null, name: m.invest_move_single() },
    ...categories.map((category) => ({ id: category.id, name: category.name })),
  ];
  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{m.invest_move_title({ symbol: asset.symbol })}</legend>
        {choices.map((choice) => (
          <label
            key={choice.id ?? 'single'}
            className="flex items-center gap-2 rounded-[8px] border border-border px-3 py-2 text-[13px] text-fg"
          >
            <input
              type="radio"
              name="move-category"
              checked={categoryId === choice.id}
              onChange={() => {
                setCategoryId(choice.id);
              }}
              className="size-4 accent-fg"
            />
            {choice.name}
          </label>
        ))}
      </fieldset>
      {failure === null ? null : <FormError>{failure}</FormError>}
      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {m.invest_cancel()}
        </Button>
        <Button type="submit" pending={pending}>
          {m.invest_move_save()}
        </Button>
      </div>
    </form>
  );
}

/** A goal's share as entered: none, part (percent text), or the whole asset. */
type ShareChoice = { readonly mode: 'none' } | { readonly mode: GoalAssetSourceMode; readonly text: string };

export interface AssetGoalsDialogProps {
  readonly asset: AssetView | null;
  readonly goals: readonly { readonly id: string; readonly name: string }[];
  readonly base: string;
  readonly locale: Locale;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (asset: AssetView, sources: readonly GoalAssetSource[]) => Promise<string | null>;
}

/** "Atur alokasi ke tujuan": each goal's part of the asset (FR-G2; DCA units follow the same split). */
export function AssetGoalsDialog({ asset, onOpenChange, ...props }: AssetGoalsDialogProps) {
  return (
    <Modal
      open={asset !== null}
      onOpenChange={onOpenChange}
      title={asset === null ? '' : m.invest_goals_title({ symbol: asset.symbol })}
      description={m.invest_goals_description()}
      size="xl"
    >
      {asset === null ? null : (
        <AssetGoalsForm
          asset={asset}
          {...props}
          onCancel={() => {
            onOpenChange(false);
          }}
        />
      )}
    </Modal>
  );
}

function AssetGoalsForm({
  asset,
  goals,
  base,
  locale,
  onSubmit,
  onCancel,
}: Omit<AssetGoalsDialogProps, 'asset' | 'onOpenChange'> & {
  readonly asset: AssetView;
  readonly onCancel: () => void;
}) {
  const [choices, setChoices] = useState<Readonly<Record<string, ShareChoice>>>(() =>
    Object.fromEntries(
      goals.map((goal) => {
        const current = asset.goals.find((source) => source.goalId === goal.id);
        return [
          goal.id,
          current === undefined
            ? { mode: 'none' }
            : {
                mode: current.mode,
                text:
                  current.mode === 'whole' ? '' : String(current.bps / 100).replace('.', locale === 'id' ? ',' : '.'),
              },
        ];
      }),
    ),
  );
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const sources = goals.flatMap((goal): GoalAssetSource[] => {
    const choice = choices[goal.id] as ShareChoice;
    if (choice.mode === 'none') return [];
    return [
      { goalId: goal.id, mode: choice.mode, bps: choice.mode === 'whole' ? 10_000 : (percentToBps(choice.text) ?? 0) },
    ];
  });
  let problem: string | null = null;
  try {
    checkAssetAllocations(sources);
  } catch {
    problem = sources.some((source) => source.bps === 0)
      ? m.invest_goals_error_percent()
      : m.invest_goals_error_total();
  }
  const total = sources.reduce((sum, source) => sum + source.bps, 0);
  const value = (asset.value?.valueBaseMinor ?? 0n) + asset.pendingBaseMinor;

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (problem !== null) return;
    setPending(true);
    setFailure(await onSubmit(asset, sources));
    setPending(false);
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      {goals.length === 0 ? <p className="text-[12.5px] text-muted-fg">{m.invest_goals_none()}</p> : null}
      <ul className="flex flex-col gap-2">
        {goals.map((goal) => {
          const choice = choices[goal.id] as ShareChoice;
          const set = (next: ShareChoice) => {
            setChoices((previous) => ({ ...previous, [goal.id]: next }));
          };
          const bps = choice.mode === 'none' ? 0 : choice.mode === 'whole' ? 10_000 : (percentToBps(choice.text) ?? 0);
          return (
            <li
              key={goal.id}
              className="flex flex-wrap items-center gap-2 rounded-[10px] border border-border px-3 py-2"
            >
              <span className="min-w-0 flex-1 text-[13px] text-fg">{goal.name}</span>
              <select
                aria-label={m.invest_goals_mode({ name: goal.name })}
                value={choice.mode}
                onChange={(event) => {
                  const mode = event.currentTarget.value as ShareChoice['mode'];
                  set(mode === 'none' ? { mode } : { mode, text: choice.mode === 'percent' ? choice.text : '' });
                }}
                className="h-8 rounded-[8px] border border-border-input bg-input px-2 text-[12.5px] text-fg"
              >
                <option value="none">{m.invest_goals_mode_none()}</option>
                <option value="percent">{m.invest_goals_mode_percent()}</option>
                <option value="whole">{m.invest_goals_mode_whole()}</option>
              </select>
              {choice.mode === 'percent' ? (
                <span className="flex w-[84px] items-center gap-1 rounded-[8px] border border-border-input bg-input px-2">
                  <input
                    aria-label={m.invest_goals_percent({ name: goal.name })}
                    inputMode="decimal"
                    value={choice.text}
                    onChange={(event) => {
                      set({ mode: 'percent', text: event.currentTarget.value });
                    }}
                    className="h-8 w-full min-w-0 bg-transparent text-right font-mono text-[13px] text-fg outline-none"
                  />
                  <span className="text-[12px] text-subtle">%</span>
                </span>
              ) : null}
              <Money
                minor={(value * BigInt(bps)) / 10_000n}
                currency={base}
                context="amount"
                locale={locale}
                className="w-[120px] text-right text-[12.5px] text-muted-fg"
              />
            </li>
          );
        })}
      </ul>
      <p
        className={`text-[12.5px] ${problem === null ? 'text-muted-fg' : 'text-red-fg'}`}
        role={problem === null ? undefined : 'alert'}
      >
        {problem ??
          m.invest_goals_free({ percent: String((10_000 - total) / 100).replace('.', locale === 'id' ? ',' : '.') })}
      </p>
      {failure === null ? null : <FormError>{failure}</FormError>}
      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {m.invest_cancel()}
        </Button>
        <Button type="submit" pending={pending} disabled={problem !== null}>
          {m.invest_goals_save()}
        </Button>
      </div>
    </form>
  );
}
