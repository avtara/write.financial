// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The first-run setup wizard (FR-OP1, PRD §9.1 secure self-host defaults). It opens only with the one-time setup
 * token (`SETUP_TOKEN`, printed by the self-host `init` as `<PUBLIC_URL>/setup?token=…`), compared in constant time
 * and then kept in an httpOnly cookie for the following steps, and only until setup is complete; otherwise the page
 * answers like an unknown one. Steps:
 * 1. `admin`: create the first admin (`createFirstAdmin`), then sign in as it.
 * 2. `two-factor`: mandatory TOTP enrollment with backup codes.
 * 3. `instance`: instance name, public URL, default language and time zone, SMTP (optional, with a test email),
 *    and registration mode (`closed` by default), saved with `instanceSettings.updateSetup` as the admin.
 * A returning operator whose admin exists but who is signed out gets `sign-in` first.
 */
import type { AuthSession } from '@wf/auth/auth';
import { constantTimeEqual } from '@wf/crypto/hash';
import { redactText } from '@wf/crypto/redact';
import type { InstanceSettings, RegistrationMode, SetupInput } from '@wf/db/instance-settings';
import { isTimeZone } from '@wf/db/profiles';
import { LOCALES, type Locale } from '@wf/i18n/locale';
import type { MailMessage } from '@wf/integrations/mailer';
import * as z from 'zod';
import { ForbiddenError } from './access.ts';
import { parseCookies } from '../lib/preferences.ts';
import type { SmtpConnection } from './mailer.ts';

/** httpOnly cookie that carries the setup token between the wizard's requests. */
export const SETUP_COOKIE = 'wf_setup';
/** A day is plenty for one wizard run; `init` prints the URL again on every start until setup is complete. */
export const SETUP_COOKIE_MAX_AGE = 24 * 60 * 60;

export type SetupStep = 'admin' | 'sign-in' | 'two-factor' | 'instance';

/** What the instance step starts from: the saved settings, never the SMTP password. */
export interface InstanceDraft {
  readonly instanceName: string;
  readonly publicUrl: string;
  readonly defaultLocale: Locale;
  readonly defaultTimezone: string;
  readonly registrationMode: RegistrationMode;
  readonly smtp: InstanceSettings['smtp'];
}

export type SetupState =
  /** No token, a wrong one, no token configured, or setup already complete: the page is "not found". */
  { readonly status: 'closed' } | { readonly status: 'open'; readonly step: SetupStep; readonly draft: InstanceDraft };

/** Constant-time comparison; `false` when no token is configured or none was presented. */
export function tokenMatches(expected: string | null, candidate: string | null | undefined): boolean {
  if (expected === null || candidate === undefined || candidate === null || candidate === '') return false;
  return constantTimeEqual(expected, candidate);
}

/** The setup token from the request's cookie, if any. */
export function setupToken(headers: Headers): string | undefined {
  const value = parseCookies(headers.get('cookie') ?? '').get(SETUP_COOKIE);
  return value === undefined ? undefined : decodeURIComponent(value);
}

/** `Set-Cookie` value for the setup token (`maxAge` 0 deletes it). */
export function setupCookie(token: string, secure: boolean, maxAge = SETUP_COOKIE_MAX_AGE): string {
  const attributes = [`${SETUP_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', `Max-Age=${maxAge}`, 'HttpOnly'];
  attributes.push('SameSite=Strict');
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export interface SetupDeps {
  /** `config.setup.token`. */
  readonly token: string | null;
  /** `config.publicUrl`, the draft's public URL until one is saved. */
  readonly publicUrl: string;
  readonly hasAdmin: () => Promise<boolean>;
  readonly instance: () => Promise<InstanceSettings>;
  readonly session: () => Promise<AuthSession | null>;
}

export async function setupState(deps: SetupDeps, candidate: string | null | undefined): Promise<SetupState> {
  if (!tokenMatches(deps.token, candidate)) return { status: 'closed' };
  const settings = await deps.instance();
  if (settings.setupCompletedAt !== null) return { status: 'closed' };
  const draft: InstanceDraft = {
    instanceName: settings.instanceName,
    publicUrl: settings.publicUrl ?? deps.publicUrl,
    defaultLocale: settings.defaultLocale,
    defaultTimezone: settings.defaultTimezone,
    registrationMode: settings.registrationMode,
    smtp: settings.smtp,
  };
  if (!(await deps.hasAdmin())) return { status: 'open', step: 'admin', draft };
  const session = await deps.session();
  if (session?.user.role !== 'admin') return { status: 'open', step: 'sign-in', draft };
  return { status: 'open', step: session.user.twoFactorEnabled === true ? 'instance' : 'two-factor', draft };
}

/**
 * @throws {ForbiddenError} unless the wizard is open at `step`.
 */
export async function requireStep(deps: SetupDeps, candidate: string | null | undefined, step: SetupStep) {
  const state = await setupState(deps, candidate);
  if (state.status !== 'open' || state.step !== step) throw new ForbiddenError();
  return state;
}

export const adminInput = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(320),
  password: z.string().min(1).max(128),
  locale: z.enum(LOCALES),
});

/** `addr@example.com` or `Name <addr@example.com>` (like `MAIL_FROM`). */
const mailbox = z
  .string()
  .trim()
  .max(320)
  .refine((value) => z.email().safeParse(/<([^<>]+)>$/.exec(value)?.[1] ?? value).success);

export const smtpInput = z.object({
  host: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[A-Za-z0-9.:-]+$/),
  port: z.number().int().min(1).max(65_535),
  secure: z.boolean(),
  username: z.string().trim().min(1).max(256).nullable(),
  /** A string replaces the stored password, `null` removes it, leaving it out keeps it. */
  password: z.string().min(1).max(1024).nullable().optional(),
  from: mailbox,
});

export const instanceInput = z.object({
  instanceName: z.string().trim().min(1).max(100),
  publicUrl: z.url({ protocol: /^https?$/ }).max(2048),
  defaultLocale: z.enum(LOCALES),
  defaultTimezone: z.string().refine(isTimeZone),
  registrationMode: z.enum(['closed', 'open', 'invite']),
  smtp: smtpInput.nullable(),
});

export type InstanceInput = z.infer<typeof instanceInput>;
export type SmtpInput = z.infer<typeof smtpInput>;

/** The repository input: `smtp.password` is passed on only when the form sent one (or `null` to remove it). */
export function toSetupInput(input: InstanceInput): SetupInput {
  const { smtp, ...rest } = input;
  if (smtp === null) return { ...rest, smtp: null };
  const { password, ...settings } = smtp;
  return { ...rest, smtp: password === undefined ? settings : { ...settings, password } };
}

/** The test email could not be sent; `detail` is the SMTP error (secrets redacted) for the admin. */
export class MailFailedError extends Error {
  override readonly name = 'MailFailedError';
  readonly code = 'MAIL_FAILED';
  readonly detail: string;

  constructor(cause: unknown) {
    super('The test email could not be sent');
    this.detail = redactText(cause instanceof Error ? cause.message : String(cause)).slice(0, 300);
  }
}

export interface TestMailDeps {
  readonly send: (connection: SmtpConnection, message: MailMessage) => Promise<void>;
  /** The stored SMTP password, used when the form left the password field empty. */
  readonly storedPassword: () => Promise<string | null>;
}

/**
 * Sends the "Kirim email uji" message with SMTP settings that may not be saved yet, to the admin's own address.
 * @throws {MailFailedError}
 */
export async function sendTestEmail(
  deps: TestMailDeps,
  smtp: SmtpInput,
  to: { readonly email: string; readonly name: string; readonly locale: Locale },
  instance: { readonly instanceName: string; readonly publicUrl: string },
): Promise<void> {
  const { password, ...settings } = smtp;
  const connection: SmtpConnection = {
    ...settings,
    password: password === undefined ? await deps.storedPassword() : password,
  };
  try {
    await deps.send(connection, {
      to: to.email,
      template: { kind: 'smtp_test', url: instance.publicUrl },
      context: { locale: to.locale, instanceName: instance.instanceName, recipientName: to.name },
    });
  } catch (error) {
    throw new MailFailedError(error);
  }
}
