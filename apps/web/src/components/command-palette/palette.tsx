// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The content of the ⌘K palette (FR-S4): the search field, quick actions, "Baru dibuka", pages, grouped results, and
 * the creation actions when nothing matches. Loaded on first open by `command-palette.tsx`, because it calls server
 * functions the shell does not need until then.
 */
import { useNavigate, type NavigateFn } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { CommandGroup, CommandInput, CommandItem, CommandList } from '@wf/ui/command';
import { KbdHint } from '@wf/ui/kbd-hint';
import { SearchX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  matchesQuery,
  SEARCH_KINDS,
  type HitEntry,
  type RecentEntry,
  type RecentTouch,
  type SearchResults,
} from '../../lib/search.ts';
import type { Result } from '../../server/access.ts';
import { listRecent, searchEverything, touchRecent } from '../../server/fn/search.ts';
import { NAV_GROUPS, type NavItem } from '../nav.ts';
import { usePreferences } from '../preferences.tsx';
import { settle } from '../setup/result.ts';
import type { CommandActions } from './command-palette.tsx';
import { RESULT_GROUPS, type ResultGroup, type ResultView } from './result-groups.tsx';

/** Pause after the last keystroke before searching. */
export const SEARCH_DEBOUNCE_MS = 150;

/** A two-line row: the name, then where it belongs ("14 Okt · Belanja · BCA Tahapan"). */
function RowText({ title, detail }: Pick<ResultView, 'title' | 'detail'>) {
  return (
    <span className="flex min-w-0 flex-col gap-px">
      <span className="truncate text-fg">{title}</span>
      <span className="truncate text-[11.5px] text-subtle">{detail}</span>
    </span>
  );
}

function HitItem({
  entry,
  value,
  recent,
  onOpen,
}: {
  entry: HitEntry;
  value: string;
  recent: boolean;
  onOpen: (touch: RecentTouch, go: (navigate: NavigateFn) => Promise<void>) => void;
}) {
  const { locale } = usePreferences().preferences;
  // `kind` and `hit` belong together; TypeScript cannot correlate the indexed group with the union.
  const group = RESULT_GROUPS[entry.kind] as ResultGroup<HitEntry['hit']>;
  const view = group.view(entry.hit, locale);
  return (
    <CommandItem
      value={value}
      icon={group.icon}
      aside={view.aside}
      onSelect={() => {
        onOpen({ kind: group.recentKind, ref: entry.hit.id }, (navigate) => group.open(entry.hit, navigate));
      }}
    >
      <RowText title={view.title} detail={recent ? `${group.heading()} · ${view.detail}` : view.detail} />
    </CommandItem>
  );
}

const PAGES: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** The palette's content, loaded the first time the palette opens. */
export function Palette({ registered, close }: { registered: readonly CommandActions[]; close: () => void }) {
  const navigate = useNavigate();
  const { platform } = usePreferences().preferences;
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<readonly RecentEntry[]>([]);
  const [search, setSearch] = useState<{ query: string; outcome: Result<SearchResults> } | null>(null);
  const trimmed = query.trim();
  const field = useRef<HTMLInputElement>(null);

  // The first time, this content arrives after the dialog focused itself (it had no field yet): move to the field.
  // Later openings render it at once, and the dialog focuses the field (and remembers the opener) on its own.
  useEffect(() => {
    const input = field.current;
    if (input?.closest('[role="dialog"]') === document.activeElement) input.focus();
  }, []);

  useEffect(() => {
    let live = true;
    void settle(() => listRecent({ data: {} })).then((outcome) => {
      if (live && outcome.ok) setRecent(outcome.value);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (trimmed === '') return;
    let live = true;
    const timer = setTimeout(() => {
      void settle(() => searchEverything({ data: { query: trimmed } })).then((outcome) => {
        if (live) setSearch({ query: trimmed, outcome });
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [trimmed]);

  /** Closes, remembers what was opened for "Baru dibuka" (best effort), and goes there. */
  const openItem = (touch: RecentTouch, go: (to: NavigateFn) => Promise<void>) => {
    close();
    void settle(() => touchRecent({ data: touch }));
    void go(navigate);
  };

  const quick = registered
    .flatMap((entry) => entry.quick ?? [])
    .filter((action) => matchesQuery(trimmed, [action.label, ...(action.keywords ?? [])]));
  const create = registered.flatMap((entry) => entry.create ?? []);
  const pages = PAGES.filter((page) => matchesQuery(trimmed, [page.label()]));
  const searching = trimmed !== '';
  const pending = searching && search?.query !== trimmed;
  const outcome = searching ? search?.outcome : undefined;
  const results = outcome?.ok === true ? outcome.value : null;
  const found = results !== null && SEARCH_KINDS.some((kind) => results[kind].total > 0);
  const nothing = searching && !pending && results !== null && !found && quick.length === 0 && pages.length === 0;
  const status = pending
    ? m.cmdk_searching()
    : outcome?.ok === false
      ? m.cmdk_search_failed()
      : nothing
        ? m.cmdk_no_results_title({ query: trimmed })
        : '';

  return (
    <>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={m.cmdk_placeholder()}
        ref={field}
        className="text-[15px]"
        hint={<KbdHint keys={['Esc']} platform={platform} />}
      />
      <p role="status" className="sr-only">
        {status}
      </p>
      <CommandList label={m.cmdk_results_label()} aria-busy={pending} className="max-h-[min(460px,60vh)]">
        {quick.length === 0 ? null : (
          <CommandGroup heading={m.cmdk_group_actions()}>
            {quick.map((action) => (
              <CommandItem
                key={action.id}
                value={`action:${action.id}`}
                icon={action.icon}
                aside={
                  action.shortcut === undefined ? undefined : <KbdHint keys={action.shortcut} platform={platform} />
                }
                onSelect={() => {
                  close();
                  action.run();
                }}
              >
                {action.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {searching || recent.length === 0 ? null : (
          <CommandGroup heading={m.cmdk_group_recent()}>
            {recent.map((entry) => {
              if (entry.kind !== 'page') {
                return (
                  <HitItem
                    key={`${entry.kind}:${entry.hit.id}`}
                    entry={entry}
                    value={`recent:${entry.kind}:${entry.hit.id}`}
                    recent
                    onOpen={openItem}
                  />
                );
              }
              const page = PAGES.find((item) => item.to === entry.path);
              return page === undefined ? null : (
                <CommandItem
                  key={`page:${page.to}`}
                  value={`recent:page:${page.to}`}
                  icon={page.icon}
                  onSelect={() => {
                    openItem({ kind: 'page', ref: page.to }, (to) => to({ to: page.to }));
                  }}
                >
                  <RowText title={page.label()} detail={m.cmdk_group_pages()} />
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {pages.length === 0 ? null : (
          <CommandGroup heading={m.cmdk_group_pages()}>
            {pages.map((page) => (
              <CommandItem
                key={page.to}
                value={`page:${page.to}`}
                icon={page.icon}
                aside={page.shortcut === undefined ? undefined : <KbdHint keys={page.shortcut} platform={platform} />}
                onSelect={() => {
                  openItem({ kind: 'page', ref: page.to }, (to) => to({ to: page.to }));
                }}
              >
                {page.label()}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results === null
          ? null
          : SEARCH_KINDS.map((kind) => {
              const group = results[kind];
              if (group.total === 0) return null;
              const heading = RESULT_GROUPS[kind].heading();
              return (
                <CommandGroup key={kind} heading={group.total > 1 ? `${heading} · ${String(group.total)}` : heading}>
                  {group.hits.map((hit) => (
                    <HitItem
                      key={hit.id}
                      entry={{ kind, hit } as HitEntry}
                      value={`${kind}:${hit.id}`}
                      recent={false}
                      onOpen={openItem}
                    />
                  ))}
                </CommandGroup>
              );
            })}
        {outcome?.ok === false ? (
          <p className="px-3 py-6 text-center text-[12.5px] text-muted-fg">{m.cmdk_search_failed()}</p>
        ) : null}
        {nothing ? (
          <>
            <div className="flex flex-col items-center gap-1.5 px-3 pt-6 pb-4 text-center">
              <SearchX aria-hidden="true" className="mb-1 size-[18px] text-muted-fg" />
              <p className="text-[13px] font-medium text-fg">{m.cmdk_no_results_title({ query: trimmed })}</p>
              <p className="text-[11.5px] text-subtle">{m.cmdk_no_results_description()}</p>
            </div>
            {create.length === 0 ? null : (
              <CommandGroup heading={m.cmdk_group_try()}>
                {create.map((action) => (
                  <CommandItem
                    key={action.id}
                    value={`create:${action.id}`}
                    icon={action.icon}
                    onSelect={() => {
                      close();
                      action.run(trimmed);
                    }}
                  >
                    {action.label(trimmed)}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        ) : null}
      </CommandList>
      <div className="flex items-center gap-3.5 border-t border-border bg-surface-sunken px-3.5 py-[9px] text-[11.5px] text-subtle">
        <span className="flex items-center gap-1.5">
          <KbdHint keys={['↑↓']} platform={platform} />
          {m.cmdk_hint_select()}
        </span>
        <span className="flex items-center gap-1.5">
          <KbdHint keys={['enter']} platform={platform} />
          {m.cmdk_hint_open()}
        </span>
      </div>
    </>
  );
}
