// SPDX-License-Identifier: AGPL-3.0-only
import { moneyFlow, type MoneyFlow } from '@wf/domain/dashboard';
import { describe, expect, it } from 'vitest';
import { dashboard } from '../../../test/dashboard-fixtures.ts';
import { flowGraph, layoutFlow, NODE_WIDTH } from './money-flow-layout.ts';

const FLOW = moneyFlow(dashboard().flow, { showSmallSources: true, countTransfers: true });
const BOX = { left: 150, top: 10, right: 750, bottom: 410 };

describe('flowGraph', () => {
  it('orders groups like the budget and keeps each group’s categories together, largest first', () => {
    const { nodes, links } = flowGraph(FLOW, 'full');
    expect(nodes.filter((node) => node.column === 2).map((node) => node.id)).toEqual([
      'group:needs',
      'group:wants',
      'group:other',
      'group:savings',
    ]);
    expect(nodes.filter((node) => node.column === 3).map((node) => node.id)).toEqual([
      'category:cat-rent',
      'category:cat-food',
      'category:cat-shopping',
      'category:uncategorized',
      'unallocated',
      'account:acc-jago',
    ]);
    // One band per pair: total → Kebutuhan merges its two categories.
    expect(links.find((link) => link.from === 'total' && link.to === 'group:needs')?.valueMinor).toBe(7_700_000n);
    expect(links.filter((link) => link.to === 'group:needs')).toHaveLength(1);
  });

  it('shows two levels on a tablet and one group’s categories when it is opened', () => {
    const groups = flowGraph(FLOW, 'groups');
    expect(Math.max(...groups.nodes.map((node) => node.column))).toBe(2);
    expect(groups.links.every((link) => !link.from.startsWith('group:'))).toBe(true);
    const needs = flowGraph(FLOW, { group: 'group:needs' });
    expect(needs.nodes.map((node) => node.id)).toEqual(['group:needs', 'category:cat-rent', 'category:cat-food']);
    expect(needs.links).toHaveLength(2);
  });

  it('puts an unknown group last and keeps equal categories in order', () => {
    const flow: Pick<MoneyFlow, 'nodes' | 'links'> = {
      nodes: [
        { id: 'group:mystery', column: 2, valueMinor: 1n, shareBps: 0 },
        { id: 'group:wants', column: 2, valueMinor: 2n, shareBps: 0 },
        { id: 'category:b', column: 3, valueMinor: 1n, shareBps: 0 },
        { id: 'category:a', column: 3, valueMinor: 1n, shareBps: 0 },
      ],
      links: [
        { from: 'group:wants', to: 'category:b', valueMinor: 1n },
        { from: 'group:wants', to: 'category:a', valueMinor: 1n },
      ],
    };
    expect(flowGraph(flow, 'full').nodes.map((node) => node.id)).toEqual([
      'group:wants',
      'group:mystery',
      'category:b',
      'category:a',
    ]);
  });
});

describe('layoutFlow', () => {
  it('places each column inside the box with bands as wide as their value', () => {
    const { nodes, links } = layoutFlow(flowGraph(FLOW, 'full'), BOX, 14);
    const total = nodes.find((node) => node.id === 'total');
    expect(nodes.find((node) => node.column === 0)?.x0).toBe(150);
    expect(nodes.find((node) => node.column === 3)?.x1).toBe(750);
    expect((total?.x1 ?? 0) - (total?.x0 ?? 0)).toBe(NODE_WIDTH);
    expect(Math.min(...nodes.map((node) => node.y0))).toBeGreaterThanOrEqual(10);
    expect(Math.max(...nodes.map((node) => node.y1))).toBeLessThanOrEqual(410);
    const salary = links.find((link) => link.from === 'source:cat-salary');
    const dividend = links.find((link) => link.from === 'source:cat-dividend_interest');
    expect(salary?.path.startsWith('M')).toBe(true);
    expect(salary?.width).toBeGreaterThan(dividend?.width ?? Infinity);
    expect(dividend?.width).toBeGreaterThanOrEqual(1);
  });

  it('starts at the first shown column', () => {
    const { nodes } = layoutFlow(flowGraph(FLOW, { group: 'group:needs' }), BOX, 14);
    expect(nodes.find((node) => node.id === 'group:needs')?.x0).toBe(150);
    expect(nodes.find((node) => node.id === 'category:cat-rent')?.x1).toBe(750);
  });
});
