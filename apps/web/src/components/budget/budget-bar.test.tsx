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
  it('draws nothing at 0% but keeps its height, with or without an ideal', async () => {
    for (const ui of [
      <BudgetBar key="zero" usedBps={0} tone="ok" idealBps={7097} size="lg" className="mt-1" />,
      <BudgetBar key="none" usedBps={null} tone="idle" idealBps={4839} />,
      <BudgetBar key="negative" usedBps={-5} tone="ok" idealBps={null} />,
    ]) {
      const { svg, rects: found } = await rects(ui);
      expect(found).toHaveLength(0);
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg.getAttribute('class')).toMatch(/h-(1|2)\.5/);
    }
    expect(
      (await rects(<BudgetBar usedBps={0} tone="ok" idealBps={0} size="lg" className="mt-1" />)).svg.getAttribute(
        'class',
      ),
    ).toContain('h-2.5 mt-1');
  });

  it('keeps an empty track at 0% when asked (a goal with nothing saved yet)', async () => {
    for (const usedBps of [0, null]) {
      const { rects: found } = await rects(<BudgetBar usedBps={usedBps} tone="ok" idealBps={null} emptyTrack />);
      expect(found).toHaveLength(1);
      expect(found[0]).toHaveAttribute('width', '1000');
      expect(found[0]?.getAttribute('class')).toBe('fill-surface-3');
    }
  });

  it('fills 1–99% in its tone with the ideal marker and no 100% marker', async () => {
    for (const usedBps of [1, 8800, 9900]) {
      const {
        svg,
        rects: [track, fill, marker, ...rest],
      } = await rects(<BudgetBar usedBps={usedBps} tone="ok" idealBps={4839} />);
      expect(svg.getAttribute('class')).toContain('h-1.5');
      expect(track).toHaveAttribute('width', '1000');
      expect(fill).toHaveAttribute('width', String(usedBps / 10));
      expect(fill?.getAttribute('class')).toContain('fill-green');
      expect(fill?.getAttribute('class')).not.toContain('opacity-90');
      expect(marker).toHaveAttribute('x', String(483.9 - 2));
      expect(rest).toHaveLength(0);
    }
    // Without an ideal (fixed budgets, closed periods, the dashboard card) there is no marker at all.
    expect((await rects(<BudgetBar usedBps={5000} tone="warning" idealBps={null} />)).rects).toHaveLength(2);
  });

  it('fills the whole bar at exactly 100% without a 100% marker', async () => {
    expect((await rects(<BudgetBar usedBps={10_000} tone="warning" idealBps={null} />)).rects).toHaveLength(2);
    const { rects: found } = await rects(<BudgetBar usedBps={10_000} tone="warning" idealBps={6000} />);
    expect(found[1]).toHaveAttribute('width', '1000');
    expect(found[2]).toHaveAttribute('x', String(600 - 2));
  });

  it('turns red over 100% and marks where 100% sits instead of the ideal', async () => {
    for (const idealBps of [4839, null]) {
      const { rects: found } = await rects(<BudgetBar usedBps={12_000} tone="over" idealBps={idealBps} size="lg" />);
      expect(found).toHaveLength(3);
      expect(found[1]).toHaveAttribute('width', '1000');
      expect(found[1]?.getAttribute('class')).toContain('fill-red opacity-90');
      expect(found[2]).toHaveAttribute('x', String(833.3 - 2));
    }
    expect((await rects(<BudgetBar usedBps={10_001} tone="over" idealBps={null} />)).rects[2]).toHaveAttribute(
      'x',
      String(999.9 - 2),
    );
  });

  it('keeps the marker inside the bar at an ideal of 0', async () => {
    expect((await rects(<BudgetBar usedBps={100} tone="ok" idealBps={0} />)).rects[2]).toHaveAttribute('x', '0');
  });

  it('uses a group colour instead of the tone', async () => {
    const { rects: found } = await rects(
      <BudgetBar usedBps={5000} tone="warning" idealBps={null} fillClassName="fill-blue" />,
    );
    expect(found[1]).toHaveAttribute('class', 'fill-blue');
  });
});
