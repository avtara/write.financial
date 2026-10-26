// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { decryptText, encrypt } from '@wf/crypto/cipher';
import type { Dek } from '@wf/crypto/envelope';
import {
  AI_BASE_URLS,
  AI_PROVIDERS,
  AiError,
  canReserveAiCost,
  normalizeAiPricing,
  parseAiUsd,
  resolveAiBaseUrl,
  type AiConnectionStatus,
  type AiConnectionView,
  type AiCostSource,
  type AiDataCounts,
  type AiFeature,
  type AiLogFilters,
  type AiLogsPage,
  type AiLogView,
  type AiPricing,
  type AiProvider,
  type AiSettingsInput,
  type AiSettingsView,
  type AiUsageSummary,
} from '@wf/domain/ai';
import { formatDecimal } from '@wf/domain/decimal';
import { and, count, desc, eq, gte, sql, type SQL } from 'drizzle-orm';
import { firstRow, isUuid, withUser, type Database, type Transaction } from './db.ts';
import { LedgerError } from './ledger-errors.ts';
import { aiConnections, aiLogs, aiSettings, aiUsageMonths, securityEvents, users } from './schema.ts';

export const AI_KEY_PURPOSE = 'ai_connections.api_key';
export const AI_LOG_DAYS = 30;

export interface AiCredential {
  revision: string;
  provider: AiProvider;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  pricing: AiPricing | null;
  pricingSource: 'catalog' | 'manual' | null;
}

export interface AiReservationInput {
  id: string;
  expectedRevision: string;
  provider: AiProvider;
  modelId: string;
  feature: AiFeature;
  costUsd: string;
  dataSent: AiDataCounts;
  needsDraftPermission: boolean;
}

export interface AiSettlementInput {
  status: 'ok' | 'error' | 'timeout';
  httpStatus: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null;
  costSource: AiCostSource;
  durationMs: number;
  errorCode: string | null;
  toolCalls: readonly string[];
  connectionStatus: AiConnectionStatus;
  pricing: AiPricing;
  /** What the request actually sent, when that is only known after the tool loop. Replaces the reserved counts. */
  dataSent?: AiDataCounts;
}

export interface AiRepository {
  settings: (userId: string) => Promise<AiSettingsView>;
  save: (userId: string, input: AiSettingsInput) => Promise<AiSettingsView>;
  removeKey: (userId: string, provider: AiProvider, expectedRevision: string) => Promise<AiSettingsView>;
  credential: (userId: string, provider: AiProvider, expectedRevision?: string) => Promise<AiCredential>;
  reserve: (userId: string, input: AiReservationInput) => Promise<void>;
  settle: (userId: string, id: string, input: AiSettlementInput) => Promise<AiUsageSummary>;
  logs: (userId: string, filters: AiLogFilters, page?: { offset: number; limit: number }) => Promise<AiLogsPage>;
}

type ConnectionRow = typeof aiConnections.$inferSelect;
type LogRow = typeof aiLogs.$inferSelect;

function monthAt(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(at);
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
}

function connectionView(row: ConnectionRow): AiConnectionView {
  return {
    provider: row.provider,
    baseUrl: row.baseUrl,
    last4: row.last4,
    modelId: row.modelId,
    pricing: row.pricing,
    pricingSource: row.pricingSource,
    status: row.status,
    addedAt: row.addedAt,
    testedAt: row.testedAt,
    errorCode: row.errorCode,
    httpStatus: row.httpStatus,
  };
}

function logView(row: LogRow): AiLogView {
  return {
    id: row.id,
    createdAt: row.createdAt,
    provider: row.provider,
    feature: row.feature,
    modelId: row.modelId,
    status: row.status,
    httpStatus: row.httpStatus,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costUsd: row.costUsd === null ? null : formatDecimal(parseAiUsd(row.costUsd)),
    costSource: row.costSource,
    durationMs: row.durationMs,
    errorCode: row.errorCode,
    dataSent: {
      images: row.images,
      categories: row.categories,
      accounts: row.accounts,
      transactions: row.transactions,
    },
    toolCalls: row.toolCalls,
  };
}

export function createAiRepository(
  db: Database,
  options: {
    getDek: (userId: string) => Promise<Dek>;
    allowedBaseUrls: readonly string[];
    now?: () => Date;
  },
): AiRepository {
  const now = options.now ?? (() => new Date());
  const aad = (userId: string, provider: AiProvider, baseUrl: string) => ({
    userId,
    purpose: `${AI_KEY_PURPOSE}:${provider}:${baseUrl}`,
  });
  const userIn = async (tx: Transaction, userId: string) =>
    firstRow(
      await tx
        .select({ twoFactor: users.twoFactorEnabled, timezone: users.timezone })
        .from(users)
        .where(eq(users.id, userId)),
      'AI user',
    );
  // One lock per user, including first-save races when no settings/month row exists yet. Never hold it over HTTP.
  const mutate = <T>(userId: string, work: (tx: Transaction) => Promise<T>) =>
    withUser(db, userId, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ai:${userId}`}, 0))`);
      return work(tx);
    });
  const currentIn = async (tx: Transaction) => (await tx.select().from(aiSettings))[0];
  const usageIn = async (tx: Transaction, month: string, limitUsd: string): Promise<AiUsageSummary> => {
    const row = (await tx.select().from(aiUsageMonths).where(eq(aiUsageMonths.month, month)))[0];
    return {
      month,
      requests: row?.requests ?? 0,
      spentUsd: formatDecimal(parseAiUsd(row?.spentUsd ?? '0')),
      estimatedUsd: formatDecimal(parseAiUsd(row?.estimatedUsd ?? '0')),
      reservedUsd: formatDecimal(parseAiUsd(row?.reservedUsd ?? '0')),
      limitUsd: formatDecimal(parseAiUsd(limitUsd)),
    };
  };
  const viewIn = async (tx: Transaction, userId: string): Promise<AiSettingsView> => {
    const user = await userIn(tx, userId);
    const settings = await currentIn(tx);
    const connections = await tx.select().from(aiConnections);
    const limit = settings?.monthlyLimitUsd ?? '5';
    return {
      revision: settings?.revision ?? null,
      twoFactorEnabled: user.twoFactor === true,
      provider: settings?.provider ?? 'openrouter',
      allowReadFinancial: settings?.allowReadFinancial ?? false,
      allowCreateDrafts: settings?.allowCreateDrafts ?? false,
      requireConfirmation: true,
      monthlyLimitUsd: formatDecimal(parseAiUsd(limit)),
      usage: await usageIn(tx, monthAt(now(), user.timezone), limit),
      allowedCustomBaseUrls: options.allowedBaseUrls,
      connections: AI_PROVIDERS.map((provider) => {
        const row = connections.find((item) => item.provider === provider);
        return row === undefined
          ? {
              provider,
              baseUrl: provider === 'custom' ? '' : AI_BASE_URLS[provider],
              last4: null,
              status: 'not_connected',
              modelId: null,
              addedAt: null,
              testedAt: null,
              errorCode: null,
              httpStatus: null,
              pricing: null,
              pricingSource: null,
            }
          : connectionView(row);
      }),
    };
  };
  const checkRevision = (actual: string | null, expected: string | null) => {
    if (actual !== expected) throw new AiError('AI_CONFIG_CHANGED');
  };
  const filtersIn = (filters: AiLogFilters): SQL | undefined =>
    and(
      gte(aiLogs.createdAt, new Date(now().getTime() - AI_LOG_DAYS * 86_400_000)),
      filters.feature === undefined ? undefined : eq(aiLogs.feature, filters.feature),
      filters.status === undefined ? undefined : eq(aiLogs.status, filters.status),
    );

  return {
    settings: (userId) => withUser(db, userId, (tx) => viewIn(tx, userId)),

    save: async (userId, input) => {
      if (!AI_PROVIDERS.includes(input.provider) || !/^[\w./:@+-]{1,200}$/.test(input.modelId))
        throw new AiError('AI_INVALID_CONFIG');
      const baseUrl = resolveAiBaseUrl(input.provider, input.baseUrl, options.allowedBaseUrls);
      const monthlyLimitUsd = formatDecimal(parseAiUsd(input.monthlyLimitUsd));
      const pricing = input.pricing === null ? null : normalizeAiPricing(input.pricing);
      const key = input.apiKey?.trim();
      if (key !== undefined && (key.length < 4 || key.length > 512 || /\s/.test(key) || key === input.modelId))
        throw new AiError('AI_INVALID_CONFIG');
      const ciphertext =
        key === undefined
          ? undefined
          : encrypt(await options.getDek(userId), key, aad(userId, input.provider, baseUrl));
      return mutate(userId, async (tx) => {
        if ((await userIn(tx, userId)).twoFactor !== true)
          throw new LedgerError('TWO_FACTOR_REQUIRED', 'AI keys require 2FA');
        const current = await currentIn(tx);
        checkRevision(current?.revision ?? null, input.expectedRevision);
        const existing = (await tx.select().from(aiConnections).where(eq(aiConnections.provider, input.provider)))[0];
        // A retained secret must never silently follow a changed custom endpoint.
        if (key === undefined && existing?.apiKeyEnc != null && existing.baseUrl !== baseUrl)
          throw new AiError('AI_INVALID_CONFIG');
        const settings = {
          provider: input.provider,
          revision: randomUUID(),
          allowReadFinancial: input.allowReadFinancial,
          allowCreateDrafts: input.allowCreateDrafts,
          requireConfirmation: true,
          monthlyLimitUsd,
          updatedAt: now(),
        };
        await tx
          .insert(aiSettings)
          .values({ userId, ...settings })
          .onConflictDoUpdate({ target: aiSettings.userId, set: settings });
        const hasKey = ciphertext !== undefined || existing?.apiKeyEnc != null;
        const state =
          existing !== undefined &&
          key === undefined &&
          existing.modelId === input.modelId &&
          existing.baseUrl === baseUrl
            ? {
                status: existing.status,
                testedAt: existing.testedAt,
                errorCode: existing.errorCode,
                httpStatus: existing.httpStatus,
              }
            : {
                status: hasKey ? ('untested' as const) : ('not_connected' as const),
                testedAt: null,
                errorCode: null,
                httpStatus: null,
              };
        const connection = {
          baseUrl,
          modelId: input.modelId,
          pricing,
          pricingSource: pricing === null ? ('catalog' as const) : ('manual' as const),
          ...state,
          ...(ciphertext === undefined ? {} : { apiKeyEnc: ciphertext, last4: key?.slice(-4), addedAt: now() }),
        };
        await tx
          .insert(aiConnections)
          .values({ userId, provider: input.provider, ...connection })
          .onConflictDoUpdate({ target: [aiConnections.userId, aiConnections.provider], set: connection });
        if (key !== undefined) {
          await tx.insert(securityEvents).values({
            userId,
            type: 'api_key_added',
            ipHash: null,
            userAgent: null,
            meta: { integration: 'ai', provider: input.provider },
          });
        }
        return viewIn(tx, userId);
      });
    },

    removeKey: (userId, provider, expectedRevision) =>
      mutate(userId, async (tx) => {
        const current = await currentIn(tx);
        checkRevision(current?.revision ?? null, expectedRevision);
        const existing = (
          await tx
            .select({ last4: aiConnections.last4 })
            .from(aiConnections)
            .where(eq(aiConnections.provider, provider))
        )[0];
        await tx
          .update(aiConnections)
          .set({
            apiKeyEnc: null,
            last4: null,
            addedAt: null,
            testedAt: null,
            status: 'not_connected',
            errorCode: null,
            httpStatus: null,
          })
          .where(eq(aiConnections.provider, provider));
        await tx.update(aiSettings).set({ revision: randomUUID(), updatedAt: now() });
        if (existing?.last4 != null) {
          await tx.insert(securityEvents).values({
            userId,
            type: 'api_key_removed',
            ipHash: null,
            userAgent: null,
            meta: { integration: 'ai', provider },
          });
        }
        // No usage reset: removing/replacing a key cannot replenish the monthly allowance.
        return viewIn(tx, userId);
      }),

    credential: async (userId, provider, expectedRevision) => {
      const snapshot = await withUser(db, userId, async (tx) => {
        if ((await userIn(tx, userId)).twoFactor !== true)
          throw new LedgerError('TWO_FACTOR_REQUIRED', 'AI keys require 2FA');
        const settings = await currentIn(tx);
        if (expectedRevision !== undefined) checkRevision(settings?.revision ?? null, expectedRevision);
        const connection = (await tx.select().from(aiConnections).where(eq(aiConnections.provider, provider)))[0];
        if (settings === undefined || connection?.apiKeyEnc == null || connection.modelId === null)
          throw new AiError('AI_NOT_CONFIGURED');
        resolveAiBaseUrl(provider, connection.baseUrl, options.allowedBaseUrls);
        return { revision: settings.revision, connection };
      });
      const apiKey = decryptText(
        await options.getDek(userId),
        snapshot.connection.apiKeyEnc as Uint8Array,
        aad(userId, provider, snapshot.connection.baseUrl),
      );
      return {
        revision: snapshot.revision,
        provider,
        baseUrl: snapshot.connection.baseUrl,
        modelId: snapshot.connection.modelId as string,
        apiKey,
        pricing: snapshot.connection.pricing,
        pricingSource: snapshot.connection.pricingSource,
      };
    },

    reserve: async (userId, input) => {
      if (!isUuid(input.id) || !isUuid(input.expectedRevision)) throw new AiError('AI_INVALID_CONFIG');
      parseAiUsd(input.costUsd);
      for (const value of Object.values(input.dataSent))
        if (!Number.isSafeInteger(value) || value < 0) throw new AiError('AI_INVALID_CONFIG');
      const refusal = await mutate(userId, async (tx) => {
        const user = await userIn(tx, userId);
        const current = await currentIn(tx);
        checkRevision(current?.revision ?? null, input.expectedRevision);
        if (current === undefined) throw new AiError('AI_NOT_CONFIGURED');
        const connection = (await tx.select().from(aiConnections).where(eq(aiConnections.provider, input.provider)))[0];
        if (connection?.apiKeyEnc == null || connection.modelId !== input.modelId)
          throw new AiError('AI_NOT_CONFIGURED');
        if (user.twoFactor !== true) throw new LedgerError('TWO_FACTOR_REQUIRED', 'AI keys require 2FA');
        if ((await tx.select({ id: aiLogs.id }).from(aiLogs).where(eq(aiLogs.id, input.id))).length !== 0)
          throw new AiError('AI_REQUEST_EXISTS');
        const month = monthAt(now(), user.timezone);
        const usage = await usageIn(tx, month, current.monthlyLimitUsd);
        const financial = input.feature !== 'test' || Object.values(input.dataSent).some((value) => value > 0);
        const denied =
          (financial && !current.allowReadFinancial) || (input.needsDraftPermission && !current.allowCreateDrafts);
        const error = denied
          ? ('AI_PERMISSION_REQUIRED' as const)
          : !canReserveAiCost({
                spentUsd: usage.spentUsd,
                reservedUsd: usage.reservedUsd,
                nextUsd: input.costUsd,
                limitUsd: usage.limitUsd,
              })
            ? ('AI_COST_LIMIT' as const)
            : null;
        await tx.insert(aiLogs).values({
          userId,
          id: input.id,
          createdAt: now(),
          month,
          revision: input.expectedRevision,
          provider: input.provider,
          feature: input.feature,
          modelId: input.modelId,
          status: error === null ? 'pending' : 'blocked',
          errorCode: error,
          reservedUsd: error === null ? input.costUsd : '0',
          images: input.dataSent.images,
          categories: input.dataSent.categories,
          accounts: input.dataSent.accounts,
          transactions: input.dataSent.transactions,
        });
        if (error !== null) return error;
        await tx.insert(aiUsageMonths).values({ userId, month }).onConflictDoNothing();
        await tx
          .update(aiUsageMonths)
          .set({
            requests: sql`${aiUsageMonths.requests} + 1`,
            reservedUsd: sql`${aiUsageMonths.reservedUsd} + ${input.costUsd}::numeric`,
          })
          .where(eq(aiUsageMonths.month, month));
        return null;
      });
      if (refusal !== null) throw new AiError(refusal);
    },

    settle: (userId, id, input) =>
      mutate(userId, async (tx) => {
        const row = firstRow(await tx.select().from(aiLogs).where(eq(aiLogs.id, id)), 'AI request');
        const current = firstRow(await tx.select().from(aiSettings), 'AI settings');
        if (row.status !== 'pending') return usageIn(tx, row.month, current.monthlyLimitUsd);
        // A timeout/malformed answer can still have been billed. Unknown costs consume the reserved upper estimate.
        const cost = input.costUsd === null ? row.reservedUsd : formatDecimal(parseAiUsd(input.costUsd));
        const source = input.costUsd === null ? 'estimated' : input.costSource;
        await tx
          .update(aiUsageMonths)
          .set({
            reservedUsd: sql`${aiUsageMonths.reservedUsd} - ${row.reservedUsd}::numeric`,
            spentUsd: sql`${aiUsageMonths.spentUsd} + ${cost}::numeric`,
            estimatedUsd: sql`${aiUsageMonths.estimatedUsd} + ${source === 'estimated' ? cost : '0'}::numeric`,
          })
          .where(eq(aiUsageMonths.month, row.month));
        await tx
          .update(aiLogs)
          .set({
            status: input.status,
            httpStatus: input.httpStatus,
            inputTokens: input.inputTokens,
            outputTokens: input.outputTokens,
            costUsd: cost,
            costSource: source,
            durationMs: input.durationMs,
            errorCode: input.errorCode,
            toolCalls: [...input.toolCalls],
            ...(input.dataSent === undefined
              ? {}
              : {
                  images: input.dataSent.images,
                  categories: input.dataSent.categories,
                  accounts: input.dataSent.accounts,
                  transactions: input.dataSent.transactions,
                }),
          })
          .where(eq(aiLogs.id, id));
        // A completed old-key/model test must not mark a newly saved configuration connected or invalid.
        if (
          current.revision === row.revision &&
          row.feature === 'test' &&
          (await userIn(tx, userId)).twoFactor === true
        ) {
          await tx
            .update(aiConnections)
            .set({
              status: input.connectionStatus,
              testedAt: now(),
              errorCode: input.errorCode,
              httpStatus: input.httpStatus,
              pricing: input.pricing,
            })
            .where(eq(aiConnections.provider, row.provider));
        }
        return usageIn(tx, row.month, current.monthlyLimitUsd);
      }),

    logs: (userId, filters, page) =>
      withUser(db, userId, async (tx) => {
        const where = filtersIn(filters);
        const stats = firstRow(
          await tx
            .select({
              total: count(),
              failed: sql<number>`count(*) filter (where ${aiLogs.status} in ('error','timeout','blocked'))`.mapWith(
                Number,
              ),
            })
            .from(aiLogs)
            .where(where),
          'AI log count',
        );
        const query = tx.select().from(aiLogs).where(where).orderBy(desc(aiLogs.createdAt), desc(aiLogs.id));
        const rows = page === undefined ? await query : await query.offset(page.offset).limit(page.limit);
        return { items: rows.map(logView), ...stats };
      }),
  };
}
