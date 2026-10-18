// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { Tooltip } from 'radix-ui';
import type { ReactElement } from 'react';
import { LogoTile } from './logo-mark.tsx';
import { NAV_GROUPS } from './nav.ts';
import { UserMenu } from './user-menu.tsx';

/** Rail entries have no visible text, so every one gets a tooltip with its name (FR-TB1). */
function RailTooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={10}
          className="z-50 rounded-[8px] border border-border-strong bg-popover px-2.5 py-1.5 text-[12px] text-fg shadow-[0_12px_32px_var(--shadow)]"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/**
 * Tablet icon rail (768–1279 px, design Section 19 `F5zMBH`/`aMmPV`): 64 px, 40 px touch targets (FR-TB4),
 * the same navigation as the sidebar, and the user menu at the bottom.
 */
export function Rail() {
  return (
    <Tooltip.Provider delayDuration={300}>
      <aside className="sticky top-0 hidden h-dvh w-16 shrink-0 flex-col items-center gap-1 border-r border-border py-3.5 md:flex xl:hidden">
        <LogoTile variant="rail" />
        <div aria-hidden="true" className="my-2 h-px w-7 bg-border" />
        <nav aria-label={m.nav_main_label()}>
          <ul className="flex flex-col items-center gap-1">
            {NAV_GROUPS.flatMap((group) => group.items).map((item) => (
              <li key={item.to}>
                <RailTooltip label={item.label()}>
                  <Link
                    to={item.to}
                    aria-label={item.label()}
                    activeOptions={{ exact: true }}
                    className="flex size-10 items-center justify-center rounded-[9px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring data-[status=active]:bg-muted data-[status=active]:text-fg"
                  >
                    <item.railIcon aria-hidden="true" className="size-[17px]" />
                  </Link>
                </RailTooltip>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-auto">
          <UserMenu variant="rail" />
        </div>
      </aside>
    </Tooltip.Provider>
  );
}
