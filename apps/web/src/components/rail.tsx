// SPDX-License-Identifier: AGPL-3.0-only
import { Link, useRouteContext } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { KbdHint } from '@wf/ui/kbd-hint';
import { Tooltip } from '@wf/ui/tooltip';
import { Search, Sparkles } from 'lucide-react';
import { ASSISTANT_HINT, useAssistant } from './assistant/assistant.tsx';
import { useCommandPalette } from './command-palette/command-palette.tsx';
import { LogoTile } from './logo-mark.tsx';
import { NAV_GROUPS } from './nav.ts';
import { NotificationBell } from './notifications/notification-bell.tsx';
import { usePreferences } from './preferences.tsx';
import { useNavCounts } from './sidebar.tsx';
import { UserMenu } from './user-menu.tsx';

/**
 * Tablet icon rail (768–1279 px, design Section 19 `F5zMBH`/`aMmPV`): 64 px, 40 px touch targets (FR-TB4),
 * the same navigation as the sidebar, the ⌘K search button, and the bell and the user menu at the bottom. Entries
 * have no visible text, so each one gets a tooltip with its name (FR-TB1).
 */
export function Rail() {
  // The signed-in user, from the `_app` route context (absent outside it).
  const { viewer } = useRouteContext({ strict: false });
  const palette = useCommandPalette();
  const { platform } = usePreferences().preferences;
  const counts = useNavCounts();
  const assistant = useAssistant();
  return (
    <aside className="sticky top-0 hidden h-dvh w-16 shrink-0 flex-col items-center gap-1 border-r border-border py-3.5 md:flex xl:hidden">
      <LogoTile variant="rail" />
      <div aria-hidden="true" className="my-2 h-px w-7 bg-border" />
      <Tooltip content={m.cmdk_open_label()} hint={<KbdHint keys={['mod', 'K']} platform={platform} />} side="right">
        <button
          type="button"
          onClick={palette.open}
          aria-label={m.cmdk_open_label()}
          aria-keyshortcuts={platform === 'mac' ? 'Meta+K' : 'Control+K'}
          className="flex size-10 items-center justify-center rounded-[9px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Search aria-hidden="true" className="size-[17px]" />
        </button>
      </Tooltip>
      <nav aria-label={m.nav_main_label()}>
        <ul className="flex flex-col items-center gap-1">
          {NAV_GROUPS.flatMap((group) => group.items).map((item) => (
            <li key={item.to}>
              <Tooltip content={item.label()} side="right">
                <Link
                  to={item.to}
                  aria-label={item.label()}
                  activeOptions={{ exact: true, includeSearch: false }}
                  className="flex size-10 items-center justify-center rounded-[9px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring data-[status=active]:bg-muted data-[status=active]:text-fg"
                >
                  <item.railIcon aria-hidden="true" className="size-[17px]" />
                </Link>
              </Tooltip>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-auto flex flex-col items-center gap-1">
        {viewer === undefined ? null : (
          <NotificationBell variant="rail" unread={counts?.notifications ?? null} timeZone={viewer.timezone} />
        )}
        <Tooltip content={m.assistant_open()} hint={<KbdHint keys={ASSISTANT_HINT} platform={platform} />} side="right">
          <button
            type="button"
            onClick={assistant.open}
            aria-label={m.assistant_open()}
            aria-keyshortcuts={platform === 'mac' ? 'Meta+J' : 'Control+J'}
            className="flex size-10 items-center justify-center rounded-[9px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Sparkles aria-hidden="true" className="size-[17px]" />
          </button>
        </Tooltip>
        <UserMenu variant="rail" viewer={viewer} />
      </div>
    </aside>
  );
}
