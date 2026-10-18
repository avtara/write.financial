// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { fakeSession, SETTINGS } from '../../../test/fixtures.ts';
import { call, requestContext } from '../../../test/server-fn.ts';
import type { Gate } from '../gate.ts';
import { getGate } from './gate.ts';

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () =>
    Promise.resolve({
      hasAdmin: () => Promise.resolve(true),
      instance: { get: () => Promise.resolve(SETTINGS) },
      config: { google: { clientId: 'id', clientSecret: 'secret', gmail: null } },
    }),
}));

describe('getGate', () => {
  it('answers from the request session and the instance settings', async () => {
    const gate = await call<Gate>(getGate, { context: requestContext(fakeSession({ role: 'admin' })) });
    expect(gate).toMatchObject({ setup: 'admin-created', googleEnabled: true, viewer: { role: 'admin' } });
  });
});
