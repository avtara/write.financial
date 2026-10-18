// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The single keyboard shortcut registry (plan §7 "Keyboard"). One `keydown` listener serves every
 * shortcut, so bindings cannot fight over keys, and it keeps working with an external keyboard on a tablet
 * (FR-TB4). Bindings use the same key names as `<KbdHint>`:
 * - a chord contains a modifier and fires on its last key: `['mod', '.']` is ⌘. on Apple platforms, Ctrl+.
 *   elsewhere;
 * - otherwise the keys are a sequence typed within {@link SEQUENCE_TIMEOUT_MS}: `['G', 'R']`. Sequences are
 *   ignored while typing in a field.
 */
import type { KbdKey, Platform } from '@wf/ui/kbd-hint';
import { createContext, use, useEffect, useState, type ReactNode } from 'react';

export interface ShortcutBinding {
  readonly keys: readonly KbdKey[];
  readonly run: () => void;
}

/** Thrown when `useShortcuts` is used outside `<ShortcutProvider>`. */
export class MissingShortcutProviderError extends Error {
  override name = 'MissingShortcutProviderError';
}

/** Maximum pause between the keys of a sequence such as `G R`. */
export const SEQUENCE_TIMEOUT_MS = 1000;

const MODIFIERS: readonly KbdKey[] = ['mod', 'shift', 'alt'];

type Registry = Set<readonly ShortcutBinding[]>;

const ShortcutContext = createContext<Registry | null>(null);

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

function matchesChord(keys: readonly KbdKey[], event: KeyboardEvent, platform: Platform): boolean {
  const mod = platform === 'mac' ? event.metaKey : event.ctrlKey;
  return (
    mod === keys.includes('mod') &&
    event.shiftKey === keys.includes('shift') &&
    event.altKey === keys.includes('alt') &&
    keys.at(-1)?.toLowerCase() === event.key.toLowerCase()
  );
}

export function ShortcutProvider({ platform, children }: { platform: Platform; children: ReactNode }) {
  const [registry] = useState<Registry>(() => new Set());

  useEffect(() => {
    let typed: string[] = [];
    let lastKeyAt = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return;
      const bindings = [...registry].flat();
      const chord = bindings.find(
        ({ keys }) => keys.some((key) => MODIFIERS.includes(key)) && matchesChord(keys, event, platform),
      );
      if (chord) {
        event.preventDefault();
        chord.run();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) {
        typed = [];
        return;
      }
      if (event.timeStamp - lastKeyAt > SEQUENCE_TIMEOUT_MS) typed = [];
      lastKeyAt = event.timeStamp;
      typed.push(event.key.toLowerCase());
      // Compare against the tail of what was typed; indexes before the start read `undefined` and never match.
      const sequence = bindings.find(({ keys }) =>
        keys.every((key, index) => key.toLowerCase() === typed[typed.length - keys.length + index]),
      );
      if (sequence) {
        typed = [];
        event.preventDefault();
        sequence.run();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [registry, platform]);

  return <ShortcutContext value={registry}>{children}</ShortcutContext>;
}

/** Registers `bindings` while the calling component is mounted. Pass a stable (memoized) array. */
export function useShortcuts(bindings: readonly ShortcutBinding[]): void {
  const registry = use(ShortcutContext);
  if (registry === null) throw new MissingShortcutProviderError('useShortcuts() needs a <ShortcutProvider> above it');
  useEffect(() => {
    registry.add(bindings);
    return () => {
      registry.delete(bindings);
    };
  }, [registry, bindings]);
}
