// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether `query` (e.g. `(min-width: 1280px)`) matches, following changes. The server and the first client render
 * use `serverValue`, so markup that depends on it should also be right for that value.
 */
export function useMediaQuery(query: string, serverValue: boolean): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = matchMedia(query);
      list.addEventListener('change', onChange);
      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => matchMedia(query).matches,
    () => serverValue,
  );
}
