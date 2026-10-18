// SPDX-License-Identifier: AGPL-3.0-only
import { m } from '@wf/i18n/messages';
import { KbdHint, type KbdKey } from '@wf/ui/kbd-hint';
import { ChevronRight, Eye } from 'lucide-react';
import { useMemo } from 'react';
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
}

/** Page header (design `yGvLv`): breadcrumb and title, plus "Intip saldo" while amounts are hidden. */
export function PageHeader({ breadcrumb, title }: PageHeaderProps) {
  const { preferences } = usePreferences();
  return (
    <header className="flex items-end gap-3 pb-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
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
      </div>
      {preferences.balancesHidden ? <PeekButton /> : null}
    </header>
  );
}
