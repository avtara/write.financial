// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/setup.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`.
 */
import { expect } from 'vitest';
import {
  type Case,
  count,
  FORBIDDEN,
  hostileInstance,
  type Name,
  refused,
  secret,
  SETUP_TOKEN,
  smtpInput,
} from '../harness.ts';

export const cases = {
  getSetup: {
    input: () => ({ token: SETUP_TOKEN }),
    anonymous: () => ({ status: 'closed' }),
    asB: (input) => refused('getSetup', input, { status: 'closed' }),
  },
  createSetupAdmin: {
    input: () => ({ name: 'Mallory', email: 'mallory@example.test', password: secret('password-m'), locale: 'en' }),
    anonymous: () => FORBIDDEN,
    asB: async (input) => {
      await refused('createSetupAdmin', input);
      expect(await count('users', `email = 'mallory@example.test'`)).toBe(0);
    },
  },
  sendSetupTestEmail: {
    input: () => smtpInput(),
    anonymous: () => FORBIDDEN,
    asB: (input) => refused('sendSetupTestEmail', input),
  },
  saveSetup: {
    input: hostileInstance,
    anonymous: () => FORBIDDEN,
    asB: (input) => refused('saveSetup', input),
  },
} satisfies Partial<Record<Name, Case>>;
