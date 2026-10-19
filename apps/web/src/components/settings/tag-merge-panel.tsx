// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Gabungkan tag" (design `Q283b`): choose two or more tags, then the tag they merge into (the most used one by
 * default). Their transactions move to the target, the others are deleted, and their slugs become aliases of the
 * target, so typing an old name still finds it.
 */
import type { TagView } from '@wf/db/tags';
import { normalizeTagSlug } from '@wf/domain/tags';
import { m } from '@wf/i18n/messages';
import { Checkbox } from '@wf/ui/checkbox';
import { Select } from '@wf/ui/select';
import { ArrowLeftRight, Merge, Search, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { mergeTags } from '../../server/fn/tags.ts';
import { Button, FormError, TextInput } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { settle } from '../setup/result.ts';

/** Tags whose slug or an alias contains the normalized `query` (all of them for an empty query). */
export function matchTags(tags: readonly TagView[], query: string): TagView[] {
  const needle = normalizeTagSlug(query);
  if (needle === null) return [...tags];
  return tags.filter((tag) => tag.slug.includes(needle) || tag.aliases.some((alias) => alias.includes(needle)));
}

export interface TagMergePanelProps {
  readonly tags: readonly TagView[];
  /** Ids chosen when the panel opens (a similar-tags suggestion or a row's "Gabungkan dengan…"). */
  readonly initial: readonly string[];
  readonly onCancel: () => void;
  readonly onMerged: (target: TagView, merged: readonly TagView[]) => void;
}

export function TagMergePanel({ tags, initial, onCancel, onMerged }: TagMergePanelProps) {
  const { preferences } = usePreferences();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<readonly string[]>(initial);
  const [chosenTarget, setChosenTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const searchId = useId();

  const shown = matchTags(tags, query);
  // In list order (most used first), so the default target is the most used one.
  const picked = tags.filter((tag) => selected.includes(tag.id));
  const target = picked.find((tag) => tag.id === chosenTarget) ?? picked[0];
  const sources = picked.filter((tag) => tag !== target);
  const total = picked.reduce((sum, tag) => sum + tag.usageCount, 0);

  const toggle = (id: string, on: boolean) => {
    setSelected((current) => (on ? [...current, id] : current.filter((entry) => entry !== id)));
  };

  const submit = async (into: TagView, from: readonly TagView[]) => {
    setPending(true);
    setError(null);
    const result = await settle(() => mergeTags({ data: { sourceIds: from.map((tag) => tag.id), targetId: into.id } }));
    setPending(false);
    if (!result.ok) {
      setError(ledgerErrorMessage(result.code, preferences.locale));
      return;
    }
    onMerged(result.value, from);
  };

  return (
    <section aria-labelledby={`${searchId}-title`} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 id={`${searchId}-title`} className="text-[15px] font-semibold text-fg">
          {m.tag_merge_title()}
        </h3>
        <p className="text-[12.5px] text-muted-fg">{m.tag_merge_description()}</p>
      </div>
      <div className="relative">
        <Search aria-hidden="true" className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" />
        <label htmlFor={searchId} className="sr-only">
          {m.tag_search()}
        </label>
        <TextInput
          id={searchId}
          size="sm"
          type="search"
          autoComplete="off"
          placeholder={m.tag_search()}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="pr-20 pl-8"
        />
        <span aria-live="polite" className="absolute top-1/2 right-2.5 -translate-y-1/2 text-[11.5px] text-subtle">
          {m.tag_merge_results({ count: shown.length })}
        </span>
      </div>
      <fieldset className="flex flex-col rounded-[10px] border border-border bg-surface-sunken">
        <legend className="sr-only">{m.tag_merge_choose()}</legend>
        <div className="flex h-8 items-center justify-between border-b border-border px-3 text-[10.5px] font-medium text-subtle uppercase">
          <span>{m.tag_merge_selected({ count: picked.length })}</span>
          <span>{m.tag_column_used()}</span>
        </div>
        <div className="flex max-h-[280px] flex-col divide-y divide-border overflow-y-auto">
          {shown.map((tag) => (
            <div key={tag.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <Checkbox
                checked={selected.includes(tag.id)}
                onChange={(event) => {
                  toggle(tag.id, event.target.checked);
                }}
                label={
                  <span className="font-mono text-[12.5px] text-fg">
                    <span aria-hidden="true" className="text-subtle">
                      #{' '}
                    </span>
                    {tag.slug}
                  </span>
                }
              />
              <span className="font-mono text-[12px] text-muted-fg">{m.tag_usage({ count: tag.usageCount })}</span>
            </div>
          ))}
        </div>
      </fieldset>

      {target === undefined || sources.length === 0 ? (
        <p className="text-[12.5px] text-subtle">{m.tag_merge_pick_two()}</p>
      ) : (
        <div className="flex flex-col gap-3 rounded-[10px] border border-border p-4">
          <div className="flex flex-col gap-1.5">
            <span aria-hidden="true" className="text-[12.5px] font-medium text-muted-fg">
              {m.tag_merge_target()}
            </span>
            <Select
              aria-label={m.tag_merge_target()}
              value={target.id}
              onValueChange={setChosenTarget}
              placeholder={m.tag_merge_target()}
              options={picked.map((tag, index) => ({
                value: tag.id,
                label: `#${tag.slug}`,
                ...(index === 0 ? { description: m.tag_merge_most_used() } : {}),
              }))}
            />
          </div>
          <ul className="flex flex-col gap-1.5 text-[12.5px] text-muted-fg">
            <li className="flex items-center gap-2">
              <ArrowLeftRight aria-hidden="true" className="size-3.5 shrink-0 text-subtle" />
              {m.tag_merge_impact_updated({ count: total, breakdown: picked.map((tag) => tag.usageCount).join(' + ') })}
            </li>
            <li className="flex items-center gap-2">
              <Trash2 aria-hidden="true" className="size-3.5 shrink-0 text-subtle" />
              {m.tag_merge_impact_removed({
                tags: sources.map((tag) => `#${tag.slug}`).join(', '),
                target: `#${target.slug}`,
              })}
            </li>
          </ul>
          {error === null ? null : <FormError>{error}</FormError>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onCancel}>
              {m.settings_cancel()}
            </Button>
            <Button
              size="sm"
              pending={pending}
              onClick={() => {
                void submit(target, sources);
              }}
            >
              <Merge aria-hidden="true" className="size-3.5" />
              {m.tag_merge_submit({ count: picked.length })}
            </Button>
          </div>
        </div>
      )}
      {target === undefined || sources.length === 0 ? (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {m.settings_cancel()}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
