// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The write.financial mark (design Section 20, `Logo Mark / 24`): a pen nib whose slit rises into a chart
 * line. Three paths, each placed in the 24×24 box exactly as in the design. Decorative: the wordmark or an
 * accessible name next to it names the product.
 */
const PARTS = [
  {
    box: [7.4638, 0, 12.2274, 8.7716],
    viewBox: '0 0 173.0841 124.1659',
    d: 'M172.37495 0.12955l-64.03634 63.54546c-0.21817 0.27272-0.65454 0.27272-0.98181 0l-24.27274-20.94545c-0.21817-0.27274-0.70908-0.27274-0.98181 0l-81.87274 80.45454c-0.43634 0.43636-0.21819 0.98183 0.38182 0.98183l32.07274 0 46.74545-44.23637 27.92728 24.32727c0.54544 0.43637 1.30908 0.43637 1.79998 0l63.81818-61.63637c0.1091-0.16364 0.1091-0.38181 0.1091-0.59999l0-41.45455c0-0.54545-0.3818-0.70909-0.70911-0.43637z',
  },
  {
    box: [4.3087, 8.6811, 7.2443, 15.3189],
    viewBox: '0 0 102.5455 216.8449',
    d: 'M95.83637 90.57213c-7.2-2.8909-12.10909-9.87274-12.10909-18.27274 0-7.25455 3.92726-13.58182 9.49091-16.69092l0-55.19998c0-0.43639-0.49091-0.54547-0.76365-0.2182-8.67273 9.32727-22.41818 13.14546-38.56363 13.14546l-37.63636 0c-0.59999 23.07272-8.45454 44.34548-16.25455 60.27272 47.94546 45.16363 73.90909 86.61817 99.76364 143.23639l2.78182 0-6.70909-126.27273z',
  },
  {
    box: [11.7765, 7.5039, 7.2211, 16.4961],
    viewBox: '0 0 102.2182 233.5091',
    d: 'M86.0182 30l-19.09091 0c-24.1091 0-40.69095-12.92726-49.63638-30l-7.96364 7.63637 0 64.52725c5.78183 3.27274 9.76366 9.43637 9.76366 16.69092 0 8.45456-5.23637 15.65454-11.89093 18.3273l-7.2 126.32727 2.89091 0c24.92728-54.16364 54.60001-102.2182 99.32728-143.12729-8.23636-18.16364-15.81818-39.27274-16.19999-60.38182z',
  },
] as const;

/** Rendered size in px; the design uses 16 in the sidebar tile and 18 in the tablet rail. */
export function LogoMark({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      {PARTS.map(({ box: [x, y, width, height], viewBox, d }) => (
        <svg key={d} x={x} y={y} width={width} height={height} viewBox={viewBox} preserveAspectRatio="none">
          <path d={d} />
        </svg>
      ))}
    </svg>
  );
}

/** Tile sizes from the design: the sidebar brand (28 px tile, 16 px mark) and the tablet rail (40 px, 18 px). */
const TILE = {
  sidebar: { className: 'size-7 rounded-[7px]', mark: 16 },
  rail: { className: 'size-10 rounded-[9px]', mark: 18 },
} as const;

/**
 * The mark inside its tile: `$fg` tile, `$primary-fg` mark, so it inverts automatically in light mode.
 * Sized with classes, never `style` attributes: the CSP does not allow inline styles in server HTML.
 */
export function LogoTile({ variant }: { variant: keyof typeof TILE }) {
  const { className, mark } = TILE[variant];
  return (
    <span className={`inline-flex shrink-0 items-center justify-center bg-fg text-primary-fg ${className}`}>
      <LogoMark size={mark} />
    </span>
  );
}
