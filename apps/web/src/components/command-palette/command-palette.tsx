// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The ⌘K command palette (PRD FR-S4), mounted once in the `_app` layout. It works without AI: quick actions,
 * "Baru dibuka", the pages of the navigation with their `G` shortcuts, and grouped search results (debounced
 * `searchEverything`). When nothing matches it offers to create what was typed.
 *
 * Pages add their own actions with {@link useCommandActions} while they are mounted; new result groups come from
 * `lib/search.ts` + `result-groups.tsx`. M7 adds the "Tanya Asisten (Tab)" row here, next to the creation actions.
 */
import { m } from '@wf/i18n/messages';
import { CommandDialog } from '@wf/ui/command';
import type { KbdKey } from '@wf/ui/kbd-hint';
import type { LucideIcon } from 'lucide-react';
import { createContext, lazy, Suspense, use, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useShortcuts, type ShortcutBinding } from '../shortcuts.tsx';

/** A command of "Aksi cepat"; while typing, it is listed when its label or keywords match. */
export interface CommandAction {
  /** Unique among all registered actions. */
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Its own shortcut, shown at the end of the row. */
  readonly shortcut?: readonly KbdKey[];
  readonly keywords?: readonly string[];
  readonly run: () => void;
}

/** Offered under "Coba" when a query matches nothing, e.g. "Catat “kopi” sebagai transaksi". */
export interface CreateAction {
  readonly id: string;
  readonly icon: LucideIcon;
  readonly label: (query: string) => string;
  readonly run: (query: string) => void;
}

export interface CommandActions {
  readonly quick?: readonly CommandAction[];
  readonly create?: readonly CreateAction[];
}

interface PaletteContextValue {
  readonly open: () => void;
  readonly register: (actions: CommandActions) => () => void;
}

/** Thrown when the palette hooks are used outside `<CommandPaletteProvider>`. */
export class MissingCommandPaletteProviderError extends Error {
  override name = 'MissingCommandPaletteProviderError';
}

const PaletteContext = createContext<PaletteContextValue | null>(null);

const TOGGLE_KEYS: readonly KbdKey[] = ['mod', 'K'];
// Loaded on first open: it calls server functions, which the shell does not need until then.
const Palette = lazy(() => import('./palette.tsx').then((module) => ({ default: module.Palette })));

function usePaletteContext(): PaletteContextValue {
  const value = use(PaletteContext);
  if (value === null) throw new MissingCommandPaletteProviderError('needs a <CommandPaletteProvider> above it');
  return value;
}

/** Opens the palette (the sidebar's "Cari…" field, the rail's search button). */
export function useCommandPalette(): { readonly open: () => void } {
  return { open: usePaletteContext().open };
}

/** Adds `actions` to the palette while the calling component is mounted. Pass a stable (memoized) object. */
export function useCommandActions(actions: CommandActions): void {
  const { register } = usePaletteContext();
  useEffect(() => register(actions), [register, actions]);
}

/** Provides the palette hooks, binds ⌘K / Ctrl+K, and mounts the dialog. */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [registered, setRegistered] = useState<readonly CommandActions[]>([]);
  const value = useMemo<PaletteContextValue>(
    () => ({
      open: () => {
        setOpen(true);
      },
      register: (actions) => {
        setRegistered((current) => [...current, actions]);
        return () => {
          setRegistered((current) => current.filter((entry) => entry !== actions));
        };
      },
    }),
    [],
  );
  const shortcuts = useMemo<readonly ShortcutBinding[]>(
    () => [
      {
        keys: TOGGLE_KEYS,
        run: () => {
          setOpen((current) => !current);
        },
      },
    ],
    [],
  );
  useShortcuts(shortcuts);

  return (
    <PaletteContext value={value}>
      {children}
      <CommandDialog open={open} onOpenChange={setOpen} label={m.cmdk_dialog_label()} shouldFilter={false} loop>
        <Suspense>
          <Palette
            registered={registered}
            close={() => {
              setOpen(false);
            }}
          />
        </Suspense>
      </CommandDialog>
    </PaletteContext>
  );
}
