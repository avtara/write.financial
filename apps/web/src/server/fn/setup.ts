// SPDX-License-Identifier: AGPL-3.0-only
/** Server functions of the setup wizard (`/setup`, FR-OP1); see `../setup.ts` for the rules. */
import { createServerFn } from '@tanstack/react-start';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import { services, type Services } from '../runtime.ts';
import {
  adminInput,
  instanceInput,
  requireStep,
  sendTestEmail,
  setupCookie,
  setupState,
  smtpInput,
  toSetupInput,
  tokenMatches,
  setupToken,
  type SetupDeps,
  type SetupState,
} from '../setup.ts';

/** The wizard's rules over this request: the configured token, the instance, and the request's session. */
function wizard(runtime: Services, session: SetupDeps['session']) {
  const setup: SetupDeps = {
    token: runtime.config.setup.token,
    publicUrl: runtime.config.publicUrl,
    hasAdmin: runtime.hasAdmin,
    instance: runtime.instance.get,
    session,
  };
  return { setup, secure: new URL(runtime.config.publicUrl).protocol === 'https:' };
}

/**
 * The wizard's state for this visitor. A matching `token` from the URL is moved into the httpOnly cookie, so the
 * following steps (and reloads) work without it in the address bar.
 */
export const getSetup = createServerFn({ method: 'GET' })
  .validator(z.object({ token: z.string().max(512).optional() }))
  .handler(async ({ context, data }): Promise<SetupState> => {
    const { setup, secure } = wizard(await services(), context.session);
    const fromUrl = tokenMatches(setup.token, data.token) ? data.token : undefined;
    const state = await setupState(setup, fromUrl ?? setupToken(context.headers));
    if (fromUrl !== undefined && state.status === 'open') context.setCookie(setupCookie(fromUrl, secure));
    return state;
  });

/** Step 1: the first admin. The browser signs in with the same credentials afterwards. */
export const createSetupAdmin = createServerFn({ method: 'POST' })
  .validator(adminInput)
  .handler(async ({ context, data }): Promise<Result<null>> => {
    const runtime = await services();
    const { setup } = wizard(runtime, context.session);
    return attempt(async () => {
      await requireStep(setup, setupToken(context.headers), 'admin');
      await runtime.auth.createFirstAdmin(data);
      return null;
    });
  });

/** "Kirim email uji" with the SMTP settings as entered, to the admin's own address. */
export const sendSetupTestEmail = createServerFn({ method: 'POST' })
  .validator(smtpInput)
  .handler(async ({ context, data }): Promise<Result<null>> => {
    const runtime = await services();
    const { setup } = wizard(runtime, context.session);
    return attempt(async () => {
      const { draft } = await requireStep(setup, setupToken(context.headers), 'instance');
      const { user } = await requireSession(context.session, { admin: true }, runtime.now());
      await sendTestEmail(
        { send: runtime.sendWith, storedPassword: runtime.instance.smtpPassword },
        data,
        { email: user.email, name: user.name, locale: context.preferences.locale },
        draft,
      );
      return null;
    });
  });

/** The last step: saves the instance settings, which completes setup and closes the wizard. */
export const saveSetup = createServerFn({ method: 'POST' })
  .validator(instanceInput)
  .handler(async ({ context, data }): Promise<Result<null>> => {
    const runtime = await services();
    const { setup, secure } = wizard(runtime, context.session);
    return attempt(async () => {
      await requireStep(setup, setupToken(context.headers), 'instance');
      const { user } = await requireSession(context.session, { admin: true }, runtime.now());
      await runtime.instance.updateSetup(user.id, toSetupInput(data));
      context.setCookie(setupCookie('', secure, 0));
      return null;
    });
  });
