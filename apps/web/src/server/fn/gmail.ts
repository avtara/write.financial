// SPDX-License-Identifier: AGPL-3.0-only
/** Separate Gmail consent and settings. Ordinary sign-in never requests Gmail access. */
import { createServerFn } from '@tanstack/react-start';
import { GmailRevokedError, gmailConsentUrl } from '@wf/integrations/gmail';
import type { EmailLogView, GmailConnectionView, GmailMonthlyStats } from '@wf/db/gmail';
import { LedgerError } from '@wf/db/ledger-errors';
import { filterEmail, type GmailFilterResult, type GmailFilters } from '@wf/domain/gmail';
import type { LocalDate } from '@wf/domain/period';
import { zonedInstant } from '@wf/domain/recurrence';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import { services } from '../runtime.ts';

/** Thrown when Google reported the grant gone during the filter dry run (`EXPECTED_CODES`). */
class GmailRevokedRefusal extends Error {
  override readonly name = 'GmailRevokedRefusal';
  readonly code = 'GMAIL_REVOKED';

  constructor() {
    super('The Gmail permission was revoked');
  }
}

/** Settings › Gmail's data: the card renders it all (design `bCdNA`, `D6NOl8`). */
export interface GmailSettings {
  /** Whether the instance configured Gmail (`GOOGLE_*` env; the card explains the flag when not). */
  readonly configured: boolean;
  /** The user's connection, or `null` without one ("Lanjutkan dengan Google"). */
  readonly connection: GmailConnectionView | null;
  /** The half-open local month's counters ("bulan ini"). */
  readonly stats: GmailMonthlyStats;
  /** The ingest log, newest first. */
  readonly log: EmailLogView[];
}

/** One "Uji filter" row (design `DS1LC`): sender · subject · verdict — nothing of it is stored. */
export interface GmailFilterTestRow {
  readonly fromAddr: string;
  readonly subject: string;
  readonly verdict: GmailFilterResult;
}

/** How many emails the filter test dry-runs (design: the last 5). */
export const GMAIL_TEST_EMAILS = 5;

/** How many log rows the card shows (the CSV exports the same window). */
export const GMAIL_LOG_LIMIT = 50;

const FILTER_INPUT = z.strictObject({
  senders: z.array(z.string().trim().min(3).max(254)).max(50),
  keywords: z.array(z.string().trim().min(1).max(100)).max(50),
  ignoreKeywords: z.array(z.string().trim().min(1).max(100)).max(50),
});

/** The half-open month `[from, to)` around `at` in `timeZone`, as the monthly stats count them. */
export function localMonth(at: Date, timeZone: string): { readonly from: Date; readonly to: Date } {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);
  const [year, month] = today.split('-').map(Number) as [number, number];
  const start = (yearOf: number, monthOf: number): LocalDate =>
    `${String(yearOf).padStart(4, '0')}-${String(monthOf).padStart(2, '0')}-01` as LocalDate;
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return {
    from: zonedInstant(start(year, month), '00:00', timeZone),
    to: zonedInstant(start(next.year, next.month), '00:00', timeZone),
  };
}

/** The "Gmail" section's data. */
export const getGmailSettings = createServerFn({ method: 'GET' })
  .validator(z.object({}))
  .handler(({ context }): Promise<Result<GmailSettings>> =>
    attempt(async () => {
      const s = await services();
      const now = s.now();
      const { user } = await requireSession(context.session, {}, now);
      const connection = await s.gmail.getConnection(user.id);
      const month = localMonth(now, user.timezone ?? 'Asia/Jakarta');
      return {
        configured: s.config.google?.gmail != null,
        connection,
        stats: await s.gmail.monthlyStats(user.id, month),
        log: await s.gmail.listLogs(user.id, { limit: GMAIL_LOG_LIMIT }),
      };
    }),
  );

/** Saves the three filter lists ("Simpan perubahan"); refusing `NOT_FOUND` without a connection. */
export const updateFilters = createServerFn({ method: 'POST' })
  .validator(FILTER_INPUT)
  .handler(async ({ context, data }): Promise<Result<GmailConnectionView>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, s.now());
      const filters: GmailFilters = {
        senders: data.senders,
        keywords: data.keywords,
        ignoreKeywords: data.ignoreKeywords,
      };
      return s.gmail.updateFilters(user.id, filters);
    });
  });

/**
 * "Uji filter": the last {@link GMAIL_TEST_EMAILS} emails through the filter, dry (nothing is stored, no extraction).
 * A revoked grant marks the connection and answers `GMAIL_REVOKED`.
 */
export const testFilters = createServerFn({ method: 'POST' })
  .validator(FILTER_INPUT)
  .handler(async ({ context, data }): Promise<Result<GmailFilterTestRow[]>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, s.now());
      if (s.config.google?.gmail == null) throw new LedgerError('NOT_FOUND', 'Gmail is disabled');
      const connection = await s.gmail.getConnection(user.id);
      if (connection === null || connection.status !== 'connected')
        throw new LedgerError('NOT_FOUND', 'No Gmail connection');
      const tokens = await s.gmail.tokens(user.id);
      if (tokens === null) throw new LedgerError('NOT_FOUND', 'No Gmail tokens');
      let page;
      try {
        page = await s.gmailFetch.listMessages(tokens, null, {
          latest: GMAIL_TEST_EMAILS,
          assertCurrent: () => s.gmail.assertCurrent(user.id, connection.grantId),
          onRefresh: (fresh) => s.gmail.rotateTokens(user.id, connection.grantId, fresh),
        });
      } catch (error) {
        if (!(error instanceof GmailRevokedError)) throw error;
        await s.gmail.markRevoked(user.id, connection.grantId);
        throw new GmailRevokedRefusal();
      }
      return page.messages.slice(0, GMAIL_TEST_EMAILS).map((message) => ({
        fromAddr: message.from,
        subject: message.subject,
        verdict: filterEmail(message.from, `${message.subject} ${message.excerpt}`, data),
      }));
    });
  });

/** "Putuskan" (and the revoked state's reset): the connection reads as revoked until "Hubungkan lagi". */
export const disconnectGmail = createServerFn({ method: 'POST' })
  .validator(z.object({}))
  .handler(async ({ context }): Promise<Result<GmailConnectionView>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, s.now());
      const connection = await s.gmail.getConnection(user.id);
      if (connection === null) throw new LedgerError('NOT_FOUND', 'No Gmail connection');
      const tokens = await s.gmail.tokens(user.id);
      const revoked = await s.gmail.markRevoked(user.id, connection.grantId);
      if (tokens !== null && s.config.google?.gmail != null) await s.gmailFetch.revoke(tokens).catch(() => undefined);
      return revoked;
    });
  });

/** Explicit, current-2FA and fresh-session consent. PKCE and state never enter a queue or log. */
export const startGmailConnect = createServerFn({ method: 'POST' })
  .validator(z.strictObject({ consent: z.literal(true) }))
  .handler(async ({ context }): Promise<Result<{ readonly url: string }>> => {
    const s = await services();
    return attempt(async () => {
      const current = await requireSession(context.session, { twoFactor: true, fresh: true }, s.now());
      if (s.config.google?.gmail == null) throw new LedgerError('NOT_FOUND', 'Gmail is disabled');
      const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      await s.gmail.createConsent(current.user.id, state, current.session.id, verifier);
      return {
        url: await gmailConsentUrl(
          s.config.google.clientId,
          new URL('/api/gmail/callback', s.config.publicUrl).href,
          state,
          verifier,
        ),
      };
    });
  });

const CSV_HEADER = 'waktu,pengirim,subjek,filter,ai,status,extraction,processing,error';

/** RFC 4180: a field with a quote, comma, or newline is wrapped in quotes and its quotes are doubled. */
const csvField = (value: string): string => {
  const safe = /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /["\r\n,]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/**
 * The ingest log as a CSV document (`exportGmailLog`, served by `/api/gmail/log`): the same columns as the card's
 * table — waktu · pengirim · subjek · filter · AI (confidence) · status — never the excerpt or its extraction.
 */
export function gmailLogCsv(logs: readonly EmailLogView[]): string {
  return [
    CSV_HEADER,
    ...logs.map((log) =>
      [
        log.receivedAt.toISOString(),
        log.fromAddr,
        log.subject,
        log.filterResult,
        log.confidence === null ? '' : String(log.confidence),
        log.outcome,
        log.extraction === null
          ? ''
          : JSON.stringify(log.extraction, (_key, value: unknown) =>
              typeof value === 'bigint' ? value.toString() : value,
            ),
        log.processing,
        log.errorCode ?? '',
      ]
        .map((cell) => csvField(cell))
        .join(','),
    ),
  ].join('\r\n');
}
