// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Security history (FR-A10, PRD §9.1 Audit) and the emails that go with it. Events store a keyed hash of the
 * client IP, never the IP. A sign-in from a device the user has not signed in from before (by user agent and
 * subnet, see `device.ts`) sends a new-device email, except for the account's very first sign-in.
 */
import { hmacSha256Hex } from '@wf/crypto/hash';
import type { JsonObject } from '@wf/db/schema';
import type { SecurityEvents, SecurityEventType } from '@wf/db/security-events';
import type { Locale } from '@wf/i18n/locale';
import { MailNotConfiguredError, type MailMessage, type Mailer } from '@wf/integrations/mailer';
import type { AuthLogger } from './breached.ts';
import { describeDevice, deviceFingerprint } from './device.ts';

/** Where a request came from; `ip` as Better Auth resolved it (`advanced.ipAddress`). */
export interface RequestInfo {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface AuditUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly locale: Locale;
  readonly timezone: string;
}

export type SignInMethod = 'password' | 'totp' | 'backup_code' | 'passkey' | 'google' | 'sign_up';

export interface Audit {
  record: (userId: string, type: SecurityEventType, request: RequestInfo, meta?: JsonObject) => Promise<void>;
  /** Records a completed sign-in and sends the new-device email when it applies. */
  signIn: (user: AuditUser, request: RequestInfo, method: SignInMethod) => Promise<void>;
  /** Sends an email; a missing SMTP configuration or a delivery failure is logged, not thrown. */
  notify: (message: MailMessage) => Promise<void>;
}

export interface AuditDeps {
  readonly events: Pick<SecurityEvents, 'append' | 'signInHistory'>;
  readonly mailer: Mailer;
  readonly logger: AuthLogger;
  /** `deriveKey(AUTH_SECRET, 'ip_hash')`. */
  readonly ipKey: Uint8Array;
  /** `deriveKey(AUTH_SECRET, 'device')`. */
  readonly deviceKey: Uint8Array;
  readonly instanceName: () => Promise<string>;
  /** Settings › Security, linked from the new-device email. */
  readonly securityUrl: string;
  readonly now: () => Date;
}

export function createAudit(deps: AuditDeps): Audit {
  const { events, mailer, logger, ipKey, deviceKey } = deps;

  const record: Audit['record'] = (userId, type, { ip, userAgent }, meta = {}) =>
    events.append(userId, { type, ipHash: ip === null ? null : hmacSha256Hex(ipKey, ip), userAgent, meta });

  const notify: Audit['notify'] = async (message) => {
    try {
      await mailer.send(message);
    } catch (error) {
      if (error instanceof MailNotConfiguredError) {
        logger.info({ email: message.template.kind }, 'Email not sent: SMTP is not configured');
      } else {
        logger.error({ email: message.template.kind, err: error }, 'Email could not be sent');
      }
    }
  };

  return {
    record,
    notify,
    signIn: async (user, request, method) => {
      const device = deviceFingerprint(deviceKey, request.userAgent, request.ip);
      const { hasSignedIn, knownDevice } = await events.signInHistory(user.id, device);
      const newDevice = hasSignedIn && !knownDevice;
      await record(user.id, 'sign_in', request, { method, device, newDevice });
      if (!newDevice) return;
      await notify({
        to: user.email,
        template: {
          kind: 'new_device_sign_in',
          device: describeDevice(request.userAgent),
          at: deps.now(),
          timeZone: user.timezone,
          url: deps.securityUrl,
        },
        context: { locale: user.locale, instanceName: await deps.instanceName(), recipientName: user.name },
      });
    },
  };
}
