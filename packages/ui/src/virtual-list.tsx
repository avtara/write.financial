// SPDX-License-Identifier: AGPL-3.0-only
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useSyncExternalStore, type ReactNode } from 'react';

export interface VirtualListProps {
  count: number;
  /** Estimated height of row `index` in px; rows are measured once rendered, so day headers may differ from rows. */
  estimateSize: (index: number) => number;
  /** Stable key per row (a transaction id); defaults to the index. */
  getItemKey?: (index: number) => string | number;
  renderItem: (index: number) => ReactNode;
  /** Rows rendered beyond the visible ones, each side. Default 8. */
  overscan?: number;
  /** Names the list for assistive technology, e.g. "Transaksi Oktober". */
  label: string;
  /** Must bound the height (`h-[600px]`, `flex-1 min-h-0`), since the list scrolls inside itself. */
  className?: string;
}

const subscribe = () => () => {};

/**
 * Renders only the visible rows of a long list (thousands of transactions) inside its own scroll container, on
 * TanStack Virtual. Rows are `listitem`s positioned in a `list` sized for all rows, so the scrollbar is honest;
 * `aria-setsize`/`aria-posinset` give the real count and position. Rows mount only in the browser: positions need
 * measured sizes, and inline `style` attributes in server HTML would break the nonce-only CSP.
 */
export function VirtualList({
  count,
  estimateSize,
  getItemKey,
  renderItem,
  overscan = 8,
  label,
  className = '',
}: VirtualListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  // React Compiler skips this component: TanStack Virtual returns fresh functions on purpose (it must re-render).
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count,
    estimateSize,
    overscan,
    getScrollElement: () => scroller.current,
    ...(getItemKey === undefined ? {} : { getItemKey }),
  });
  return (
    <div ref={scroller} className={`overflow-y-auto overscroll-contain ${className}`}>
      {mounted ? (
        <div role="list" aria-label={label} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => (
            <div
              key={item.key}
              role="listitem"
              aria-setsize={count}
              aria-posinset={item.index + 1}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {renderItem(item.index)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
