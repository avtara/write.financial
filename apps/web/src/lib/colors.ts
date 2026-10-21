// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Colors users pick for categories and accounts: a design token name (`orange`, rendered per theme) or a custom
 * `#rrggbb`. The production CSP allows no `style` attributes (`style-src` with a nonce), so the color reaches CSS
 * as the custom property `--wf-color`: tokens through a `data-color` attribute (rules in `styles.css`, safe during
 * SSR), hex values through the CSSOM after mount. Style with `var(--wf-color, var(--subtle))`.
 */

/** Token colors with a `[data-color]` rule in `styles.css`. */
export const COLOR_TOKENS = [
  'amber',
  'blue',
  'cyan',
  'green',
  'orange',
  'red',
  'rose',
  'violet',
  'yellow',
  'subtle',
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

/** The swatches of the design's color picker ("Warna"), in order. */
export const PALETTE_COLORS: readonly ColorToken[] = [
  'cyan',
  'blue',
  'violet',
  'rose',
  'orange',
  'yellow',
  'green',
  'subtle',
];

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isColorToken(color: string): color is ColorToken {
  return (COLOR_TOKENS as readonly string[]).includes(color);
}

/** A storable color: a token or `#rrggbb`. */
export function isColor(color: string): boolean {
  return isColorToken(color) || HEX_COLOR.test(color);
}

export interface ColorProps {
  readonly 'data-color'?: ColorToken;
  /** Sets (hex) or clears `--wf-color` on the element. */
  readonly ref: (node: HTMLElement | SVGElement | null) => void;
}

/** Props to spread on the element whose classes read `--wf-color`; an unknown value leaves the fallback. */
export function colorProps(color: string): ColorProps {
  const hex = HEX_COLOR.test(color) ? color : null;
  const ref = (node: HTMLElement | SVGElement | null) => {
    if (node === null) return;
    if (hex === null) node.style.removeProperty('--wf-color');
    else node.style.setProperty('--wf-color', hex);
  };
  return isColorToken(color) ? { 'data-color': color, ref } : { ref };
}
