// SPDX-License-Identifier: AGPL-3.0-only
/** Server functions of Settings › Profile and Settings › Security; the user always comes from the session. */
import { createServerFn } from '@tanstack/react-start';
import type { Profile } from '@wf/db/profiles';
import { LOCALES } from '@wf/i18n/locale';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import {
  loadHistory,
  loadSecurity,
  toDeviceView,
  type DeviceView,
  type SecurityHistory,
  type SecurityOverview,
} from '../account.ts';
import { services } from '../runtime.ts';

const profileInput = z.object({
  name: z.string().max(200),
  nickname: z.string().max(200).nullable(),
  locale: z.enum(LOCALES),
  timezone: z.string().max(100),
});

export const getProfile = createServerFn({ method: 'GET' }).handler(async ({ context }): Promise<Result<Profile>> => {
  const { profiles, now } = await services();
  return attempt(async () => {
    const { user } = await requireSession(context.session, {}, now());
    return profiles.get(user.id);
  });
});

export const updateProfile = createServerFn({ method: 'POST' })
  .validator(profileInput)
  .handler(async ({ context, data }): Promise<Result<Profile>> => {
    const { profiles, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return profiles.update(user.id, data);
    });
  });

/** FR-S8: the language switcher saves the choice to the account, so every device and email follows it. */
export const saveLocale = createServerFn({ method: 'POST' })
  .validator(z.object({ locale: z.enum(LOCALES) }))
  .handler(async ({ context, data }): Promise<Result<null>> => {
    const { profiles, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      await profiles.update(user.id, { locale: data.locale });
      return null;
    });
  });

export const getSecurity = createServerFn({ method: 'GET' }).handler(
  async ({ context }): Promise<Result<SecurityOverview>> => {
    const { auth, securityEvents, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      const { headers } = context;
      return loadSecurity(
        {
          listDevices: () => auth.listDevices(headers),
          listPasskeys: () => auth.api.listPasskeys({ headers }),
          listProviders: async () =>
            (await auth.api.listUserAccounts({ headers })).map((account) => account.providerId),
          events: securityEvents,
        },
        user,
      );
    });
  },
);

export const getSecurityHistory = createServerFn({ method: 'GET' })
  .validator(z.object({ before: z.uuid() }))
  .handler(async ({ context, data }): Promise<Result<SecurityHistory>> => {
    const { securityEvents, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return loadHistory(securityEvents, user.id, data.before);
    });
  });

export const listDevices = createServerFn({ method: 'GET' }).handler(
  async ({ context }): Promise<Result<DeviceView[]>> => {
    const { auth, now } = await services();
    return attempt(async () => {
      await requireSession(context.session, {}, now());
      return (await auth.listDevices(context.headers)).map(toDeviceView);
    });
  },
);

/** FR-A5: signs one device out. */
export const revokeDevice = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ context, data }): Promise<Result<null>> => {
    const { auth, now } = await services();
    return attempt(async () => {
      await requireSession(context.session, {}, now());
      await auth.revokeDevice(context.headers, data.id);
      return null;
    });
  });

/** FR-A5: signs out every device but this one. */
export const revokeOtherDevices = createServerFn({ method: 'POST' }).handler(
  async ({ context }): Promise<Result<{ count: number }>> => {
    const { auth, now } = await services();
    return attempt(async () => {
      await requireSession(context.session, {}, now());
      return { count: await auth.revokeOtherDevices(context.headers) };
    });
  },
);
