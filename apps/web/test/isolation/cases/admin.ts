// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/admin.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`.
 */
import { expect } from 'vitest';
import {
  as,
  type Case,
  hostileInstance,
  INSTANCE_NAME,
  type Name,
  ok,
  ORIGIN,
  refused,
  smtpInput,
  UNAUTHENTICATED,
} from '../harness.ts';

export const cases = {
  getInstance: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      await refused('getInstance', undefined);
      expect(await as('A', 'getInstance')).toEqual(
        ok({
          instanceName: INSTANCE_NAME,
          publicUrl: `${ORIGIN}/`,
          defaultLocale: 'en',
          defaultTimezone: 'Asia/Makassar',
          registrationMode: 'invite',
          smtp: { ...smtpInput(), hasPassword: true },
        }),
      );
    },
  },
  saveInstance: {
    input: hostileInstance,
    anonymous: () => UNAUTHENTICATED,
    asB: (input) => refused('saveInstance', input),
  },
  sendInstanceTestEmail: {
    input: () => smtpInput(),
    anonymous: () => UNAUTHENTICATED,
    asB: (input) => refused('sendInstanceTestEmail', input),
  },
  inviteUser: {
    input: () => ({ email: 'mallory@example.test' }),
    anonymous: () => UNAUTHENTICATED,
    asB: (input) => refused('inviteUser', input),
  },
} satisfies Partial<Record<Name, Case>>;
