// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Admin invitations (FR-OP1) for `registration_mode = 'invite'`. The token is 256 random bits, sent only in the
 * email (and returned once to the inviting admin, so an instance without SMTP can share the link another way);
 * the database keeps its SHA-256. Sign-up with the token is checked by `registration.ts`.
 */
import { randomBytes } from 'node:crypto';
import { sha256Hex } from '@wf/crypto/hash';
import type { InstanceSettings } from '@wf/db/instance-settings';
import type { InvitationsRepository } from '@wf/db/invitations';
import type { Locale } from '@wf/i18n/locale';
import { MailNotConfiguredError, type Mailer } from '@wf/integrations/mailer';
import { appUrl } from './urls.ts';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60_000;
/** Web route that accepts `?invitation=<token>` (plan §7: `/_auth/sign-up`). */
export const SIGN_UP_PATH = 'sign-up';

/** Invitations are only issued in `invite` mode (`closed` admits no one new, `open` needs none). */
export class InvitationsDisabledError extends Error {
  override readonly name = 'InvitationsDisabledError';
  readonly code = 'INVITATIONS_DISABLED';

  constructor() {
    super('Invitations can only be sent when registration is by invitation');
  }
}

export interface InviteInput {
  readonly email: string;
  /** Language of the email; defaults to the instance default. */
  readonly locale?: Locale;
}

export interface Inviter {
  /** The admin's user id, from the session, and the name shown in the email. */
  readonly userId: string;
  readonly name: string;
}

export interface Invitation {
  /** The sign-up link with the token; show it to the admin once, never store it. */
  readonly url: string;
  readonly expiresAt: Date;
  /** `false` when SMTP is not configured and the admin has to pass the link on themselves. */
  readonly emailed: boolean;
}

export interface InvitationsDeps {
  /** On a `wf_app` connection: only admins may insert invitations (Row-Level Security). */
  readonly invitations: Pick<InvitationsRepository, 'create'>;
  readonly settings: () => Promise<
    Pick<InstanceSettings, 'registrationMode' | 'instanceName' | 'defaultLocale' | 'defaultTimezone'>
  >;
  readonly mailer: Mailer;
  readonly publicUrl: string;
  readonly now: () => Date;
}

/**
 * Creates and emails an invitation.
 * @throws {InvitationsDisabledError} unless registration is by invitation.
 * @throws {NotAdminError} (from `@wf/db`) if the inviter is not an admin.
 */
export function createInviter(deps: InvitationsDeps): (inviter: Inviter, input: InviteInput) => Promise<Invitation> {
  return async (inviter, { email, locale }) => {
    const settings = await deps.settings();
    if (settings.registrationMode !== 'invite') throw new InvitationsDisabledError();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(deps.now().getTime() + INVITATION_TTL_MS);
    await deps.invitations.create(inviter.userId, { email, tokenHash: sha256Hex(token), expiresAt });
    const url = appUrl(deps.publicUrl, `${SIGN_UP_PATH}?invitation=${token}`);
    try {
      await deps.mailer.send({
        to: email,
        template: { kind: 'invitation', url, inviterName: inviter.name, expiresAt, timeZone: settings.defaultTimezone },
        context: { locale: locale ?? settings.defaultLocale, instanceName: settings.instanceName, recipientName: null },
      });
    } catch (error) {
      if (!(error instanceof MailNotConfiguredError)) throw error;
      return { url, expiresAt, emailed: false };
    }
    return { url, expiresAt, emailed: true };
  };
}
