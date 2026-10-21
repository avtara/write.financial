// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/gate.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`.
 */
import { expect } from 'vitest';
import { as, B, bId, browsers, type Case, currentSessionId, INSTANCE_NAME, type Name } from '../harness.ts';

export const cases = {
  getGate: {
    anonymous: () => ({
      setup: 'complete',
      viewer: null,
      instanceName: INSTANCE_NAME,
      registrationMode: 'invite',
      googleEnabled: false,
    }),
    asB: async () => {
      expect(await as('B', 'getGate')).toEqual({
        setup: 'complete',
        viewer: {
          id: bId,
          sessionId: await currentSessionId(browsers.B),
          name: 'Budi S.',
          email: B.email,
          image: null,
          locale: 'en',
          timezone: 'Asia/Jakarta',
          role: 'user',
          twoFactorEnabled: true,
          // FR-A4: B has not started the onboarding yet (the onboarding cases come last).
          onboardingStep: 'profile',
        },
        instanceName: INSTANCE_NAME,
        registrationMode: 'invite',
        googleEnabled: false,
      });
    },
  },
} satisfies Partial<Record<Name, Case>>;
