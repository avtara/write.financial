// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Transactional emails (React Email 1.0), rendered in the recipient's locale with the `@wf/i18n` catalog
 * (D26). Every email has an HTML and a plain-text part, a single call to action, and the link spelled out for
 * clients that do not render buttons. Emails never contain amounts or other financial data.
 *
 * Written with `createElement` instead of JSX so the file runs under Node's type stripping (no build step).
 */
import { Body, Button, Container, Head, Hr, Html, Link, Preview, Section, Text, render } from '@react-email/components';
import { formatDateTime } from '@wf/i18n/format';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { createElement as h, type ReactElement } from 'react';

export type EmailTemplate =
  | { readonly kind: 'verify_email'; readonly url: string }
  | { readonly kind: 'password_reset'; readonly url: string; readonly expiresInMinutes: number }
  /** Password reset for an account that signs in only with Google (FR-A3). */
  | { readonly kind: 'set_password'; readonly url: string; readonly expiresInMinutes: number }
  | {
      readonly kind: 'new_device_sign_in';
      /** Short description, e.g. `Firefox · Linux`; `null` when the device sent no user agent. */
      readonly device: string | null;
      readonly at: Date;
      readonly timeZone: string;
      /** Settings › Security, where the device can be signed out. */
      readonly url: string;
    }
  | {
      readonly kind: 'invitation';
      readonly url: string;
      readonly inviterName: string;
      readonly expiresAt: Date;
      readonly timeZone: string;
    }
  /** "Kirim email uji" in the setup wizard (FR-OP1): proves the SMTP settings work; links to the instance. */
  | { readonly kind: 'smtp_test'; readonly url: string };

export interface EmailContext {
  readonly locale: Locale;
  /** `instance_settings.instance_name`. */
  readonly instanceName: string;
  /** The recipient's name for the greeting; `null` when unknown (invitations). */
  readonly recipientName: string | null;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** A link in an email is not an absolute `http(s)` URL. */
export class InvalidEmailLinkError extends RangeError {
  override readonly name = 'InvalidEmailLinkError';

  constructor() {
    super('Email links must be absolute http(s) URLs');
  }
}

interface Content {
  readonly subject: string;
  readonly paragraphs: readonly string[];
  readonly action: { readonly label: string; readonly url: string };
  readonly hint: string;
}

function content(template: EmailTemplate, { locale, instanceName }: EmailContext): Content {
  const o = { locale };
  switch (template.kind) {
    case 'verify_email':
      return {
        subject: m.email_verify_subject({}, o),
        paragraphs: [m.email_verify_body({}, o)],
        action: { label: m.email_verify_action({}, o), url: template.url },
        hint: m.email_ignore_hint({}, o),
      };
    case 'password_reset':
      return {
        subject: m.email_reset_subject({}, o),
        paragraphs: [m.email_reset_body({ minutes: template.expiresInMinutes }, o)],
        action: { label: m.email_reset_action({}, o), url: template.url },
        hint: m.email_ignore_hint({}, o),
      };
    case 'set_password':
      return {
        subject: m.email_set_password_subject({}, o),
        paragraphs: [m.email_set_password_body({ minutes: template.expiresInMinutes }, o)],
        action: { label: m.email_set_password_action({}, o), url: template.url },
        hint: m.email_ignore_hint({}, o),
      };
    case 'new_device_sign_in':
      return {
        subject: m.email_new_device_subject({}, o),
        paragraphs: [
          m.email_new_device_body(
            {
              device: template.device ?? m.email_device_unknown({}, o),
              time: formatDateTime(template.at, locale, template.timeZone),
            },
            o,
          ),
        ],
        action: { label: m.email_new_device_action({}, o), url: template.url },
        hint: m.email_new_device_hint({}, o),
      };
    case 'invitation':
      return {
        subject: m.email_invitation_subject({ instance: instanceName }, o),
        paragraphs: [
          m.email_invitation_body(
            {
              inviter: template.inviterName,
              instance: instanceName,
              expires: formatDateTime(template.expiresAt, locale, template.timeZone),
            },
            o,
          ),
        ],
        action: { label: m.email_invitation_action({}, o), url: template.url },
        hint: m.email_ignore_hint({}, o),
      };
    case 'smtp_test':
      return {
        subject: m.email_smtp_test_subject({ instance: instanceName }, o),
        paragraphs: [m.email_smtp_test_body({ instance: instanceName }, o)],
        action: { label: m.email_smtp_test_action({}, o), url: template.url },
        hint: m.email_smtp_test_hint({}, o),
      };
  }
}

const BODY = { backgroundColor: '#f4f4f5', fontFamily: 'Helvetica, Arial, sans-serif', margin: 0, padding: '24px 0' };
const CARD = { backgroundColor: '#ffffff', borderRadius: '8px', maxWidth: '520px', padding: '32px' };
const TEXT = { color: '#18181b', fontSize: '15px', lineHeight: '24px' };
const MUTED = { color: '#71717a', fontSize: '13px', lineHeight: '20px' };
const BUTTON = {
  backgroundColor: '#18181b',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 600,
  padding: '12px 20px',
};

function layout(c: Content, context: EmailContext): ReactElement {
  const o = { locale: context.locale };
  const { url, label } = c.action;
  return h(
    Html,
    { lang: context.locale },
    h(Head),
    h(Preview, null, c.subject),
    h(
      Body,
      { style: BODY },
      h(
        Container,
        { style: CARD },
        context.recipientName === null
          ? null
          : h(Text, { style: TEXT }, m.email_greeting({ name: context.recipientName }, o)),
        ...c.paragraphs.map((paragraph) => h(Text, { key: paragraph, style: TEXT }, paragraph)),
        h(Section, { style: { padding: '8px 0 16px' } }, h(Button, { href: url, style: BUTTON }, label)),
        h(Text, { style: MUTED }, m.email_link_fallback({}, o), h('br'), h(Link, { href: url }, url)),
        h(Text, { style: MUTED }, c.hint),
        h(Hr),
        h(Text, { style: MUTED }, m.email_footer({ instance: context.instanceName }, o)),
      ),
    ),
  );
}

/**
 * Subject, HTML, and plain text of `template` in `context.locale`.
 * @throws {InvalidEmailLinkError} if the call-to-action URL is not an absolute http(s) URL.
 */
export async function renderEmail(template: EmailTemplate, context: EmailContext): Promise<RenderedEmail> {
  const c = content(template, context);
  const protocol = URL.parse(c.action.url)?.protocol;
  if (protocol !== 'https:' && protocol !== 'http:') throw new InvalidEmailLinkError();
  const element = layout(c, context);
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: c.subject, html, text };
}
