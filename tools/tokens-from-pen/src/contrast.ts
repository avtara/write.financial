// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The token contrast guard (M8 accessibility, WCAG 2.1 1.4.3/1.4.11): every text color on every surface it is written
 * on keeps 4.5:1 in both themes, text on the accent fills too, and the icon-only accent pairs keep 3:1. `pnpm
 * check:tokens` fails on a design change that breaks one, so a token never regresses what axe checks on the pages.
 * Translucent colors (`#RRGGBBAA`) are composed over the card, where tints are drawn.
 */
import type { TokenVariable } from './generate.ts';

export interface ContrastRule {
  readonly text: readonly string[];
  readonly on: readonly string[];
  readonly min: number;
}

export const CONTRAST_RULES: readonly ContrastRule[] = [
  {
    text: ['fg', 'text-secondary', 'muted-fg', 'subtle', 'green-fg', 'red-fg', 'amber-fg', 'blue-fg'],
    on: ['bg', 'card', 'popover', 'dialog', 'surface-2', 'surface-sunken', 'input'],
    min: 4.5,
  },
  // Status badges and chips ("Rp3.500.000 lewat", "3 hari lagi"): the status color on its own tints.
  ...(['green', 'red', 'amber', 'blue'] as const).map((hue) => ({
    text: [`${hue}-fg`],
    on: [`${hue}-tint-1`, `${hue}-tint-2`, `${hue}-tint-3`],
    min: 4.5,
  })),
  // Badges and destructive buttons ("Hari ini", "Hapus"), and the primary button.
  { text: ['on-accent'], on: ['blue', 'red'], min: 4.5 },
  { text: ['primary-fg'], on: ['fg'], min: 4.5 },
  // Only icons sit on green (the onboarding step's check): non-text contrast.
  { text: ['on-accent'], on: ['green'], min: 3 },
];

/** Where translucent colors are drawn. */
const BASE = 'card';
const MODES = ['dark', 'light'] as const;
type Mode = (typeof MODES)[number];
type Rgb = readonly [number, number, number];

function channels(hex: string): { rgb: Rgb; alpha: number } {
  const value = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16);
  return { rgb: [value(1), value(3), value(5)], alpha: hex.length === 9 ? value(7) / 255 : 1 };
}

/** `hex` drawn over the opaque `under`. */
function over(hex: string, under: Rgb): Rgb {
  const { rgb, alpha } = channels(hex);
  const mix = (index: 0 | 1 | 2) => rgb[index] * alpha + under[index] * (1 - alpha);
  return [mix(0), mix(1), mix(2)];
}

function luminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast of `text` on `background`, each composed over the one beneath (`base` under `background`). */
export function contrastRatio(text: string, background: string, base: string): number {
  const surface = over(background, over(base, [0, 0, 0]));
  const [light, dark] = [luminance(over(text, surface)), luminance(surface)].sort((a, b) => b - a) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

function colorIn(variables: Readonly<Record<string, TokenVariable>>, name: string, mode: Mode): string {
  const variable = variables[name];
  if (variable?.type !== 'color') throw new Error(`$${name} is not a color of the design`);
  return typeof variable.value === 'string' ? variable.value : variable.value[mode];
}

/** Every pair of {@link CONTRAST_RULES} below its minimum, as "dark: $subtle on $card 4.21 < 4.5". */
export function contrastFailures(variables: Readonly<Record<string, TokenVariable>>): string[] {
  const failures: string[] = [];
  for (const mode of MODES) {
    const base = colorIn(variables, BASE, mode);
    for (const rule of CONTRAST_RULES) {
      for (const text of rule.text) {
        for (const background of rule.on) {
          const ratio = contrastRatio(colorIn(variables, text, mode), colorIn(variables, background, mode), base);
          if (ratio < rule.min) {
            failures.push(`${mode}: $${text} on $${background} ${ratio.toFixed(2)} < ${String(rule.min)}`);
          }
        }
      }
    }
  }
  return failures;
}
