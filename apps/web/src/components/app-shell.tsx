// SPDX-License-Identifier: AGPL-3.0-only
import { useNavigate } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { useMemo, type ReactNode } from 'react';
import { NAV_GROUPS } from './nav.ts';
import { Rail } from './rail.tsx';
import { useShortcuts, type ShortcutBinding } from './shortcuts.tsx';
import { Sidebar } from './sidebar.tsx';
import { UnsupportedScreen } from './unsupported-screen.tsx';

/**
 * The signed-in app layout (plan §7 "Responsive layout"): full sidebar from 1280 px, the 64 px rail from
 * 768 px, and the unsupported-screen page below that. Breakpoints are pure CSS, so the server renders the
 * right layout without knowing the viewport.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const navShortcuts = useMemo(
    () =>
      NAV_GROUPS.flatMap((group) => group.items).map((item): ShortcutBinding => ({
        keys: item.shortcut,
        run: () => {
          void navigate({ to: item.to });
        },
      })),
    [navigate],
  );
  useShortcuts(navShortcuts);

  return (
    <>
      <a
        href="#main"
        className="sr-only rounded-[6px] bg-fg px-3 py-2 text-[13px] text-primary-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        {m.skip_to_content()}
      </a>
      <UnsupportedScreen />
      <div className="hidden min-h-dvh md:flex">
        <Sidebar />
        <Rail />
        <main id="main" className="flex min-w-0 flex-1 flex-col gap-4 px-8 pt-6 pb-10">
          {children}
        </main>
      </div>
    </>
  );
}
