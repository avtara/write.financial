// SPDX-License-Identifier: AGPL-3.0-only
import { m } from '@wf/i18n/messages';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@wf/ui/dropdown-menu';
import { KbdHint, type KbdKey } from '@wf/ui/kbd-hint';
import { ChevronRight, Ellipsis, Eye, type LucideIcon } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { usePreferences } from './preferences.tsx';
import { useShortcuts } from './shortcuts.tsx';

const PEEK_KEYS: readonly KbdKey[] = ['mod', '.'];

/**
 * "Intip saldo" (FR-S3, design `L44CMl`/`uZheE`): shown while privacy mode hides amounts. The button or
 * `⌘ .` reveals them for five seconds with a countdown; pressing again hides them right away.
 */
export function PeekButton() {
  const { preferences, peekSecondsLeft, togglePeek } = usePreferences();
  useShortcuts(useMemo(() => [{ keys: PEEK_KEYS, run: togglePeek }], [togglePeek]));
  return (
    <button
      type="button"
      aria-pressed={peekSecondsLeft !== null}
      onClick={togglePeek}
      className="inline-flex h-[33px] shrink-0 items-center gap-1.5 rounded-[8px] border border-border px-2.5 text-[13px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
    >
      <Eye aria-hidden="true" className="size-3.5 text-muted-fg" />
      {peekSecondsLeft === null ? m.privacy_peek() : m.privacy_peek_showing({ seconds: peekSecondsLeft })}
      <KbdHint keys={PEEK_KEYS} platform={preferences.platform} />
    </button>
  );
}

export interface PageHeaderProps {
  /** Location of the page, outermost first; the last entry is the current page. */
  breadcrumb: readonly string[];
  title: string;
  /** Under the title ("11 rekening · 6 untuk belanja, 5 platform investasi"). */
  description?: ReactNode;
  /** Page actions on the right ("Sesuaikan saldo", "Tambah rekening"). */
  actions?: ReactNode;
  /**
   * Secondary actions ("Impor mutasi"): buttons from 1024 px, folded into a ⋯ menu below that (FR-TB3), placed before
   * `actions` so the primary action stays last.
   */
  secondaryActions?: readonly HeaderAction[];
}

export interface HeaderAction {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly onSelect: () => void;
}

/**
 * Page header (design `yGvLv`): breadcrumb and title, plus "Intip saldo" while amounts are hidden. The title keeps
 * at least 20rem; when the actions don't fit beside it they wrap below it together, ⋯ included.
 */
export function PageHeader({ breadcrumb, title, description, actions, secondaryActions = [] }: PageHeaderProps) {
  const { preferences } = usePreferences();
  return (
    <header className="flex flex-wrap items-end gap-3 pb-2">
      <div className="flex min-w-0 flex-1 basis-[20rem] flex-col gap-1">
        <nav aria-label={m.breadcrumb_label()}>
          <ol className="flex items-center gap-1.5 text-[12.5px] text-subtle">
            {breadcrumb.map((crumb, index) => (
              <li
                key={crumb}
                aria-current={index === breadcrumb.length - 1 ? 'page' : undefined}
                className="flex items-center gap-1.5 aria-[current=page]:text-muted-fg"
              >
                {index > 0 ? <ChevronRight aria-hidden="true" className="size-3 text-subtle" /> : null}
                {crumb}
              </li>
            ))}
          </ol>
        </nav>
        <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.01em] text-fg">{title}</h1>
        {description === undefined ? null : <p className="text-[13px] text-muted-fg">{description}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3 empty:hidden">
        {preferences.balancesHidden ? <PeekButton /> : null}
        {secondaryActions.length === 0 ? null : (
          <>
            {secondaryActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onSelect}
                className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-border px-3 text-[13px] text-fg hover:bg-tint-06 focus-visible:outline-2 focus-visible:outline-ring max-lg:hidden"
              >
                <action.icon aria-hidden="true" className="size-3.5 text-muted-fg" />
                {action.label}
              </button>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={m.page_header_more()}
                className="inline-flex size-8 items-center justify-center rounded-[6px] border border-border text-muted-fg hover:bg-tint-06 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-muted lg:hidden"
              >
                <Ellipsis aria-hidden="true" className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[220px]">
                <DropdownMenuGroup>
                  {secondaryActions.map((action) => (
                    <DropdownMenuItem key={action.label} icon={action.icon} onSelect={action.onSelect}>
                      {action.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        {actions}
      </div>
    </header>
  );
}
