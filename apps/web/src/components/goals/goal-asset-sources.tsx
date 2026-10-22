// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Investment assets on the goals page (FR-G2, G5, G6; design 13 `UpO8Q` / `QCbeZ`, `F6SPeB`, `Dr2U1`): the goal
 * form's asset source rows (a percentage of the units or the whole asset; Σ per asset across goals ≤ 100%, "Melebihi
 * 100% — Dana Pensiun sudah memakai 40%"), the notice when an asset the goals hold fell today ("SPY turun 3,1% hari
 * ini · DP Rumah −Rp251.000"), and the valuation fallback when prices are missing ("Lihat saldo rekening saja").
 */
import type { GoalView } from '@wf/db/goals';
import { ratioBps } from '@wf/domain/budget';
import {
  goalImpact,
  goalShares,
  splitUnits,
  type GoalAssetSource,
  type GoalAssetSourceMode,
} from '@wf/domain/goal-assets';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { Select } from '@wf/ui/select';
import { CircleAlert, Plus, TrendingDown, X } from 'lucide-react';
import type { GoalAssetOption } from '../../server/fn/investments.ts';
import { Button } from '../form.tsx';
import { formatUnits } from '../investments/investments-model.ts';
import { percentToBps } from '../investments/targets-dialog.tsx';

export interface AssetSourceDraft {
  readonly key: number;
  readonly assetId: string | null;
  readonly mode: GoalAssetSourceMode;
  /** Percent text ("60"), `percent` only. */
  readonly percent: string;
}

/** What the other goals already hold of `asset` (bps). */
function heldByOthers(asset: GoalAssetOption, goalId: string | null): number {
  return asset.goals
    .filter((goal) => goal.goalId !== goalId)
    .reduce((sum, goal) => sum + (goal.mode === 'whole' ? 10_000 : goal.bps), 0);
}

/** The draft's share in bps; `null` when the percentage is not 0,01–100. */
export function draftBps(draft: AssetSourceDraft): number | null {
  if (draft.mode === 'whole') return 10_000;
  const bps = percentToBps(draft.percent);
  return bps === null || bps === 0 ? null : bps;
}

/** A row's problem, or `null`: no asset, no valid percentage, or more than what the other goals left. */
export function draftProblem(
  draft: AssetSourceDraft,
  assets: readonly GoalAssetOption[],
  goalId: string | null,
  locale: Locale,
) {
  const asset = assets.find((candidate) => candidate.id === draft.assetId);
  if (asset === undefined) return m.goals_asset_error_pick();
  const bps = draftBps(draft);
  if (bps === null) return m.goals_asset_error_percent();
  const others = heldByOthers(asset, goalId);
  if (bps + others > 10_000) {
    const names = asset.goals
      .filter((goal) => goal.goalId !== goalId)
      .map((goal) => goal.goalName)
      .join(', ');
    return m.goals_asset_error_total({
      names,
      used: formatPercentBps(others, locale),
      max: formatPercentBps(10_000 - others, locale),
    });
  }
  return null;
}

/** "40%", "12,5%" of a share in bps. */
function formatPercentBps(bps: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(bps / 10_000);
}

/** The starting rows from a goal's asset sources. */
export function assetDraftsOf(goal: GoalView | undefined, locale: Locale): AssetSourceDraft[] {
  return (goal?.assetSources ?? []).map((source, key) => ({
    key,
    assetId: source.assetId,
    mode: source.mode,
    percent:
      source.mode === 'whole'
        ? ''
        : new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(source.bps / 100),
  }));
}

export interface AssetSourceRowsProps {
  readonly drafts: readonly AssetSourceDraft[];
  readonly onChange: (drafts: AssetSourceDraft[]) => void;
  readonly assets: readonly GoalAssetOption[];
  readonly goalId: string | null;
  readonly currency: string;
  readonly locale: Locale;
  readonly showErrors: boolean;
}

/** The goal's part of the asset's value for one source (`undefined` without a value). */
function valueShare(asset: GoalAssetOption, source: GoalAssetSource): bigint | undefined {
  return asset.valueBaseMinor === null ? undefined : goalShares(asset.valueBaseMinor, [source]).goals[0]?.value;
}

/** "Aset investasi": the goal's asset sources with the value and units each brings. */
export function AssetSourceRows({
  drafts,
  onChange,
  assets,
  goalId,
  currency,
  locale,
  showErrors,
}: AssetSourceRowsProps) {
  const set = (key: number, patch: Partial<AssetSourceDraft>) => {
    onChange(drafts.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-1 text-[12.5px] font-medium text-muted-fg">{m.goals_asset_sources()}</legend>
      <p className="text-[12px] text-subtle">{m.goals_asset_sources_hint()}</p>
      {drafts.map((draft) => {
        const asset = assets.find((candidate) => candidate.id === draft.assetId);
        const taken = new Set(drafts.flatMap((other) => (other.key === draft.key ? [] : (other.assetId ?? []))));
        const problem = draftProblem(draft, assets, goalId, locale);
        const bps = draftBps(draft);
        const others = asset === undefined ? 0 : heldByOthers(asset, goalId);
        const source = { goalId: 'this', mode: draft.mode, bps: bps ?? 0 };
        const fits = asset !== undefined && bps !== null && bps + others <= 10_000;
        const share = fits ? valueShare(asset, source) : undefined;
        const units = fits ? splitUnits(asset.units, [source]).goals[0]?.value : undefined;
        return (
          <div key={draft.key} className="flex flex-col gap-1.5 rounded-[10px] border border-border p-2.5">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,140px)_auto] items-center gap-2">
              <Select
                size="sm"
                aria-label={m.goals_asset_pick()}
                value={draft.assetId}
                onValueChange={(assetId) => {
                  set(draft.key, { assetId });
                }}
                placeholder={m.goals_asset_pick()}
                options={assets
                  .filter((candidate) => !taken.has(candidate.id))
                  .map((candidate) => ({
                    value: candidate.id,
                    label: `${candidate.symbol} · ${candidate.platformName}`,
                    description: candidate.name,
                  }))}
              />
              <Select
                size="sm"
                aria-label={m.goals_asset_mode()}
                value={draft.mode}
                onValueChange={(mode) => {
                  set(draft.key, { mode });
                }}
                placeholder={m.goals_asset_mode()}
                options={[
                  { value: 'percent', label: m.goals_asset_percent() },
                  { value: 'whole', label: m.goals_asset_whole() },
                ]}
              />
              <button
                type="button"
                aria-label={m.goals_asset_remove({ name: asset?.symbol ?? '' })}
                onClick={() => {
                  onChange(drafts.filter((other) => other.key !== draft.key));
                }}
                className="flex size-8 items-center justify-center rounded-[7px] text-subtle hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </div>
            {draft.mode === 'percent' ? (
              <span className="flex w-[110px] items-center gap-1 rounded-[8px] border border-border-input bg-input px-2">
                <input
                  aria-label={m.goals_asset_percent_input({ name: asset?.symbol ?? '' })}
                  aria-invalid={showErrors && problem !== null}
                  inputMode="decimal"
                  value={draft.percent}
                  onChange={(event) => {
                    set(draft.key, { percent: event.currentTarget.value });
                  }}
                  className="h-8 w-full min-w-0 bg-transparent text-right font-mono text-[13px] text-fg outline-none"
                />
                <span className="text-[12px] text-subtle">%</span>
              </span>
            ) : null}
            {asset === undefined ? null : (
              <span className="text-[11.5px] text-subtle">
                {others === 0
                  ? m.goals_asset_unused()
                  : m.goals_asset_used({
                      used: formatPercentBps(others, locale),
                      free: formatPercentBps(Math.max(10_000 - others, 0), locale),
                    })}
                {share === undefined || units === undefined ? null : (
                  <>
                    {' · '}
                    {m.goals_asset_equals()}{' '}
                    <Money minor={share} currency={currency} context="amount" locale={locale} /> ·{' '}
                    {m.goals_asset_units({ units: formatUnits(units, locale, 3) })}
                  </>
                )}
              </span>
            )}
            {showErrors && problem !== null ? (
              <p role="alert" className="text-[12px] text-red-fg">
                {problem}
              </p>
            ) : null}
          </div>
        );
      })}
      <Button
        size="sm"
        variant="secondary"
        className="w-fit"
        disabled={assets.length === 0}
        onClick={() => {
          onChange([
            ...drafts,
            { key: Math.max(0, ...drafts.map((draft) => draft.key)) + 1, assetId: null, mode: 'percent', percent: '' },
          ]);
        }}
      >
        <Plus aria-hidden="true" className="size-3.5" />
        {m.goals_asset_add()}
      </Button>
    </fieldset>
  );
}

/** FR-G6 "Lihat saldo rekening saja": each goal counted on its accounts only. */
export function accountsOnly<T extends GoalView>(goals: readonly T[]): T[] {
  return goals.map((goal) => ({
    ...goal,
    assetSources: [],
    savedMinor: goal.sources.reduce((sum, source) => sum + source.valueMinor, 0n),
  }));
}

export interface GoalAssetNoticesProps {
  readonly goals: readonly GoalView[];
  readonly assets: readonly GoalAssetOption[];
  readonly accountsOnly: boolean;
  readonly currency: string;
  readonly locale: Locale;
  readonly onAccountsOnly: (on: boolean) => void;
  readonly onRetry: () => void;
}

/** The goals page's notices about assets: unpriced assets (FR-G6) and today's price drops (FR-G5). */
export function GoalAssetNotices({
  goals,
  assets,
  accountsOnly: only,
  currency,
  locale,
  onAccountsOnly,
  onRetry,
}: GoalAssetNoticesProps) {
  const used = new Set(goals.flatMap((goal) => goal.assetSources.map((source) => source.assetId)));
  const held = assets.filter((asset) => used.has(asset.id));
  const unpriced = held.filter((asset) => asset.quote === null);
  const drops = held.flatMap((asset) => {
    if (asset.valueBaseMinor === null || asset.todayBaseMinor === null || asset.todayBaseMinor >= 0n) return [];
    const before = asset.valueBaseMinor - asset.todayBaseMinor;
    const changeBps = ratioBps(asset.todayBaseMinor, before);
    const impact = goalImpact(
      before,
      asset.valueBaseMinor,
      asset.goals.map((goal) => ({ goalId: goal.goalId, mode: goal.mode, bps: goal.bps })),
    );
    return [{ asset, changeBps, impact }];
  });
  return (
    <>
      {unpriced.length === 0 && !only ? null : (
        <section
          role="status"
          aria-label={m.goals_asset_fallback_label()}
          className="flex flex-wrap items-center gap-3 rounded-[12px] border border-amber-tint-3 bg-amber-tint-1 px-4 py-3"
        >
          <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-amber-fg" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-[13px] font-medium text-fg">
              {only ? m.goals_asset_fallback_on_title() : m.goals_asset_fallback_title()}
            </p>
            <p className="text-[12.5px] text-muted-fg">
              {only
                ? m.goals_asset_fallback_on()
                : m.goals_asset_fallback({ symbols: unpriced.map((asset) => asset.symbol).join(', ') })}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={onRetry}>
            {m.goals_retry()}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            aria-pressed={only}
            onClick={() => {
              onAccountsOnly(!only);
            }}
          >
            {only ? m.goals_asset_fallback_all() : m.goals_asset_fallback_accounts()}
          </Button>
        </section>
      )}
      {drops.map(({ asset, changeBps, impact }) => (
        <section
          key={asset.id}
          role="status"
          aria-label={m.goals_asset_drop_label({ symbol: asset.symbol })}
          className="flex items-start gap-3 rounded-[12px] border border-border bg-card px-4 py-3"
        >
          <TrendingDown aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-red-fg" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-[13px] font-medium text-fg">
              {m.goals_asset_drop_title({ symbol: asset.symbol })}{' '}
              {changeBps === null ? null : <Percent value={changeBps / 10_000} signed locale={locale} />}
            </p>
            <p className="text-[12.5px] text-muted-fg">
              {m.goals_asset_drop()}{' '}
              {impact.map((entry, index) => (
                <span key={entry.goalId}>
                  {index === 0 ? null : ', '}
                  {asset.goals.find((goal) => goal.goalId === entry.goalId)?.goalName}{' '}
                  <Money minor={entry.deltaMinor} currency={currency} context="delta" locale={locale} />
                </span>
              ))}
              {'. '}
              {m.goals_asset_drop_note()}
            </p>
          </div>
        </section>
      ))}
    </>
  );
}
