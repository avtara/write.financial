// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Tag (FR-K3, design `k2GrzG`): every tag with how often it is used and the old names that still resolve
 * to it, search and sort, "Tag baru" with the `#` slug shown as you type, rename, delete, and merge. Likely
 * duplicates ("3 tag terlihat sama") come from the server's similarity check; each group can be merged into its most
 * used tag in one click or reviewed first in the merge panel.
 */
import { useRouter } from '@tanstack/react-router';
import type { TagPair, TagView } from '@wf/db/tags';
import { normalizeTagSlug, TAG_SLUG_MAX } from '@wf/domain/tags';
import { m } from '@wf/i18n/messages';
import { ConfirmDialog } from '@wf/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@wf/ui/dropdown-menu';
import { toast } from '@wf/ui/toast';
import { Check, Ellipsis, Merge, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import type { Result } from '../../server/access.ts';
import { createTag, deleteTag, mergeTags, renameTag } from '../../server/fn/tags.ts';
import { Button, Select as NativeSelect, TextInput } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { settle } from '../setup/result.ts';
import { matchTags, TagMergePanel } from './tag-merge-panel.tsx';

type Sort = 'usage' | 'name';

/**
 * Groups the similar pairs into sets of tags that look alike (`reimburse`, `reimburse-kantor`, `kerja-reimburse`),
 * each ordered most used first. Pairs naming a tag that is no longer listed are skipped.
 */
export function similarGroups(tags: readonly TagView[], pairs: readonly TagPair[]): TagView[][] {
  const listed = new Set(tags.map((tag) => tag.slug));
  const linked = new Map<string, string[]>();
  for (const { a, b } of pairs) {
    if (!listed.has(a) || !listed.has(b)) continue;
    linked.set(a, [...(linked.get(a) ?? []), b]);
    linked.set(b, [...(linked.get(b) ?? []), a]);
  }
  const grouped = new Set<string>();
  const groups: TagView[][] = [];
  // `tags` is most used first, so every group is too.
  for (const tag of tags) {
    const start = linked.get(tag.slug);
    if (start === undefined || grouped.has(tag.slug)) continue;
    const members = new Set([tag.slug]);
    const queue = [...start];
    for (const slug of queue) {
      if (members.has(slug)) continue;
      members.add(slug);
      queue.push(...(linked.get(slug) as string[]));
    }
    for (const slug of members) grouped.add(slug);
    groups.push(tags.filter((entry) => members.has(entry.slug)));
  }
  return groups;
}

/** The live `#slug` preview under a tag input. */
function SlugPreview({ id, input }: { id: string; input: string }) {
  const slug = normalizeTagSlug(input);
  if (input.trim() === '')
    return (
      <p id={id} className="sr-only">
        {m.tag_input_hint()}
      </p>
    );
  return (
    <p id={id} aria-live="polite" className={`text-[11.5px] ${slug === null ? 'text-red-fg' : 'text-subtle'}`}>
      {slug === null ? m.tag_invalid({ max: TAG_SLUG_MAX }) : m.tag_saved_as({ slug: `#${slug}` })}
    </p>
  );
}

/** One `#` input (new tag or rename) with the slug preview and Save/Cancel. */
function TagInput({
  label,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  label: string;
  initial: string;
  submitLabel: string;
  onSubmit: (input: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [input, setInput] = useState(initial);
  const [pending, setPending] = useState(false);
  const id = useId();
  const valid = normalizeTagSlug(input) !== null;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        void onSubmit(input).then((done) => {
          if (!done) setPending(false);
        });
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
      }}
      className="flex flex-1 flex-col gap-1"
    >
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <span
            aria-hidden="true"
            className="absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-[12.5px] text-subtle"
          >
            #
          </span>
          <TextInput
            size="sm"
            aria-label={label}
            aria-describedby={`${id}-preview`}
            aria-invalid={input.trim() !== '' && !valid}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
            }}
            className="pl-6 font-mono"
          />
        </div>
        <Button type="submit" size="sm" pending={pending} disabled={!valid}>
          <Check aria-hidden="true" className="size-3.5" />
          {submitLabel}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {m.settings_cancel()}
        </Button>
      </div>
      <SlugPreview id={`${id}-preview`} input={input} />
    </form>
  );
}

export interface TagsSectionProps {
  readonly tags: readonly TagView[];
  readonly similar: readonly TagPair[];
}

export function TagsSection({ tags, similar }: TagsSectionProps) {
  const router = useRouter();
  const { preferences } = usePreferences();
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('usage');
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TagView | null>(null);
  const [merging, setMerging] = useState<readonly string[] | null>(null);

  /** Runs a write; a refusal becomes an error toast. Resolves whether it succeeded. */
  const run = async <T,>(call: () => Promise<Result<T>>, done: (value: T) => void): Promise<boolean> => {
    const result = await settle(call);
    if (!result.ok) {
      toast({
        title: m.tag_action_failed(),
        description: ledgerErrorMessage(result.code, preferences.locale),
        tone: 'error',
      });
      return false;
    }
    done(result.value);
    void router.invalidate();
    return true;
  };

  const mergeInto = (target: TagView, merged: readonly TagView[]) => {
    toast({
      title: m.tag_merged({ count: merged.length + 1, target: `#${target.slug}` }),
      description: m.tag_merged_aliases({ tags: merged.map((tag) => `#${tag.slug}`).join(', ') }),
    });
  };

  if (merging !== null) {
    return (
      <TagMergePanel
        tags={tags}
        initial={merging}
        onCancel={() => {
          setMerging(null);
        }}
        onMerged={(target, merged) => {
          setMerging(null);
          mergeInto(target, merged);
          void router.invalidate();
        }}
      />
    );
  }

  const shown = matchTags(tags, query);
  if (sort === 'name') shown.sort((a, b) => a.slug.localeCompare(b.slug));
  const groups = similarGroups(tags, similar);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-muted-fg">{m.tag_count({ count: tags.length })}</p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
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
            className="pl-8"
          />
        </div>
        {/* Native: a Radix Select renders inline styles during SSR, which the nonce-only CSP refuses. */}
        <NativeSelect
          size="sm"
          aria-label={m.tag_sort()}
          value={sort}
          onChange={(event) => {
            setSort(event.target.value as Sort);
          }}
          className="w-[190px]"
        >
          <option value="usage">{m.tag_sort_usage()}</option>
          <option value="name">{m.tag_sort_name()}</option>
        </NativeSelect>
        <Button
          size="sm"
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          {m.tag_new()}
        </Button>
      </div>

      {creating ? (
        <div className="rounded-[10px] border border-border p-3">
          <TagInput
            label={m.tag_new_label()}
            initial=""
            submitLabel={m.tag_create()}
            onCancel={() => {
              setCreating(false);
            }}
            onSubmit={(input) =>
              run(
                () => createTag({ data: { input } }),
                (tag) => {
                  setCreating(false);
                  toast({ title: m.tag_created({ slug: `#${tag.slug}` }) });
                },
              )
            }
          />
        </div>
      ) : null}

      {groups.map((group) => {
        const [target, ...rest] = group as [TagView, ...TagView[]];
        return (
          <section
            key={target.id}
            aria-label={m.tag_similar_title({ count: group.length })}
            className="flex flex-wrap items-center gap-3 rounded-[10px] border border-amber-tint-4 bg-amber-tint-1 px-3.5 py-3"
          >
            <Merge aria-hidden="true" className="size-4 shrink-0 text-amber-fg" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h3 className="text-[13px] font-medium text-fg">{m.tag_similar_title({ count: group.length })}</h3>
              <p className="font-mono text-[11.5px] text-muted-fg">
                {group.map((tag) => `#${tag.slug} ${m.tag_usage({ count: tag.usageCount })}`).join(' · ')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void run(
                    () => mergeTags({ data: { sourceIds: rest.map((tag) => tag.id), targetId: target.id } }),
                    (merged) => {
                      mergeInto(merged, rest);
                    },
                  );
                }}
              >
                {m.tag_similar_merge_into({ slug: `#${target.slug}` })}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMerging(group.map((tag) => tag.id));
                }}
              >
                {m.tag_similar_review()}
              </Button>
            </div>
          </section>
        );
      })}

      {tags.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-subtle">
          {m.tag_empty()}
        </p>
      ) : (
        <div className="flex flex-col rounded-[10px] border border-border bg-surface-sunken">
          <div
            aria-hidden="true"
            className="flex h-8 items-center gap-3 border-b border-border px-3 text-[10.5px] font-medium text-subtle uppercase"
          >
            <span className="flex-1">{m.tag_column_tag()}</span>
            <span className="w-20 text-right">{m.tag_column_used()}</span>
            <span className="w-7" />
          </div>
          {shown.length === 0 ? (
            <p className="px-3 py-4 text-[12.5px] text-subtle">{m.tag_no_results()}</p>
          ) : (
            <ul aria-label={m.tag_list_label()} className="flex flex-col divide-y divide-border">
              {shown.map((tag) => (
                <li key={tag.id} className="flex min-h-[40px] items-center gap-3 px-3 py-1.5">
                  {renaming === tag.id ? (
                    <TagInput
                      label={m.tag_rename_label({ slug: `#${tag.slug}` })}
                      initial={tag.slug}
                      submitLabel={m.settings_save()}
                      onCancel={() => {
                        setRenaming(null);
                      }}
                      onSubmit={(input) =>
                        run(
                          () => renameTag({ data: { id: tag.id, input } }),
                          (renamed) => {
                            setRenaming(null);
                            toast({ title: m.tag_renamed({ slug: `#${renamed.slug}` }) });
                          },
                        )
                      }
                    />
                  ) : (
                    <>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-mono text-[12.5px] font-medium text-fg">
                          <span aria-hidden="true" className="text-subtle">
                            #{' '}
                          </span>
                          {tag.slug}
                        </span>
                        {tag.aliases.length === 0 ? null : (
                          <span className="truncate text-[11.5px] text-subtle">
                            {m.tag_aliases({ aliases: tag.aliases.map((alias) => `#${alias}`).join(', ') })}
                          </span>
                        )}
                      </div>
                      <span className="w-20 text-right font-mono text-[12px] text-muted-fg">
                        {m.tag_usage({ count: tag.usageCount })}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          aria-label={m.tag_menu({ slug: `#${tag.slug}` })}
                          className="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-muted"
                        >
                          <Ellipsis aria-hidden="true" className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[200px]">
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              icon={Pencil}
                              onSelect={() => {
                                setRenaming(tag.id);
                              }}
                            >
                              {m.tag_menu_rename()}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              icon={Merge}
                              onSelect={() => {
                                setMerging([tag.id]);
                              }}
                            >
                              {m.tag_menu_merge()}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              icon={Trash2}
                              variant="destructive"
                              onSelect={() => {
                                setDeleting(tag);
                              }}
                            >
                              {m.tag_menu_delete()}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {deleting === null ? null : (
        <ConfirmDialog
          open
          onOpenChange={() => {
            setDeleting(null);
          }}
          variant="destructive"
          title={m.tag_delete_title({ slug: `#${deleting.slug}` })}
          description={
            deleting.usageCount === 0 ? m.tag_delete_unused() : m.tag_delete_used({ count: deleting.usageCount })
          }
          cancelLabel={m.settings_cancel()}
          confirmLabel={m.tag_menu_delete()}
          onConfirm={() => {
            const slug = `#${deleting.slug}`;
            void run(
              () => deleteTag({ data: { id: deleting.id } }),
              () => toast({ title: m.tag_deleted({ slug }) }),
            );
          }}
        />
      )}
    </div>
  );
}
