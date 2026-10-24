// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Transactional emails (React Email 1.0), rendered in the recipient's locale with the `@wf/i18n` catalog
 * (D26). Every email has an HTML and a plain-text part, a single call to action, and the link spelled out for
 * clients that do not render buttons. Emails carry no financial data, except the amounts of a bill reminder or of a
 * notification emailed at the user's request, and only when the recipient's privacy mode is off (the worker leaves
 * them out of the outbox payload otherwise).
 *
 * Written with `createElement` instead of JSX so the file runs under Node's type stripping (no build step).
 */
import { Body, Button, Container, Head, Hr, Html, Link, Preview, Section, Text, render } from '@react-email/components';
import { BUILT_IN_PREFIX } from '@wf/domain/categories';
import { formatDate, formatDateTime, formatMoney } from '@wf/i18n/format';
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
  | { readonly kind: 'smtp_test'; readonly url: string }
  /** Bill reminder of a scheduled occurrence (FR-ST3, FR-SUB6); nothing is recorded until the user confirms it. */
  | {
      readonly kind: 'bill_reminder';
      /** Subscription or schedule name; a built-in category key (`system:bills`) is shown in the locale. */
      readonly name: string;
      /** `YYYY-MM-DD`. */
      readonly dueDate: string;
      /** `null` with privacy mode on. */
      readonly amount: { readonly amountMinor: bigint; readonly currency: string } | null;
      /** The app page to open (subscriptions, calendar). */
      readonly url: string;
    }
  /**
   * An in-app notification the user also wants by email (Settings › Notifikasi, FR-ST3): its message keys and params
   * (amounts `{ amountMinor, currency }` as strings, or `null` with privacy mode on; dates `YYYY-MM-DD`).
   */
  | {
      readonly kind: 'notification';
      readonly titleKey: string;
      readonly bodyKey: string;
      readonly params: Readonly<Record<string, unknown>>;
      /** The notification's page. */
      readonly url: string;
    }
  /**
   * FR-LP4 "Kirim otomatis": a stored report export (PDF) is attached to this message. The body names only the
   * report's label — the figures are in the attachment, and the email itself carries no financial data.
   */
  | {
      readonly kind: 'report_export';
      /** The report's label ("September 2026", "2026-Q3"). */
      readonly label: string;
      readonly url: string;
    };

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
    case 'bill_reminder': {
      const params = {
        name: displayName(template.name, locale),
        date: formatDate(new Date(`${template.dueDate}T00:00:00Z`), locale),
      };
      return {
        subject: m.email_bill_reminder_subject(params, o),
        paragraphs: [
          template.amount === null
            ? m.email_bill_reminder_body_private(params, o)
            : m.email_bill_reminder_body(
                {
                  ...params,
                  amount: formatMoney(template.amount.amountMinor, template.amount.currency, {
                    locale,
                    context: 'amount',
                  }),
                },
                o,
              ),
          m.email_bill_reminder_note({}, o),
        ],
        action: { label: m.email_bill_reminder_action({}, o), url: template.url },
        hint: m.email_bill_reminder_hint({}, o),
      };
    }
    case 'notification': {
      const params = Object.fromEntries(
        Object.entries(template.params).map(([key, value]) => [key, paramText(value, locale)]),
      );
      const title = messageOf(template.titleKey);
      const body = messageOf(template.bodyKey);
      return {
        subject: title === null ? m.email_notification_subject({ instance: instanceName }, o) : title(params, o),
        paragraphs: body === null ? [] : [body(params, o)],
        action: { label: m.email_notification_action({}, o), url: template.url },
        hint: m.email_notification_hint({}, o),
      };
    }
    case 'report_export':
      return {
        subject: m.email_report_subject({ label: template.label }, o),
        paragraphs: [m.email_report_body({ label: template.label }, o), m.email_report_note({}, o)],
        action: { label: m.email_report_action({}, o), url: template.url },
        hint: m.email_ignore_hint({}, o),
      };
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Shown for an amount privacy mode left out. */
const HIDDEN_AMOUNT = '••••';

/** A notification param as text: amounts formatted (or hidden), dates and built-in names in `locale`. */
function paramText(value: unknown, locale: Locale): string {
  if (value === null) return HIDDEN_AMOUNT;
  if (typeof value === 'object' && 'amountMinor' in value && 'currency' in value) {
    return formatMoney(BigInt(String(value.amountMinor)), String(value.currency), { locale, context: 'amount' });
  }
  if (typeof value === 'string') {
    return DATE.test(value) ? formatDate(new Date(`${value}T00:00:00Z`), locale) : displayName(value, locale);
  }
  // Counts and percentages; nothing else is a notification param.
  return typeof value === 'number' ? String(value) : '';
}

type MessageFn = (params: object, options: { locale: Locale }) => string;

/** The catalog message `key`, or `null` when there is none (a key from a newer version). */
function messageOf(key: string): MessageFn | null {
  const message = (m as unknown as Record<string, MessageFn | undefined>)[key];
  return message ?? null;
}

/** A built-in category key (`system:bills`, a schedule named after its category) in `locale`; other names as typed. */
function displayName(name: string, locale: Locale): string {
  if (!name.startsWith(BUILT_IN_PREFIX)) return name;
  const message = messageOf(`category_builtin_${name.slice(BUILT_IN_PREFIX.length)}`);
  return message === null ? name : message({}, { locale });
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
