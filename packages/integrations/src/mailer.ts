// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SMTP mailer (Nodemailer 10) for the transactional emails in `mail-templates.ts`. Every message carries an
 * HTML part and a plain-text alternative. Without SMTP configuration the mailer still exists but throws
 * {@link MailNotConfiguredError}, so each caller decides whether a missing email is fatal.
 */
import type { Config } from '@wf/config';
import { createTransport } from 'nodemailer';
import { renderEmail, type EmailContext, type EmailTemplate } from './mail-templates.ts';

export type { EmailContext, EmailTemplate } from './mail-templates.ts';

/**
 * One file attached to a message (FR-LP4 auto-send: the report PDF). Passed through to nodemailer; `content` is the
 * full file (the report's decrypted bytes never touch disk or a URL).
 */
export interface MailAttachment {
  readonly filename: string;
  readonly content: Buffer;
  readonly contentType?: string;
}

export interface MailMessage {
  /** Recipient address. */
  readonly to: string;
  readonly template: EmailTemplate;
  readonly context: EmailContext;
  /** Files to attach (default none). */
  readonly attachments?: readonly MailAttachment[];
}

export interface Mailer {
  /** Whether SMTP is configured; when `false`, `send` always throws {@link MailNotConfiguredError}. */
  readonly configured: boolean;
  /** Renders `message` in its locale and sends it. */
  send: (message: MailMessage) => Promise<void>;
  /** Closes pooled SMTP connections (process shutdown). */
  close: () => void;
}

/** SMTP is not configured (`SMTP_URL`/`MAIL_FROM` unset), so no email can be sent. */
export class MailNotConfiguredError extends Error {
  override readonly name = 'MailNotConfiguredError';

  constructor() {
    super('Email is not configured: set SMTP_URL and MAIL_FROM');
  }
}

/** A mailer for `config.mail`; `null` gives one whose `send` throws {@link MailNotConfiguredError}. */
export function createMailer(mail: Config['mail']): Mailer {
  if (mail === null) {
    return {
      configured: false,
      send: () => Promise.reject(new MailNotConfiguredError()),
      close: () => undefined,
    };
  }
  const transport = createTransport(mail.smtpUrl);
  return {
    configured: true,
    send: async ({ to, template, context, attachments }) => {
      const { subject, html, text } = await renderEmail(template, context);
      await transport.sendMail({
        from: mail.from,
        to,
        subject,
        html,
        text,
        ...(attachments === undefined ? {} : { attachments: [...attachments] }),
      });
    },
    close: () => {
      transport.close();
    },
  };
}
