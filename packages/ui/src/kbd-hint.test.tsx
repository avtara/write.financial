// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { KbdHint, type KbdHintProps } from './kbd-hint.tsx';

async function keys(props: KbdHintProps) {
  const screen = await render(<KbdHint {...props} />);
  const outer = screen.container.firstElementChild as HTMLElement;
  return { outer, keys: [...outer.querySelectorAll('kbd')].map((key) => key.textContent) };
}

describe('KbdHint', () => {
  it('renders modifiers as macOS glyphs', async () => {
    const { outer, keys: rendered } = await keys({ keys: ['mod', 'shift', 'alt', 'enter', 'K'], platform: 'mac' });
    expect(outer.tagName).toBe('KBD');
    expect(rendered).toEqual(['⌘', '⇧', '⌥', '↵', 'K']);
  });

  it('renders modifiers as key names on other platforms', async () => {
    const { keys: rendered } = await keys({ keys: ['mod', 'shift', 'alt', 'enter', '.'], platform: 'other' });
    expect(rendered).toEqual(['Ctrl', 'Shift', 'Alt', 'Enter', '.']);
  });

  it('keeps repeated keys and accepts extra classes', async () => {
    const { outer, keys: rendered } = await keys({ keys: ['G', 'G'], platform: 'mac', className: 'ml-auto' });
    expect(rendered).toEqual(['G', 'G']);
    expect(outer.classList).toContain('ml-auto');
  });
});
