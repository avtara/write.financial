// SPDX-License-Identifier: AGPL-3.0-only
import { BUILT_IN_CATEGORIES } from '@wf/domain/categories';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../test/render.tsx';
import { CATEGORY_ICONS, CategoryIcon } from './category-icon.tsx';

describe('CategoryIcon', () => {
  it('offers every built-in glyph in the picker set', () => {
    expect(BUILT_IN_CATEGORIES.filter((entry) => !(entry.icon in CATEGORY_ICONS))).toEqual([]);
  });

  it('tints the chip with a token, a hex color, or the neutral fallback', async () => {
    const { screen } = await renderApp(
      <div>
        <span data-testid="token">
          <CategoryIcon icon="utensils" color="orange" />
        </span>
        <span data-testid="hex">
          <CategoryIcon icon="graduation-cap" color="#14b8a6" size="lg" />
        </span>
        <span data-testid="unknown">
          <CategoryIcon icon="not-an-icon" color="chartreuse" size="sm" />
        </span>
      </div>,
    );
    const chip = (id: string) => screen.getByTestId(id).element().firstElementChild as HTMLElement;
    const orange = getComputedStyle(document.documentElement).getPropertyValue('--orange').trim();
    const subtle = getComputedStyle(document.documentElement).getPropertyValue('--subtle').trim();
    const rgb = (hex: string) =>
      `rgb(${[1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)).join(', ')})`;

    expect(chip('token').getAttribute('aria-hidden')).toBe('true');
    expect(getComputedStyle(chip('token')).color).toBe(rgb(orange));
    expect(getComputedStyle(chip('hex')).color).toBe('rgb(20, 184, 166)');
    expect(chip('hex').className).toContain('size-9');
    expect(getComputedStyle(chip('unknown')).color).toBe(rgb(subtle));
    expect(chip('unknown').querySelector('svg')?.getAttribute('class')).toContain('lucide-shapes');
  });
});
