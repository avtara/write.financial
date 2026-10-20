// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useState } from 'react';

/**
 * The content width of the element given the returned ref, following resizes; `null` until it is mounted (the server
 * and the first client render), so charts that need it draw after hydration.
 */
export function useElementWidth(): [ref: (node: Element | null) => () => void, width: number | null] {
  const [width, setWidth] = useState<number | null>(null);
  // React 19 calls the returned cleanup instead of the ref with `null`, so the ref only ever gets the element.
  const ref = useCallback((node: Element | null) => {
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round((entry as ResizeObserverEntry).contentRect.width));
    });
    observer.observe(node as Element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [ref, width];
}
