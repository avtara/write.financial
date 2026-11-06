// SPDX-License-Identifier: AGPL-3.0-only
/** Editable title with bounded suggestions from the user's own recorded transactions. */
import { m } from '@wf/i18n/messages';
import { Popover, PopoverAnchor, PopoverContent } from '@wf/ui/popover';
import { usePrivacy } from '@wf/ui/privacy';
import { History } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { TextInput } from '../form.tsx';
import type { EntryKind } from './transaction-draft.ts';

interface TransactionTitleInputProps {
  readonly id?: string;
  readonly 'aria-describedby'?: string | undefined;
  readonly value: string;
  readonly kind: EntryKind;
  readonly onValueChange: (value: string) => void;
}

function titlesFromResponse(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || !('titles' in value) || !Array.isArray(value.titles)) return [];
  return value.titles
    .filter((title: unknown): title is string => typeof title === 'string' && title.length > 0 && title.length <= 200)
    .slice(0, 8);
}

export function TransactionTitleInput({
  id,
  'aria-describedby': describedBy,
  value,
  kind,
  onValueChange,
}: TransactionTitleInputProps) {
  const listId = useId();
  const hintId = `${listId}-hint`;
  const anchor = useRef<HTMLDivElement>(null);
  const { hidden } = usePrivacy();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activeTitle, setActiveTitle] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ key: string; titles: string[] } | null>(null);
  const query = value.trim();
  const requestKey = JSON.stringify([kind, query]);
  const shouldFetch = focused && !dismissed && !hidden && query.length >= 2;
  const titles = answer?.key === requestKey && !hidden ? answer.titles.filter((title) => title !== value) : [];
  const expanded = shouldFetch && titles.length > 0;
  const active = titles.findIndex((title) => title === activeTitle);

  useEffect(() => {
    if (!shouldFetch) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({ query, type: kind });
          const response = await fetch(`/api/transactions/titles?${params.toString()}`, {
            credentials: 'same-origin',
            cache: 'no-store',
            signal: controller.signal,
          });
          const titles = response.ok ? titlesFromResponse(await response.json()) : [];
          if (!cancelled) setAnswer({ key: requestKey, titles });
        } catch {
          // Autocomplete is optional: manual entry still works when the request fails.
          if (!cancelled) setAnswer({ key: requestKey, titles: [] });
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [shouldFetch, query, kind, requestKey]);

  const close = () => {
    setDismissed(true);
    setActiveTitle(null);
  };
  const choose = (title: string) => {
    onValueChange(title);
    close();
  };

  return (
    <Popover
      open={expanded}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <PopoverAnchor asChild>
        <div ref={anchor}>
          <TextInput
            id={id}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={expanded ? listId : undefined}
            aria-activedescendant={expanded && active >= 0 ? `${listId}-${String(active)}` : undefined}
            aria-describedby={[describedBy, hintId].filter(Boolean).join(' ')}
            autoComplete="off"
            maxLength={200}
            value={value}
            placeholder={m.record_description_placeholder()}
            onFocus={() => {
              setFocused(true);
              setDismissed(false);
            }}
            onBlur={() => {
              setFocused(false);
              close();
            }}
            onChange={(event) => {
              onValueChange(event.currentTarget.value);
              setActiveTitle(null);
              setDismissed(false);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
                return;
              if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && titles.length > 0) {
                event.preventDefault();
                setDismissed(false);
                const next =
                  event.key === 'ArrowDown'
                    ? (active + 1) % titles.length
                    : active <= 0
                      ? titles.length - 1
                      : active - 1;
                setActiveTitle(titles[next] ?? null);
              } else if (event.key === 'Enter' && expanded && active >= 0) {
                const title = titles[active];
                if (title === undefined) return;
                event.preventDefault();
                event.stopPropagation();
                choose(title);
              } else if (event.key === 'Escape' && expanded) {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }}
          />
        </div>
      </PopoverAnchor>
      <span id={hintId} className="sr-only">
        {m.record_title_autocomplete_hint()}
      </span>
      {expanded ? (
        <PopoverContent
          role="presentation"
          className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-16px)] p-0"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (event.target instanceof Node && anchor.current?.contains(event.target)) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
        >
          <p className="px-3 pt-2.5 pb-1 text-[11px] font-medium text-subtle uppercase">
            {m.record_title_suggestions()}
          </p>
          <ul
            id={listId}
            role="listbox"
            aria-label={m.record_title_suggestions()}
            className="max-h-[280px] overflow-y-auto overscroll-contain p-1.5"
            ref={(node) => {
              node?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
            }}
          >
            {titles.map((title, index) => (
              <li
                key={title}
                id={`${listId}-${String(index)}`}
                role="option"
                aria-selected={index === active}
                className="flex min-h-9 cursor-default items-center gap-2 rounded-[6px] px-2 py-1.5 text-[13px] text-text-secondary aria-selected:bg-surface-4 aria-selected:text-fg"
                onPointerDown={(event) => {
                  event.preventDefault();
                }}
                onPointerMove={() => {
                  setActiveTitle(title);
                }}
                onClick={() => {
                  choose(title);
                }}
              >
                <History aria-hidden="true" className="size-3.5 shrink-0 text-subtle" />
                <span className="min-w-0 truncate">{title}</span>
              </li>
            ))}
          </ul>
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
