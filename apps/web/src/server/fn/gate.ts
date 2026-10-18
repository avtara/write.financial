// SPDX-License-Identifier: AGPL-3.0-only
import { createServerFn } from '@tanstack/react-start';
import { loadGate, type Gate } from '../gate.ts';
import { services } from '../runtime.ts';

/** The root route's guard data (`routes/__root.tsx`): setup status, the signed-in viewer, public instance settings. */
export const getGate = createServerFn({ method: 'GET' }).handler(async ({ context }): Promise<Gate> => {
  const { hasAdmin, instance, config } = await services();
  return loadGate({
    hasAdmin,
    instance: instance.get,
    session: context.session,
    googleEnabled: config.google !== null,
  });
});
