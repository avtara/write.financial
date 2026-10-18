// SPDX-License-Identifier: AGPL-3.0-only
import { decryptText, encrypt, type CipherAad } from '@wf/crypto/cipher';
import { generateDek, unwrapDek, wrapDek, type Dek } from '@wf/crypto/envelope';
import type { Keyring } from '@wf/crypto/keyring';
import type { Locale } from '@wf/i18n/locale';
import { isNotNull, sql } from 'drizzle-orm';
import { firstRow, withUser, type Transaction, type Database } from './db.ts';
import { instanceSettings } from './schema.ts';
import { INSTANCE_KEY_OWNER } from './user-keys.ts';

export type RegistrationMode = (typeof instanceSettings.registrationMode.enumValues)[number];

export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  /** Implicit TLS (usually port 465); otherwise STARTTLS. */
  readonly secure: boolean;
  readonly username: string | null;
  /** Sender, `addr@example.com` or `Name <addr@example.com>`. */
  readonly from: string;
}

export interface InstanceSettings {
  readonly instanceName: string;
  readonly publicUrl: string | null;
  readonly defaultLocale: Locale;
  readonly defaultTimezone: string;
  readonly registrationMode: RegistrationMode;
  readonly setupCompletedAt: Date | null;
  /** The SMTP password is never returned here; see `smtpPassword()`. */
  readonly smtp: (SmtpSettings & { readonly hasPassword: boolean }) | null;
}

export interface SetupInput {
  readonly instanceName: string;
  readonly publicUrl: string;
  readonly defaultLocale: Locale;
  readonly defaultTimezone: string;
  readonly registrationMode: RegistrationMode;
  /**
   * `null` removes the SMTP configuration. `password`: a string replaces it, `null` removes it, and leaving it out
   * keeps the stored one (the form never receives the old value).
   */
  readonly smtp: (SmtpSettings & { readonly password?: string | null }) | null;
}

/** The caller is not an admin: Row-Level Security lets only admins update instance settings or invite users. */
export class NotAdminError extends Error {
  override readonly name = 'NotAdminError';

  constructor(action = 'change instance settings') {
    super(`Only an admin can ${action}`);
  }
}

export interface InstanceSettingsRepository {
  /** Readable without a user (sign-in page, registration mode, mailer). */
  get: () => Promise<InstanceSettings>;
  /**
   * Saves the first-run setup wizard (FR-OP1) or later edits, as `adminUserId` from the session, and records when
   * setup was first completed. The SMTP password is encrypted with the instance DEK, which is created on first use.
   * @throws {NotAdminError} if `adminUserId` is not an admin.
   */
  updateSetup: (adminUserId: string, input: SetupInput) => Promise<InstanceSettings>;
  /** The decrypted SMTP password for the mailer, or `null` when none is stored. */
  smtpPassword: () => Promise<string | null>;
}

const SMTP_PASSWORD_AAD: CipherAad = { userId: INSTANCE_KEY_OWNER, purpose: 'instance_settings.smtp_password' };

/** Public view of the row; the SMTP object is assembled in SQL, where the table's checks guarantee its shape. */
const VIEW = {
  instanceName: instanceSettings.instanceName,
  publicUrl: instanceSettings.publicUrl,
  defaultLocale: instanceSettings.defaultLocale,
  defaultTimezone: instanceSettings.defaultTimezone,
  registrationMode: instanceSettings.registrationMode,
  setupCompletedAt: instanceSettings.setupCompletedAt,
  smtp: sql<InstanceSettings['smtp']>`case when ${instanceSettings.smtpHost} is null then null else jsonb_build_object(
    'host', ${instanceSettings.smtpHost}, 'port', ${instanceSettings.smtpPort}, 'secure', ${instanceSettings.smtpSecure},
    'username', ${instanceSettings.smtpUsername}, 'from', ${instanceSettings.smtpFrom},
    'hasPassword', ${instanceSettings.smtpPasswordEnc} is not null) end`,
};

export function createInstanceSettings(db: Database, keyring: Keyring): InstanceSettingsRepository {
  /** The instance DEK; the first caller's freshly wrapped DEK wins, concurrent callers get the same one. */
  const instanceDek = async (tx: Transaction): Promise<Dek> => {
    const candidate = wrapDek(generateDek(), keyring, INSTANCE_KEY_OWNER);
    const [row] = await tx
      .update(instanceSettings)
      .set({ instanceDekWrapped: sql`coalesce(${instanceSettings.instanceDekWrapped}, ${candidate})` })
      .returning({ wrapped: sql<Uint8Array>`${instanceSettings.instanceDekWrapped}` });
    if (row === undefined) throw new NotAdminError();
    return unwrapDek(row.wrapped, keyring, INSTANCE_KEY_OWNER);
  };

  return {
    get: async () => firstRow(await db.select(VIEW).from(instanceSettings), 'instance_settings'),

    updateSetup: (adminUserId, input) =>
      withUser(db, adminUserId, async (tx) => {
        const { smtp } = input;
        const password = smtp === null ? null : smtp.password;
        const smtpPasswordEnc =
          typeof password === 'string' ? encrypt(await instanceDek(tx), password, SMTP_PASSWORD_AAD) : password;
        const [row] = await tx
          .update(instanceSettings)
          .set({
            instanceName: input.instanceName,
            publicUrl: input.publicUrl,
            defaultLocale: input.defaultLocale,
            defaultTimezone: input.defaultTimezone,
            registrationMode: input.registrationMode,
            setupCompletedAt: sql`coalesce(${instanceSettings.setupCompletedAt}, now())`,
            smtpHost: smtp?.host ?? null,
            smtpPort: smtp?.port ?? null,
            smtpSecure: smtp?.secure ?? false,
            smtpUsername: smtp?.username ?? null,
            smtpFrom: smtp?.from ?? null,
            ...(smtpPasswordEnc === undefined ? {} : { smtpPasswordEnc }),
          })
          .returning(VIEW);
        if (row === undefined) throw new NotAdminError();
        return row;
      }),

    smtpPassword: async () => {
      const [row] = await db
        .select({
          enc: sql<Uint8Array>`${instanceSettings.smtpPasswordEnc}`,
          wrapped: sql<Uint8Array>`${instanceSettings.instanceDekWrapped}`,
        })
        .from(instanceSettings)
        .where(isNotNull(instanceSettings.smtpPasswordEnc));
      if (row === undefined) return null;
      return decryptText(unwrapDek(row.wrapped, keyring, INSTANCE_KEY_OWNER), row.enc, SMTP_PASSWORD_AAD);
    },
  };
}
