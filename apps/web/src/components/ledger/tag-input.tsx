// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tag entry of the ledger forms (FR-K3, design `MFm6o`): typing (with or without `#`) suggests the user's tags with
 * their usage counts and offers to create a new one; ↑/↓ move, ↵ adds, Esc closes the list, Backspace in an empty
 * field removes the last tag. Every tag is normalized to a slug (`normalizeTagSlug`), at most five per transaction.
 */
import type { TagView } from '@wf/db/tags';
import { normalizeTagSlug } from '@wf/domain/tags';
import { MAX_TAGS_PER_TRANSACTION } from '@wf/domain/transactions';
import { m } from '@wf/i18n/messages';
import { Popover, PopoverAnchor, PopoverContent } from '@wf/ui/popover';
import { Plus, Tag, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';

/** Suggestions shown at once. */
const SUGGESTION_LIMIT = 6;
/** "Sering dipakai" chips. */
const FREQUENT_LIMIT = 3;

export interface TagInputProps {
  readonly value: readonly string[];
  readonly onValueChange: (tags: string[]) => void;
  /** The user's tags with usage counts (`listTags`). */
  readonly tags: readonly TagView[];
  /** From a `Field`. */
  readonly id?: string;
  readonly 'aria-describedby'?: string | undefined;
}

type Option = { readonly slug: string; readonly usageCount: number | null };

export function TagInput({ value, onValueChange, tags, id, 'aria-describedby': describedBy }: TagInputProps) {
  const listId = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const full = value.length >= MAX_TAGS_PER_TRANSACTION;

  const query = text.replace(/^#+/, '').trim().toLowerCase();
  const slug = normalizeTagSlug(text);
  const matches: Option[] =
    query === ''
      ? []
      : tags
          .filter(
            (tag) =>
              !value.includes(tag.slug) &&
              (tag.slug.includes(query) || tag.aliases.some((alias) => alias.includes(query))),
          )
          .sort((a, b) => b.usageCount - a.usageCount)
          .slice(0, SUGGESTION_LIMIT)
          .map((tag) => ({ slug: tag.slug, usageCount: tag.usageCount }));
  const canCreate = slug !== null && !value.includes(slug) && !tags.some((tag) => tag.slug === slug);
  const options = canCreate ? [...matches, { slug, usageCount: null }] : matches;
  const open = focused && !dismissed && !full && options.length > 0;
  const current = Math.min(active, options.length - 1);

  const add = (tag: string) => {
    if (!full && !value.includes(tag)) onValueChange([...value, tag]);
    setText('');
    setActive(0);
  };
  const frequent = tags
    .filter((tag) => !value.includes(tag.slug) && tag.usageCount > 0)
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, FREQUENT_LIMIT);

  return (
    <div className="flex flex-col gap-2">
      <Popover
        open={open}
        // The list opens from typing, never from Radix: it only asks to close (Escape, a click outside).
        onOpenChange={() => {
          setDismissed(true);
        }}
      >
        <PopoverAnchor asChild>
          <div
            ref={anchor}
            className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-[9px] border border-border-input bg-input px-3 py-1.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring"
          >
            <Tag aria-hidden="true" className="size-3.5 shrink-0 text-muted-fg" />
            {value.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-[5px] border border-border bg-surface-3 py-0.5 pr-1 pl-1.5 font-mono text-[12px] text-fg"
              >
                <span aria-hidden="true" className="text-subtle">
                  #
                </span>
                {tag}
                <button
                  type="button"
                  aria-label={m.tag_input_remove({ tag })}
                  onClick={() => {
                    onValueChange(value.filter((other) => other !== tag));
                  }}
                  className="rounded-[3px] text-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              </span>
            ))}
            <input
              {...(id === undefined ? {} : { id })}
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-describedby={describedBy}
              aria-activedescendant={open ? `${listId}-${current}` : undefined}
              autoComplete="off"
              disabled={full}
              placeholder={full ? m.tag_input_full() : m.tag_input_placeholder()}
              value={text}
              onChange={(event) => {
                setText(event.currentTarget.value);
                setActive(0);
                setDismissed(false);
              }}
              onFocus={() => {
                setFocused(true);
              }}
              onBlur={() => {
                setFocused(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  if (!open) return;
                  event.preventDefault();
                  const step = event.key === 'ArrowDown' ? 1 : options.length - 1;
                  setActive((current + step) % options.length);
                } else if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
                  const option = open ? options[current] : undefined;
                  const tag = option?.slug ?? slug;
                  if (tag === null) return;
                  event.preventDefault();
                  add(tag);
                } else if (event.key === 'Backspace' && text === '' && value.length > 0) {
                  onValueChange(value.slice(0, -1));
                }
              }}
              className="h-7 min-w-[96px] flex-1 bg-transparent text-[13.5px] text-fg outline-none placeholder:text-subtle disabled:text-text-disabled"
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-1.5"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (event.target instanceof Node && anchor.current?.contains(event.target)) event.preventDefault();
          }}
        >
          {matches.length === 0 ? null : (
            <p className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-subtle uppercase">{m.tag_input_existing()}</p>
          )}
          <ul id={listId} role="listbox" aria-label={m.tag_input_suggestions()} className="flex flex-col">
            {options.map((option, index) => (
              <li
                key={option.slug}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === current}
                onPointerDown={(event) => {
                  // Keep focus in the field.
                  event.preventDefault();
                }}
                onClick={() => {
                  add(option.slug);
                }}
                className="flex min-h-8 cursor-default items-center gap-2 rounded-[6px] px-2 text-[13px] text-text-secondary aria-selected:bg-surface-4 aria-selected:text-fg"
              >
                {option.usageCount === null ? (
                  <>
                    <Plus aria-hidden="true" className="size-3.5 text-muted-fg" />
                    <span className="flex-1">{m.tag_input_create({ tag: option.slug })}</span>
                  </>
                ) : (
                  <>
                    <span className="flex-1 font-mono">#{option.slug}</span>
                    <span className="text-[11.5px] text-subtle">{m.tag_input_used({ count: option.usageCount })}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1 border-t border-border px-2 pt-1.5 text-right font-mono text-[11px] text-subtle">
            {m.tag_input_count({ count: value.length, max: MAX_TAGS_PER_TRANSACTION })}
          </p>
        </PopoverContent>
      </Popover>
      {frequent.length === 0 || full ? null : (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-fg">
          {m.tag_input_frequent()}
          {frequent.map((tag) => (
            <button
              key={tag.id}
              type="button"
              aria-label={m.tag_input_add({ tag: tag.slug })}
              onClick={() => {
                add(tag.slug);
              }}
              className="rounded-[5px] border border-border px-1.5 py-px font-mono text-[11.5px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
            >
              + {tag.slug}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
