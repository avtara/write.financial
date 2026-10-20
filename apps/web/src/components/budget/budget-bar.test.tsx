// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import '../../styles.css';
import { BudgetBar } from './budget-bar.tsx';

async function rects(ui: ReactElement) {
  const screen = await render(ui);
  const svg = screen.container.querySelector('svg') as SVGSVGElement;
  return { svg, rects: [...svg.querySelectorAll('rect')] };
}

describe('BudgetBar', () => {
  it('fills the used share in its tone with the ideal marker', async () => {
    const {
      svg,
      rects: [track, fill, marker],
    } = await rects(<BudgetBar usedBps={8800} tone="ok" idealBps={4839} />);
    expect(svg.getAttribute('class')).toContain('h-1.5');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(track).toHaveAttribute('width', '1000');
    expect(fill).toHaveAttribute('width', '880');
    expect(fill?.getAttribute('class')).toContain('fill-green');
    expect(marker).toHaveAttribute('x', String(483.9 - 2));
  });

  it('turns red over the limit and moves the marker to where the limit ends', async () => {
    const { rects: found } = await rects(<BudgetBar usedBps={12_000} tone="over" idealBps={4839} size="lg" />);
    expect(found[1]).toHaveAttribute('width', '1000');
    expect(found[1]?.getAttribute('class')).toContain('fill-red opacity-90');
    expect(found[2]).toHaveAttribute('x', String(833.3 - 2));
  });

  it('leaves out the fill when nothing is used and the marker without an ideal', async () => {
    expect((await rects(<BudgetBar usedBps={null} tone="idle" idealBps={null} />)).rects).toHaveLength(1);
    const { svg, rects: found } = await rects(
      <BudgetBar usedBps={0} tone="ok" idealBps={0} size="lg" className="mt-1" />,
    );
    expect(svg.getAttribute('class')).toContain('h-2.5 mt-1');
    expect(found).toHaveLength(2);
    expect(found[1]).toHaveAttribute('x', '0');
  });

  it('uses a group colour instead of the tone', async () => {
    const { rects: found } = await rects(
      <BudgetBar usedBps={5000} tone="warning" idealBps={null} fillClassName="fill-blue" />,
    );
    expect(found[1]).toHaveAttribute('class', 'fill-blue');
  });
});
