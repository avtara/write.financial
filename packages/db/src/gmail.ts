// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from 'node:crypto';
import { decryptText, encrypt } from '@wf/crypto/cipher';
import type { Dek } from '@wf/crypto/envelope';
import {
  emptyGmailFilters,
  isGmailManualDuplicate,
  parseGmailExtraction,
  type GmailExtraction,
  type GmailFilterResult,
  type GmailFilters,
} from '@wf/domain/gmail';
import type { AiProvider } from '@wf/domain/ai';
import { evaluateRules } from '@wf/domain/rules';
import { parseLocalDate } from '@wf/domain/period';
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { firstRow, withUser, type Database } from './db.ts';
import { LedgerError } from './ledger-errors.ts';
import { insertReviewItemIn } from './review-items.ts';
import {
  accounts,
  aiSettings,
  autoRules,
  categories,
  emailIngestLogs,
  gmailConnections,
  gmailMessageKeys,
  gmailOauthStates,
  postings,
  securityEvents,
  transactions,
  users,
} from './schema.ts';

export const GMAIL_TOKENS_PURPOSE = 'gmail_connections.tokens';
export const GMAIL_QUOTE_PURPOSE = 'email_ingest_logs.quote';
export const GMAIL_EXTRACTION_PURPOSE = 'email_ingest_logs.extraction';
export interface GmailTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: Date;
}
export interface GmailConnectionView {
  readonly email: string;
  readonly grantId: string;
  readonly status: 'connected' | 'revoked';
  readonly filters: GmailFilters;
  readonly historyId: string | null;
  readonly watchRenewedAt: Date | null;
  readonly watchExpiresAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
export interface EmailLogView {
  readonly id: string;
  readonly messageId: string;
  readonly fromAddr: string;
  readonly subject: string;
  readonly filterResult: GmailFilterResult;
  readonly outcome: 'pending' | 'confirmed' | 'ignored' | 'duplicate' | 'filtered';
  readonly processing: 'queued' | 'extracting' | 'extracted' | 'done' | 'failed';
  readonly errorCode: string | null;
  readonly confidence: number | null;
  readonly extraction: GmailExtraction | null;
  readonly receivedAt: Date;
  readonly createdAt: Date;
  readonly reviewItemId: string | null;
}
export interface GmailMonthlyStats {
  readonly received: number;
  readonly passed: number;
  readonly pending: number;
  readonly confirmed: number;
  readonly ignored: number;
  readonly duplicate: number;
  readonly filtered: number;
}
export interface NewEmail {
  readonly messageId: string;
  readonly fromAddr: string;
  readonly subject: string;
  readonly excerpt: string;
  readonly receivedAt: Date;
  readonly filterResult: GmailFilterResult;
}
export interface GmailExtractionClaim {
  readonly provider: AiProvider;
  readonly revision: string;
  readonly timeZone: string;
  readonly evidence: { from: string; subject: string; excerpt: string; receivedAt: Date };
  readonly accounts: readonly { id: string; name: string; currency: string }[];
  readonly categories: readonly { id: string; name: string }[];
}
export interface GmailRepository {
  saveConnection: (
    userId: string,
    input: { email: string; tokens: GmailTokens; filters?: GmailFilters; expectedGrantId?: string | null },
  ) => Promise<GmailConnectionView>;
  getConnection: (userId: string) => Promise<GmailConnectionView | null>;
  updateFilters: (userId: string, filters: GmailFilters) => Promise<GmailConnectionView>;
  markRevoked: (userId: string, grantId?: string) => Promise<GmailConnectionView>;
  tokens: (userId: string) => Promise<GmailTokens | null>;
  assertCurrent: (userId: string, grantId: string) => Promise<void>;
  rotateTokens: (userId: string, grantId: string, tokens: GmailTokens) => Promise<void>;
  setWatch: (userId: string, grantId: string, expiresAt: Date) => Promise<void>;
  setHistoryId: (userId: string, historyId: string, grantId: string) => Promise<GmailConnectionView>;
  createConsent: (userId: string, state: string, sessionId: string, verifier: string) => Promise<void>;
  consumeConsent: (
    userId: string,
    state: string,
    sessionId: string,
  ) => Promise<{ verifier: string; grantId: string | null }>;
  targets: (email?: string) => Promise<{ userId: string }[]>;
  recordEmail: (userId: string, email: NewEmail) => Promise<{ id: string | null; duplicate: boolean }>;
  claimExtraction: (userId: string, id: string) => Promise<GmailExtractionClaim | null>;
  storeExtraction: (userId: string, id: string, evidence: string) => Promise<void>;
  failExtraction: (userId: string, id: string, code: string) => Promise<void>;
  complete: (userId: string, id: string) => Promise<'pending' | 'duplicate' | 'replay'>;
  listLogs: (
    userId: string,
    options?: { limit?: number; before?: { at: Date; id: string } },
  ) => Promise<EmailLogView[]>;
  monthlyStats: (userId: string, month: { from: Date; to: Date }) => Promise<GmailMonthlyStats>;
  purgeExpired: (before: Date) => Promise<number>;
  pending: (userId: string) => Promise<{ id: string }[]>;
}
const CONNECTION_VIEW = {
  email: gmailConnections.email,
  grantId: gmailConnections.grantId,
  status: gmailConnections.status,
  filters: gmailConnections.filters,
  historyId: gmailConnections.historyId,
  watchRenewedAt: gmailConnections.watchRenewedAt,
  watchExpiresAt: gmailConnections.watchExpiresAt,
  createdAt: gmailConnections.createdAt,
  updatedAt: gmailConnections.updatedAt,
};
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const EMPTY_EXTRACTION: GmailExtraction = {
  amountMinor: null,
  occurredAt: null,
  merchant: null,
  categoryId: null,
  accountId: null,
  currency: null,
  confidence: { amount: 0, date: 0, merchant: 0, category: 0, account: 0, currency: 0 },
};

export function createGmail(
  db: Database,
  {
    getDek,
    now = () => new Date(),
  }: {
    readonly getDek: (userId: string) => Promise<Dek>;
    readonly now?: () => Date;
  },
): GmailRepository {
  const aad = (userId: string, purpose: string, id: string) => ({ userId, purpose: `${purpose}.${id}` });
  const current = (userId: string, grantId?: string) =>
    and(
      eq(gmailConnections.userId, userId),
      eq(gmailConnections.status, 'connected'),
      grantId === undefined ? undefined : eq(gmailConnections.grantId, grantId),
    );
  return {
    async saveConnection(userId, input) {
      const dek = await getDek(userId);
      const grantId = randomUUID();
      const tokensEnc = encrypt(dek, JSON.stringify(input.tokens), aad(userId, GMAIL_TOKENS_PURPOSE, grantId));
      return withUser(db, userId, async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 19))`);
        const [existing] = await tx
          .select({ grantId: gmailConnections.grantId })
          .from(gmailConnections)
          .where(eq(gmailConnections.userId, userId))
          .for('update');
        if (input.expectedGrantId !== undefined && (existing?.grantId ?? null) !== input.expectedGrantId)
          throw new LedgerError('NOT_FOUND', 'Gmail consent superseded');
        const row = firstRow(
          await tx
            .insert(gmailConnections)
            .values({
              userId,
              email: input.email.toLowerCase(),
              grantId,
              tokensEnc,
              filters: input.filters ?? emptyGmailFilters(),
            })
            .onConflictDoUpdate({
              target: gmailConnections.userId,
              set: {
                email: input.email.toLowerCase(),
                grantId,
                tokensEnc,
                status: 'connected',
                historyId: null,
                watchExpiresAt: null,
                watchRenewedAt: null,
                updatedAt: now(),
              },
            })
            .returning(CONNECTION_VIEW),
          'gmail connection',
        );
        await tx.insert(securityEvents).values({ userId, type: 'gmail_connected', meta: {} });
        return row;
      });
    },
    getConnection: (userId) =>
      withUser(
        db,
        userId,
        async (tx) =>
          (await tx.select(CONNECTION_VIEW).from(gmailConnections).where(eq(gmailConnections.userId, userId)))[0] ??
          null,
      ),
    updateFilters: (userId, filters) =>
      withUser(db, userId, async (tx) => {
        const [row] = await tx
          .update(gmailConnections)
          .set({ filters, updatedAt: now() })
          .where(eq(gmailConnections.userId, userId))
          .returning(CONNECTION_VIEW);
        if (row === undefined) throw new LedgerError('NOT_FOUND', 'Gmail connection is not available');
        return row;
      }),
    markRevoked: (userId, grantId) =>
      withUser(db, userId, async (tx) => {
        // Destroy credentials before any remote revocation; late refreshes cannot resurrect this grant.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 19))`);
        const [row] = await tx
          .update(gmailConnections)
          .set({ status: 'revoked', grantId: randomUUID(), tokensEnc: null, watchExpiresAt: null, updatedAt: now() })
          .where(
            and(
              eq(gmailConnections.userId, userId),
              grantId === undefined ? undefined : eq(gmailConnections.grantId, grantId),
            ),
          )
          .returning(CONNECTION_VIEW);
        if (row !== undefined) await tx.insert(securityEvents).values({ userId, type: 'gmail_disconnected', meta: {} });
        return (
          row ??
          firstRow(
            await tx.select(CONNECTION_VIEW).from(gmailConnections).where(eq(gmailConnections.userId, userId)),
            'gmail connection',
          )
        );
      }),
    async tokens(userId) {
      const [row] = await withUser(db, userId, (tx) =>
        tx
          .select({ enc: gmailConnections.tokensEnc, grantId: gmailConnections.grantId })
          .from(gmailConnections)
          .where(current(userId)),
      );
      if (row?.enc == null) return null;
      const value = JSON.parse(
        decryptText(await getDek(userId), row.enc, aad(userId, GMAIL_TOKENS_PURPOSE, row.grantId)),
      ) as { accessToken: string; refreshToken: string | null; expiresAt: string };
      return { ...value, expiresAt: new Date(value.expiresAt) };
    },
    assertCurrent: (userId, grantId) =>
      withUser(db, userId, async (tx) => {
        if (
          (
            await tx
              .select({ id: gmailConnections.userId })
              .from(gmailConnections)
              .innerJoin(users, eq(users.id, gmailConnections.userId))
              .where(and(current(userId, grantId), eq(users.twoFactorEnabled, true)))
          ).length !== 1
        )
          throw new LedgerError('NOT_FOUND', 'Gmail grant is no longer current');
      }),
    async rotateTokens(userId, grantId, tokens) {
      const dek = await getDek(userId);
      await withUser(db, userId, async (tx) => {
        const rows = await tx
          .update(gmailConnections)
          .set({ tokensEnc: encrypt(dek, JSON.stringify(tokens), aad(userId, GMAIL_TOKENS_PURPOSE, grantId)) })
          .where(current(userId, grantId))
          .returning({ id: gmailConnections.userId });
        if (rows.length !== 1) throw new LedgerError('NOT_FOUND', 'Gmail grant is no longer current');
      });
    },
    setWatch: (userId, grantId, expiresAt) =>
      withUser(db, userId, async (tx) => {
        await tx
          .update(gmailConnections)
          .set({ watchExpiresAt: expiresAt, watchRenewedAt: now() })
          .where(current(userId, grantId));
      }),
    setHistoryId: (userId, historyId, grantId) =>
      withUser(db, userId, async (tx) =>
        firstRow(
          await tx
            .update(gmailConnections)
            .set({ historyId, updatedAt: now() })
            .where(
              and(
                current(userId, grantId),
                sql`(${gmailConnections.historyId} is null or ${gmailConnections.historyId}::numeric <= ${historyId}::numeric)`,
              ),
            )
            .returning(CONNECTION_VIEW),
          'gmail connection',
        ),
      ),
    async createConsent(userId, state, sessionId, verifier) {
      const dek = await getDek(userId);
      const stateHash = digest(state);
      await withUser(db, userId, async (tx) => {
        await tx.delete(gmailOauthStates).where(eq(gmailOauthStates.userId, userId));
        const [connection] = await tx
          .select({ grantId: gmailConnections.grantId })
          .from(gmailConnections)
          .where(eq(gmailConnections.userId, userId));
        await tx.insert(gmailOauthStates).values({
          userId,
          stateHash,
          sessionHash: digest(sessionId),
          grantId: connection?.grantId ?? null,
          verifierEnc: encrypt(dek, verifier, aad(userId, 'gmail_oauth_states', stateHash)),
          expiresAt: new Date(now().getTime() + 600_000),
        });
      });
    },
    async consumeConsent(userId, state, sessionId) {
      const stateHash = digest(state);
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        const [row] = await tx
          .delete(gmailOauthStates)
          .where(
            and(
              eq(gmailOauthStates.userId, userId),
              eq(gmailOauthStates.stateHash, stateHash),
              eq(gmailOauthStates.sessionHash, digest(sessionId)),
              gte(gmailOauthStates.expiresAt, now()),
            ),
          )
          .returning({ enc: gmailOauthStates.verifierEnc, grantId: gmailOauthStates.grantId });
        if (row === undefined) throw new LedgerError('NOT_FOUND', 'Consent expired or already used');
        return {
          verifier: decryptText(dek, row.enc, aad(userId, 'gmail_oauth_states', stateHash)),
          grantId: row.grantId,
        };
      });
    },
    async targets(email) {
      const rows = await db.execute<{ user_id: string }>(
        sql`select user_id from wf_gmail_targets(${email ?? null}::text)`,
      );
      return rows.map((row) => ({ userId: row.user_id }));
    },
    async recordEmail(userId, email) {
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        const { id } = firstRow(await tx.execute<{ id: string }>(sql`select uuidv7()::text as id`), 'email id');
        const [key] = await tx
          .insert(gmailMessageKeys)
          .values({ userId, messageId: email.messageId })
          .onConflictDoNothing()
          .returning({ messageId: gmailMessageKeys.messageId });
        if (key === undefined) {
          const [stored] = await tx
            .select({ id: emailIngestLogs.id })
            .from(emailIngestLogs)
            .where(eq(emailIngestLogs.messageId, email.messageId));
          return { id: stored?.id ?? null, duplicate: true };
        }
        const [row] = await tx
          .insert(emailIngestLogs)
          .values({
            id,
            userId,
            messageId: email.messageId,
            fromAddr: email.fromAddr.slice(0, 254),
            subject: email.subject.slice(0, 500),
            quoteEnc: encrypt(dek, email.excerpt.slice(0, 1000), aad(userId, GMAIL_QUOTE_PURPOSE, id)),
            receivedAt: email.receivedAt,
            filterResult: email.filterResult,
            outcome:
              email.filterResult === 'passed'
                ? 'pending'
                : email.filterResult === 'ignored_keyword'
                  ? 'ignored'
                  : 'filtered',
            processing: email.filterResult === 'passed' ? 'queued' : 'done',
          })
          .onConflictDoNothing({ target: [emailIngestLogs.userId, emailIngestLogs.messageId] })
          .returning({ id: emailIngestLogs.id });
        if (row !== undefined) return { id: row.id, duplicate: false };
        const stored = firstRow(
          await tx
            .select({ id: emailIngestLogs.id })
            .from(emailIngestLogs)
            .where(and(eq(emailIngestLogs.userId, userId), eq(emailIngestLogs.messageId, email.messageId))),
          'email',
        );
        return { id: stored.id, duplicate: true };
      });
    },
    pending: (userId) =>
      withUser(db, userId, (tx) =>
        tx
          .select({ id: emailIngestLogs.id })
          .from(emailIngestLogs)
          .where(inArray(emailIngestLogs.processing, ['queued', 'extracting', 'extracted', 'failed']))
          .orderBy(asc(emailIngestLogs.createdAt))
          .limit(100),
      ),
    async claimExtraction(userId, id) {
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        const row = firstRow(
          await tx.select().from(emailIngestLogs).where(eq(emailIngestLogs.id, id)).for('update'),
          'email',
        );
        if (row.processing !== 'queued') {
          if (
            row.processing === 'extracting' &&
            row.extractionStartedAt !== null &&
            now().getTime() - row.extractionStartedAt.getTime() >= 60_000
          )
            await tx
              .update(emailIngestLogs)
              .set({ processing: 'failed', errorCode: 'GMAIL_INTERRUPTED' })
              .where(eq(emailIngestLogs.id, id));
          return null;
        }
        const [settings] = await tx.select().from(aiSettings);
        if (settings === undefined) {
          await tx
            .update(emailIngestLogs)
            .set({ processing: 'failed', errorCode: 'AI_NOT_CONFIGURED' })
            .where(eq(emailIngestLogs.id, id));
          return null;
        }
        const user = firstRow(
          await tx.select({ timeZone: users.timezone }).from(users).where(eq(users.id, userId)),
          'user',
        );
        const ownedAccounts = await tx
          .select({ id: accounts.id, name: accounts.displayName, currency: accounts.currency })
          .from(accounts)
          .where(eq(accounts.status, 'active'))
          .orderBy(asc(accounts.createdAt));
        const ownedCategories = await tx
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(and(eq(categories.kind, 'expense'), isNull(categories.deletedAt), isNull(categories.archivedAt)));
        await tx
          .update(emailIngestLogs)
          .set({ processing: 'extracting', extractionStartedAt: now() })
          .where(eq(emailIngestLogs.id, id));
        return {
          provider: settings.provider,
          revision: settings.revision,
          timeZone: user.timeZone,
          evidence: {
            from: row.fromAddr,
            subject: row.subject,
            receivedAt: row.receivedAt,
            excerpt: decryptText(dek, row.quoteEnc, aad(userId, GMAIL_QUOTE_PURPOSE, id)),
          },
          accounts: ownedAccounts,
          categories: ownedCategories,
        };
      });
    },
    async storeExtraction(userId, id, evidence) {
      const extraction = parseGmailExtraction(evidence);
      const dek = await getDek(userId);
      await withUser(db, userId, (tx) =>
        tx
          .update(emailIngestLogs)
          .set({
            processing: 'extracted',
            extractionEnc: encrypt(
              dek,
              JSON.stringify(extraction, (_key, value: unknown) =>
                typeof value === 'bigint' ? value.toString() : value,
              ),
              aad(userId, GMAIL_EXTRACTION_PURPOSE, id),
            ),
            confidence: Math.min(...Object.values(extraction.confidence)),
          })
          .where(and(eq(emailIngestLogs.id, id), eq(emailIngestLogs.processing, 'extracting'))),
      );
    },
    failExtraction: (userId, id, code) =>
      withUser(db, userId, async (tx) => {
        await tx
          .update(emailIngestLogs)
          .set({ processing: 'failed', errorCode: code })
          .where(and(eq(emailIngestLogs.id, id), eq(emailIngestLogs.processing, 'extracting')));
      }),
    async complete(userId, id) {
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        const row = firstRow(
          await tx.select().from(emailIngestLogs).where(eq(emailIngestLogs.id, id)).for('update'),
          'email',
        );
        if (row.processing !== 'extracted' && row.processing !== 'failed') return 'replay';
        let extraction =
          row.extractionEnc === null
            ? EMPTY_EXTRACTION
            : parseGmailExtraction(decryptText(dek, row.extractionEnc, aad(userId, GMAIL_EXTRACTION_PURPOSE, id)));
        if (extraction.occurredAt !== null && extraction.amountMinor !== null && extraction.currency !== null) {
          const candidates = await tx
            .select({
              amountMinor: postings.amountMinor,
              currency: postings.currency,
              occurredAt: transactions.occurredAt,
            })
            .from(transactions)
            .innerJoin(
              postings,
              and(eq(transactions.id, postings.transactionId), eq(transactions.userId, postings.userId)),
            )
            .where(
              and(
                eq(transactions.type, 'expense'),
                inArray(transactions.source, ['manual', 'quick']),
                isNull(transactions.deletedAt),
                eq(postings.role, 'principal'),
                eq(postings.currency, extraction.currency),
                gte(transactions.occurredAt, new Date(extraction.occurredAt.getTime() - 7_200_000)),
                lt(transactions.occurredAt, new Date(extraction.occurredAt.getTime() + 7_200_001)),
              ),
            );
          if (
            candidates.some((candidate) =>
              isGmailManualDuplicate(extraction, { ...candidate, amountMinor: -candidate.amountMinor }),
            )
          ) {
            await tx
              .update(emailIngestLogs)
              .set({ outcome: 'duplicate', processing: 'done' })
              .where(eq(emailIngestLogs.id, id));
            return 'duplicate';
          }
        }
        const ownedAccounts = await tx.select().from(accounts).where(eq(accounts.status, 'active'));
        const account = ownedAccounts.find(
          (account) => account.id === extraction.accountId && account.currency === extraction.currency,
        );
        const ownedCategories = await tx
          .select()
          .from(categories)
          .where(and(eq(categories.kind, 'expense'), isNull(categories.deletedAt), isNull(categories.archivedAt)));
        extraction = {
          ...extraction,
          accountId: account?.id ?? null,
          categoryId: ownedCategories.some((category) => category.id === extraction.categoryId)
            ? extraction.categoryId
            : null,
        };
        let tags: readonly string[] = [];
        if (extraction.occurredAt !== null) {
          const user = firstRow(
            await tx.select({ timeZone: users.timezone }).from(users).where(eq(users.id, userId)),
            'user',
          );
          const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: user.timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
          }).formatToParts(extraction.occurredAt);
          const part = (name: string) => parts.find((entry) => entry.type === name)?.value ?? '';
          const rules = evaluateRules(await tx.select().from(autoRules).orderBy(asc(autoRules.position)), {
            description: `${extraction.merchant ?? ''} ${row.subject}`,
            date: parseLocalDate(`${part('year')}-${part('month')}-${part('day')}`),
            minuteOfDay: Number(part('hour')) * 60 + Number(part('minute')),
            accountIds: account === undefined ? [] : [account.id],
            direction: 'expense',
            subscription: false,
          });
          if (ownedCategories.some((category) => category.id === rules.categoryId))
            extraction = { ...extraction, categoryId: rules.categoryId };
          tags = rules.tagOverflow ? [] : [...rules.tags];
        }
        const proposal = await insertReviewItemIn(tx, userId, dek, {
          reason: 'ai_suggestion',
          source: 'gmail',
          dedupeKey: `gmail.${row.messageId}`,
          aiConfidence: row.confidence ?? 0,
          payload: {
            kind: 'gmail',
            logId: id,
            messageId: row.messageId,
            from: row.fromAddr,
            subject: row.subject,
            excerpt: decryptText(dek, row.quoteEnc, aad(userId, GMAIL_QUOTE_PURPOSE, id)),
            extraction,
            tags,
            errorCode: row.errorCode,
          },
        });
        await tx
          .update(emailIngestLogs)
          .set({ reviewItemId: proposal.id, outcome: 'pending', processing: 'done' })
          .where(eq(emailIngestLogs.id, id));
        return 'pending';
      });
    },
    async listLogs(userId, options = {}) {
      const dek = await getDek(userId);
      const rows = await withUser(db, userId, (tx) =>
        tx
          .select({
            id: emailIngestLogs.id,
            messageId: emailIngestLogs.messageId,
            fromAddr: emailIngestLogs.fromAddr,
            subject: emailIngestLogs.subject,
            filterResult: emailIngestLogs.filterResult,
            outcome: emailIngestLogs.outcome,
            processing: emailIngestLogs.processing,
            errorCode: emailIngestLogs.errorCode,
            confidence: emailIngestLogs.confidence,
            extractionEnc: emailIngestLogs.extractionEnc,
            receivedAt: emailIngestLogs.receivedAt,
            createdAt: emailIngestLogs.createdAt,
            reviewItemId: emailIngestLogs.reviewItemId,
          })
          .from(emailIngestLogs)
          .where(
            options.before === undefined
              ? undefined
              : sql`(${emailIngestLogs.createdAt}, ${emailIngestLogs.id}) < (${options.before.at.toISOString()}::timestamptz, ${options.before.id}::uuid)`,
          )
          .orderBy(desc(emailIngestLogs.createdAt), desc(emailIngestLogs.id))
          .limit(Math.min(Math.max(options.limit ?? 500, 1), 500)),
      );
      return rows.map((row) => ({
        id: row.id,
        messageId: row.messageId,
        fromAddr: row.fromAddr,
        subject: row.subject,
        filterResult: row.filterResult,
        outcome: row.outcome,
        processing: row.processing,
        errorCode: row.errorCode,
        confidence: row.confidence,
        extraction:
          row.extractionEnc === null
            ? null
            : parseGmailExtraction(decryptText(dek, row.extractionEnc, aad(userId, GMAIL_EXTRACTION_PURPOSE, row.id))),
        receivedAt: row.receivedAt,
        createdAt: row.createdAt,
        reviewItemId: row.reviewItemId,
      }));
    },
    monthlyStats: (userId, month) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx
          .select({
            outcome: emailIngestLogs.outcome,
            filter: emailIngestLogs.filterResult,
            total: sql<number>`count(*)::int`.mapWith(Number),
          })
          .from(emailIngestLogs)
          .where(and(gte(emailIngestLogs.receivedAt, month.from), lt(emailIngestLogs.receivedAt, month.to)))
          .groupBy(emailIngestLogs.outcome, emailIngestLogs.filterResult);
        const stats = { received: 0, passed: 0, pending: 0, confirmed: 0, ignored: 0, duplicate: 0, filtered: 0 };
        for (const row of rows) {
          stats.received += row.total;
          if (row.filter === 'passed') stats.passed += row.total;
          stats[row.outcome] += row.total;
        }
        return stats;
      }),
    async purgeExpired(before) {
      const rows = await db.execute<{ deleted: number }>(
        sql`select wf_gmail_purge(${before.toISOString()}::timestamptz) as deleted`,
      );
      return firstRow(rows, 'gmail purge result').deleted;
    },
  };
}
