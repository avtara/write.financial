// SPDX-License-Identifier: AGPL-3.0-only
import { Link, useMatch, useRouteContext } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { KbdHint } from '@wf/ui/kbd-hint';
import { Search, Sparkles } from 'lucide-react';
import { ASSISTANT_HINT, useAssistant } from './assistant/assistant.tsx';
import { useCommandPalette } from './command-palette/command-palette.tsx';
import { LogoTile } from './logo-mark.tsx';
import { NAV_GROUPS, type NavCounts } from './nav.ts';
import { NotificationBell } from './notifications/notification-bell.tsx';
import { usePreferences } from './preferences.tsx';
import { UserMenu } from './user-menu.tsx';

/** Product wordmark: Geist 600, "write" in `$fg` and ".financial" in `$muted-fg` (design Section 20). */
function Wordmark() {
  const name = m.app_name();
  const dot = name.indexOf('.');
  return (
    <span className="text-[15px] font-semibold tracking-[-0.01em] text-fg">
      {name.slice(0, dot)}
      <span className="text-muted-fg">{name.slice(dot)}</span>
    </span>
  );
}

/** The nav badge counts of the `_app` loader (`null` outside `_app` or when they failed to load). */
export function useNavCounts(): NavCounts | null {
  return useMatch({ from: '/_app', shouldThrow: false })?.loaderData?.navCounts ?? null;
}

/**
 * Desktop sidebar (≥ 1280 px, design `qjLGK`): 248 px, brand with the notification bell, the ⌘K search field,
 * navigation groups, user menu at the bottom.
 */
export function Sidebar() {
  // The signed-in user, from the `_app` route context (absent outside it).
  const { viewer } = useRouteContext({ strict: false });
  const palette = useCommandPalette();
  const { platform } = usePreferences().preferences;
  const counts = useNavCounts();
  const assistant = useAssistant();
  return (
    <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col gap-6 border-r border-border px-4 py-5 xl:flex">
      <div className="flex items-center gap-2.5 px-2">
        <LogoTile variant="sidebar" />
        <Wordmark />
        {viewer === undefined ? null : (
          <span className="ml-auto">
            <NotificationBell variant="sidebar" unread={counts?.notifications ?? null} timeZone={viewer.timezone} />
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={palette.open}
        aria-keyshortcuts={platform === 'mac' ? 'Meta+K' : 'Control+K'}
        className="-mt-2 flex h-[34px] items-center gap-2 rounded-[7px] border border-border bg-input px-2.5 text-[13px] text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Search aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="flex-1 text-left">{m.cmdk_open()}</span>
        <KbdHint keys={['mod', 'K']} platform={platform} />
      </button>
      <nav aria-label={m.nav_main_label()} className="flex flex-col gap-4">
        {NAV_GROUPS.map((group) => (
          <section key={group.label()} className="flex flex-col gap-0.5">
            <h2 className="px-2.5 pb-1 text-[11px] font-medium text-subtle uppercase">{group.label()}</h2>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    activeOptions={{ exact: true, includeSearch: false }}
                    className="flex h-[34px] items-center gap-2.5 rounded-[6px] px-2.5 text-[13.5px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring data-[status=active]:bg-muted data-[status=active]:font-medium data-[status=active]:text-fg"
                  >
                    <item.icon aria-hidden="true" className="size-4 shrink-0" />
                    {item.label()}
                    {/* A zero is left out: the count only shows when there is something there. */}
                    {item.badge === undefined || counts === null || counts[item.badge] === 0 ? null : (
                      <span className="ml-auto rounded-[4px] px-1.5 font-mono text-[11px] font-normal text-subtle in-data-[status=active]:text-muted-fg">
                        {counts[item.badge]}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-2">
        <button
          type="button"
          onClick={assistant.open}
          aria-keyshortcuts={platform === 'mac' ? 'Meta+J' : 'Control+J'}
          className="flex h-[34px] items-center gap-2.5 rounded-[6px] px-2.5 text-[13.5px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Sparkles aria-hidden="true" className="size-4 shrink-0" />
          <span className="flex-1 text-left">{m.assistant_open()}</span>
          <KbdHint keys={ASSISTANT_HINT} platform={platform} />
        </button>
        <UserMenu variant="sidebar" viewer={viewer} />
      </div>
    </aside>
  );
}
