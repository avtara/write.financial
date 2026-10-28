// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastFailures, contrastRatio } from './contrast.ts';
import { parseSnapshot, type TokenVariable } from './generate.ts';

const design = parseSnapshot(JSON.parse(readFileSync(new URL('../../../design/tokens.json', import.meta.url), 'utf8')));
const color = (dark: string, light = dark): TokenVariable => ({ type: 'color', value: { dark, light } });

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#ffffff', '#000000', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#000000', '#ffffff', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#808080', '#808080', '#000000')).toBe(1);
  });

  it('composes a translucent text color over its background, and a translucent background over the base', () => {
    // White at 0% over black is black: no contrast at all.
    expect(contrastRatio('#ffffff00', '#000000', '#000000')).toBe(1);
    // A 50% white tint on black reads as #808080 under black text.
    expect(contrastRatio('#000000', '#ffffff80', '#000000')).toBeCloseTo(
      contrastRatio('#000000', '#808080', '#000000'),
      2,
    );
  });
});

describe('contrastFailures', () => {
  it('passes the design in both themes', () => {
    expect(contrastFailures(design)).toEqual([]);
  });

  it('names each pair below its minimum, per theme', () => {
    // A light-only regression of $subtle, and white on the dark theme's blue (the old $on-accent).
    const variables = { ...design, subtle: color('#858585', '#a1a1aa'), 'on-accent': color('#ffffff') };
    const failures = contrastFailures(variables);
    expect(failures).toContain('dark: $on-accent on $blue 3.68 < 4.5');
    expect(failures).toContain('light: $subtle on $card 2.56 < 4.5');
    expect(failures.some((failure) => failure.startsWith('dark: $subtle'))).toBe(false);
  });

  it('checks only design colors', () => {
    const fonts = { ...design, fg: { type: 'string', value: 'Geist' } as TokenVariable };
    expect(() => contrastFailures(fonts)).toThrow('$fg is not a color of the design');
    const withoutBlue = Object.fromEntries(Object.entries(design).filter(([name]) => name !== 'blue'));
    expect(() => contrastFailures(withoutBlue)).toThrow('$blue is not a color of the design');
  });
});
