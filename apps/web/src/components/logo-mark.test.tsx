// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import '../styles.css';
import { LogoMark, LogoTile } from './logo-mark.tsx';

describe('LogoMark', () => {
  it('draws the three-part mark at the requested size, hidden from assistive technology', async () => {
    const screen = await render(<LogoMark size={18} />);
    const svg = screen.container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('width')).toBe('18');
    expect(svg?.getBoundingClientRect().width).toBe(18);
    expect(svg?.querySelectorAll('path')).toHaveLength(3);
  });
});

describe('LogoTile', () => {
  it.each([
    ['sidebar', 28, '16'],
    ['rail', 40, '18'],
  ] as const)('sizes the %s tile to %i px around a %s px mark', async (variant, tile, mark) => {
    const screen = await render(<LogoTile variant={variant} />);
    const span = screen.container.firstElementChild as HTMLElement;
    expect(span.getBoundingClientRect().width).toBe(tile);
    expect(span.getBoundingClientRect().height).toBe(tile);
    expect(span.querySelector('svg')?.getAttribute('width')).toBe(mark);
    expect(span.getAttribute('style')).toBeNull();
  });
});
