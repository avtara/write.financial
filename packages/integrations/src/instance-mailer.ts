// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Outgoing mail of the web process and the worker. SMTP comes from the instance settings when the admin configured it
 * in the setup wizard (FR-OP1), otherwise from the environment (`SMTP_URL`/`MAIL_FROM`); without either, sending throws
 * `MailNotConfiguredError`, which each caller handles (the auth module logs it, the `notify` job records it).
 */
import type { Config } from '@wf/config';
import { createMailer, type MailMessage, type Mailer } from './mailer.ts';

/** The SMTP part of the instance settings (`@wf/db/instance-settings`), without the password. */
export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  /** Implicit TLS (usually port 465); otherwise STARTTLS. */
  readonly secure: boolean;
  readonly username: string | null;
  /** Sender, `addr@example.com` or `Name <addr@example.com>`. */
  readonly from: string;
}

/** SMTP settings plus the password, as entered in the wizard or decrypted from the instance settings. */
export interface SmtpConnection extends SmtpSettings {
  readonly password: string | null;
}

/** `smtp(s)://user:password@host:port`; user and password are percent-encoded, IPv6 hosts bracketed. */
export function smtpUrl({ host, port, secure, username, password }: SmtpConnection): string {
  const auth =
    username === null
      ? ''
      : `${encodeURIComponent(username)}${password === null ? '' : `:${encodeURIComponent(password)}`}@`;
  return `${secure ? 'smtps' : 'smtp'}://${auth}${host.includes(':') ? `[${host}]` : host}:${port}`;
}

/** Sends one message through `connection` and closes the transport again. */
export async function sendWith(connection: SmtpConnection, message: MailMessage): Promise<void> {
  const mailer = createMailer({ smtpUrl: smtpUrl(connection), from: connection.from });
  try {
    await mailer.send(message);
  } finally {
    mailer.close();
  }
}

/** The saved instance SMTP settings with the decrypted password, or `null` when none are saved. */
export function instanceSmtp(store: {
  readonly get: () => Promise<{ readonly smtp: (SmtpSettings & { readonly hasPassword: boolean }) | null }>;
  readonly smtpPassword: () => Promise<string | null>;
}): () => Promise<SmtpConnection | null> {
  return async () => {
    const { smtp } = await store.get();
    if (smtp === null) return null;
    const { hasPassword, ...settings } = smtp;
    return { ...settings, password: hasPassword ? await store.smtpPassword() : null };
  };
}

export interface InstanceMailerDeps {
  /** `config.mail`. */
  readonly env: Config['mail'];
  readonly smtp: () => Promise<SmtpConnection | null>;
  readonly send: (connection: SmtpConnection, message: MailMessage) => Promise<void>;
}

export function createInstanceMailer({ env, smtp, send }: InstanceMailerDeps): Mailer {
  const fallback = createMailer(env);
  return {
    // The environment's SMTP; the instance SMTP is looked up on every send.
    configured: fallback.configured,
    send: async (message) => {
      const connection = await smtp();
      // Without any SMTP the fallback rejects with `MailNotConfiguredError`.
      await (connection === null ? fallback.send(message) : send(connection, message));
    },
    close: fallback.close,
  };
}
