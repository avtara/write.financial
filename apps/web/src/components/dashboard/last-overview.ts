// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The last data the Overview showed in this tab (FR-D4): it stays on screen, dimmed, while another span loads past
 * the pending delay, and offline it is "Lihat data terakhir". Written by the route component only after render
 * (client side), so a server render never shares one user's data with another.
 */
import type { OverviewData } from '../overview-page.tsx';

let last: OverviewData | null = null;

export function rememberOverview(data: OverviewData): void {
  last = data;
}

export function lastOverview(): OverviewData | null {
  return last;
}
