// SPDX-License-Identifier: AGPL-3.0-only

export type Platform = 'mac' | 'other';

/** `mod` is ⌘ on macOS/iPadOS and Ctrl elsewhere; any other key renders as written (`K`, `.`, `/`). */
export type KbdKey = 'mod' | 'shift' | 'alt' | 'enter' | (string & {});

const GLYPHS: Readonly<Record<Platform, Readonly<Record<string, string>>>> = {
  mac: { mod: '⌘', shift: '⇧', alt: '⌥', enter: '↵' },
  other: { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', enter: 'Enter' },
};

export interface KbdHintProps {
  keys: readonly KbdKey[];
  /** Decided by the caller (user agent or preference), so server and client render the same markup. */
  platform: Platform;
  className?: string;
}

/** A keyboard shortcut hint such as `⌘K` or `Ctrl K`, as nested `<kbd>` elements (HTML key combination). */
export function KbdHint({ keys, platform, className = '' }: KbdHintProps) {
  return (
    <kbd className={`inline-flex items-center gap-0.5 font-sans ${className}`}>
      {keys.map((key, index) => (
        <kbd
          // Keys may repeat (`G G`), and the list never reorders.
          key={index}
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-border-strong bg-surface-3 px-1 text-[11px] leading-none text-muted-fg"
        >
          {GLYPHS[platform][key] ?? key}
        </kbd>
      ))}
    </kbd>
  );
}
