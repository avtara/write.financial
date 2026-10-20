// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The table's search field (FR-L2 `/`, design `p22to9`): "Cari merchant, catatan, atau #tag". `/` focuses it from
 * anywhere on the page; typing updates `?q=` after a short pause; Escape clears it (and leaves it when already
 * empty). While a search is applied it shows "4 hasil" and a clear button.
 */
import { m } from '@wf/i18n/messages';
import { KbdHint } from '@wf/ui/kbd-hint';
import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePreferences } from '../preferences.tsx';
import { useShortcuts } from '../shortcuts.tsx';

/** Pause after the last keystroke before the search runs. */
export const SEARCH_DEBOUNCE_MS = 300;

export interface TableSearchProps {
  /** The applied search (`?q=`). */
  readonly value: string | undefined;
  /** Matching transactions, shown while a search is applied. */
  readonly hits: number;
  readonly onChange: (query: string | undefined) => void;
}

export function TableSearch({ value, hits, onChange }: TableSearchProps) {
  const { preferences } = usePreferences();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value ?? '');
  // The last query this field sent: when the URL catches up with it, the text being typed stays.
  const [sent, setSent] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== sent) {
      setSent(value);
      setText(value ?? '');
    }
  }
  const query = text.trim() === '' ? undefined : text.trim();
  useEffect(() => {
    if (query === sent) return;
    const timer = setTimeout(() => {
      setSent(query);
      onChange(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query, sent, onChange]);
  const clear = () => {
    setText('');
    setSent(undefined);
    onChange(undefined);
  };
  useShortcuts(
    useMemo(
      () => [
        {
          keys: ['/'],
          run: () => {
            input.current?.focus();
          },
        },
      ],
      [],
    ),
  );
  return (
    <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[8px] border border-border-input bg-input px-2.5 has-focus-visible:border-border-strong has-focus-visible:outline-2 has-focus-visible:outline-ring">
      <Search aria-hidden="true" className="size-3.5 shrink-0 text-subtle" />
      <input
        ref={input}
        type="search"
        aria-label={m.transactions_search_label()}
        placeholder={m.transactions_search_placeholder()}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          // Handled here, so the selection bar keeps its selection.
          event.preventDefault();
          if (text === '') input.current?.blur();
          else clear();
        }}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-subtle [&::-webkit-search-cancel-button]:hidden"
      />
      {value === undefined ? (
        <KbdHint keys={['/']} platform={preferences.platform} />
      ) : (
        <>
          <span className="shrink-0 text-[11.5px] text-subtle">{m.transactions_search_hits({ count: hits })}</span>
          <button
            type="button"
            aria-label={m.transactions_search_clear()}
            onClick={() => {
              clear();
              input.current?.focus();
            }}
            className="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-subtle hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </>
      )}
    </div>
  );
}
