// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Geometry of the "Arus Uang" Sankey (FR-D2, plan §2: `d3-sankey` lays it out, the card draws the SVG itself so no
 * chart library writes `style` attributes). The money flow of `@wf/domain/dashboard` has fixed columns: sources →
 * total ("Pemasukan") → groups → categories (or, counting transfers, destination accounts). Nodes are ordered so bands
 * never cross: groups as the budget lists them (Kebutuhan, Keinginan, …, Tabungan last), each group's categories
 * together, largest first.
 */
import type { MoneyFlow, MoneyFlowLink, MoneyFlowNode } from '@wf/domain/dashboard';
import { sankey, sankeyLinkHorizontal, type SankeyLink, type SankeyNode } from 'd3-sankey';

/** Group nodes top to bottom; an unknown group goes last. */
const GROUP_RANK: Readonly<Record<string, number>> = {
  'group:needs': 0,
  'group:wants': 1,
  'group:financial': 2,
  'group:other': 3,
  'group:savings': 4,
};

/**
 * What to draw: every column; FR-TB2's two levels on a tablet (sources → total → groups, a group opens its
 * categories); or one group's categories (`group:<group>` → its column-3 nodes).
 */
export type FlowLevels = 'full' | 'groups' | { readonly group: string };

export interface FlowGraph {
  readonly nodes: MoneyFlowNode[];
  readonly links: MoneyFlowLink[];
}

/** The nodes and links of `flow` that `levels` shows, ordered so bands do not cross. */
export function flowGraph(flow: Pick<MoneyFlow, 'nodes' | 'links'>, levels: FlowLevels): FlowGraph {
  // The domain adds one total → group link per category; a band is one link per pair.
  const byPair = new Map<string, MoneyFlowLink>();
  for (const link of flow.links) {
    const key = `${link.from}>${link.to}`;
    const known = byPair.get(key);
    byPair.set(key, known === undefined ? link : { ...link, valueMinor: known.valueMinor + link.valueMinor });
  }
  const all = [...byPair.values()];
  const parentOf = new Map(all.filter((link) => link.from.startsWith('group:')).map((l) => [l.to, l.from]));
  // Column 2 holds the groups; every column-3 node has one group feeding it.
  const rank = (node: MoneyFlowNode): number =>
    GROUP_RANK[node.column === 2 ? node.id : (parentOf.get(node.id) as string)] ?? 5;
  const ordered = flow.nodes.toSorted(
    (a, b) =>
      a.column - b.column ||
      (a.column >= 2 ? rank(a) - rank(b) : 0) ||
      (a.column === 3 && b.valueMinor !== a.valueMinor ? (b.valueMinor > a.valueMinor ? 1 : -1) : 0),
  );
  if (levels === 'full') return { nodes: ordered, links: all };
  if (levels === 'groups') {
    return {
      nodes: ordered.filter((node) => node.column <= 2),
      links: all.filter((link) => !link.from.startsWith('group:')),
    };
  }
  const links = all.filter((link) => link.from === levels.group);
  const ids = new Set([levels.group, ...links.map((link) => link.to)]);
  return { nodes: ordered.filter((node) => ids.has(node.id)), links };
}

export interface LaidNode extends MoneyFlowNode {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

export interface LaidLink extends MoneyFlowLink {
  /** SVG path data of the band's centre line; draw with `stroke-width` = {@link LaidLink.width}. */
  readonly path: string;
  readonly width: number;
}

export interface FlowLayout {
  readonly nodes: LaidNode[];
  readonly links: LaidLink[];
}

export interface FlowBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export const NODE_WIDTH = 6;

/** Lays `graph` out in `box` (inside the SVG), each node in its column, in the given order. */
export function layoutFlow(graph: FlowGraph, box: FlowBox, nodePadding: number): FlowLayout {
  type Node = SankeyNode<MoneyFlowNode, MoneyFlowLink>;
  const first = Math.min(...graph.nodes.map((node) => node.column));
  const layout = sankey<MoneyFlowNode, MoneyFlowLink>()
    .nodeId((node) => node.id)
    .nodeAlign((node) => node.column - first)
    .nodeWidth(NODE_WIDTH)
    .nodePadding(nodePadding)
    .nodeSort(null)
    .linkSort(null)
    .extent([
      [box.left, box.top],
      [box.right, box.bottom],
    ]);
  const result = layout({
    nodes: graph.nodes.map((node) => ({ ...node })),
    links: graph.links.map((link) => ({ ...link, source: link.from, target: link.to, value: Number(link.valueMinor) })),
  });
  const path = sankeyLinkHorizontal<MoneyFlowNode, MoneyFlowLink>();
  return {
    nodes: result.nodes.map((node: Node) => ({
      id: node.id,
      column: node.column,
      valueMinor: node.valueMinor,
      shareBps: node.shareBps,
      // d3-sankey sets the positions and widths it lays out.
      x0: node.x0 as number,
      x1: node.x1 as number,
      y0: node.y0 as number,
      y1: node.y1 as number,
    })),
    links: result.links.map((link: SankeyLink<MoneyFlowNode, MoneyFlowLink>) => ({
      from: link.from,
      to: link.to,
      valueMinor: link.valueMinor,
      path: path(link) as string,
      width: Math.max(link.width as number, 1),
    })),
  };
}
