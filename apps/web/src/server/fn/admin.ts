// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Server functions of Settings › Instans (admins only, FR-OP1 "or later edits"): the instance settings the wizard
 * saved, the SMTP test, and invitations. Every one needs an admin with two-step verification and a session from the
 * last 15 minutes (FR-A9: every admin action).
 */
import { createServerFn } from '@tanstack/react-start';
import type { Invitation } from '@wf/auth/invitations';
import { LOCALES } from '@wf/i18n/locale';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import { services } from '../runtime.ts';
import { instanceInput, sendTestEmail, smtpInput, toSetupInput, type InstanceDraft } from '../setup.ts';

const ADMIN = { admin: true, fresh: true } as const;

export const getInstance = createServerFn({ method: 'GET' }).handler(
  async ({ context }): Promise<Result<InstanceDraft>> => {
    const { instance, config, now } = await services();
    return attempt(async () => {
      await requireSession(context.session, { admin: true }, now());
      const { instanceName, publicUrl, defaultLocale, defaultTimezone, registrationMode, smtp } = await instance.get();
      return {
        instanceName,
        publicUrl: publicUrl ?? config.publicUrl,
        defaultLocale,
        defaultTimezone,
        registrationMode,
        smtp,
      };
    });
  },
);

export const saveInstance = createServerFn({ method: 'POST' })
  .validator(instanceInput)
  .handler(async ({ context, data }): Promise<Result<null>> => {
    const { instance, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, ADMIN, now());
      await instance.updateSetup(user.id, toSetupInput(data));
      return null;
    });
  });

export const sendInstanceTestEmail = createServerFn({ method: 'POST' })
  .validator(smtpInput)
  .handler(async ({ context, data }): Promise<Result<null>> => {
    const { instance, sendWith, config, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, ADMIN, now());
      const settings = await instance.get();
      await sendTestEmail(
        { send: sendWith, storedPassword: instance.smtpPassword },
        data,
        { email: user.email, name: user.name, locale: context.preferences.locale },
        { instanceName: settings.instanceName, publicUrl: settings.publicUrl ?? config.publicUrl },
      );
      return null;
    });
  });

/** Invites someone (registration mode `invite`); the link is returned once so it can be shared without SMTP. */
export const inviteUser = createServerFn({ method: 'POST' })
  .validator(z.object({ email: z.email().max(320), locale: z.enum(LOCALES).optional() }))
  .handler(async ({ context, data }): Promise<Result<Invitation>> => {
    const { invite, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, ADMIN, now());
      const { email, locale } = data;
      return invite({ userId: user.id, name: user.name }, { email, ...(locale === undefined ? {} : { locale }) });
    });
  });
