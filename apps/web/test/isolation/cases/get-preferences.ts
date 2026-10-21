// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/get-preferences.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`.
 */
import { expect } from 'vitest';
import { requestContext } from '../../server-fn.ts';
import { as, type Case, type Name } from '../harness.ts';

export const cases = {
  getPreferences: {
    anonymous: () => requestContext(null).preferences,
    asB: async () => {
      expect(await as('B', 'getPreferences')).toEqual(requestContext(null).preferences);
    },
  },
} satisfies Partial<Record<Name, Case>>;
