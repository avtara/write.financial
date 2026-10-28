// SPDX-License-Identifier: AGPL-3.0-only
/** FR-AI2: explicit BYOK consent/configuration, a billed connection probe and metadata-only activity. */
import { createServerFn } from '@tanstack/react-start';
import { csvField } from '@wf/db/export';
import {
  AI_FEATURES,
  AI_LOG_STATUSES,
  AI_PROVIDERS,
  AiError,
  calculateAiCost,
  type AiConnectionTestResult,
  type AiLogExport,
  type AiLogFilters,
  type AiLogsPage,
  type AiModelCatalog,
  type AiSettingsView,
  type AiConnectionView,
} from '@wf/domain/ai';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import { services } from '../runtime.ts';

const provider = z.enum(AI_PROVIDERS);
const usd = z.string().regex(/^\d{1,20}(?:\.\d{1,18})?$/);
const pricing = z.object({ inputUsdPerMillion: usd, outputUsdPerMillion: usd, requestUsd: usd, imageUsd: usd });
const filters = z.object({ feature: z.enum(AI_FEATURES).optional(), status: z.enum(AI_LOG_STATUSES).optional() });

function filterInput(input: z.infer<typeof filters>): AiLogFilters {
  return {
    ...(input.feature === undefined ? {} : { feature: input.feature }),
    ...(input.status === undefined ? {} : { status: input.status }),
  };
}

export const getAiSettings = createServerFn({ method: 'GET' }).handler(
  async ({ context }): Promise<Result<AiSettingsView>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, s.now());
      return s.ai.settings(user.id);
    });
  },
);

export const saveAiSettings = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      expectedRevision: z.uuid().nullable(),
      provider,
      baseUrl: z.string().max(2048).optional(),
      apiKey: z.string().trim().min(4).max(512).optional(),
      modelId: z.string().regex(/^[\w./:@+-]{1,200}$/),
      allowReadFinancial: z.boolean(),
      allowCreateDrafts: z.boolean(),
      requireConfirmation: z.literal(true),
      monthlyLimitUsd: usd,
      pricing: pricing.nullable(),
    }),
  )
  .handler(async ({ context, data }): Promise<Result<AiSettingsView>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, { twoFactor: true, fresh: true }, s.now());
      const { baseUrl, apiKey, ...settings } = data;
      return s.ai.save(user.id, {
        ...settings,
        ...(baseUrl === undefined ? {} : { baseUrl }),
        ...(apiKey === undefined ? {} : { apiKey }),
      });
    });
  });

export const removeAiKey = createServerFn({ method: 'POST' })
  .validator(z.object({ provider, expectedRevision: z.uuid() }))
  .handler(async ({ context, data }): Promise<Result<AiSettingsView>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, { twoFactor: true, fresh: true }, s.now());
      return s.ai.removeKey(user.id, data.provider, data.expectedRevision);
    });
  });

export const listAiModels = createServerFn({ method: 'POST' })
  .validator(z.object({ provider, baseUrl: z.string().max(2048).optional() }))
  .handler(async ({ context, data }): Promise<Result<AiModelCatalog>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(
        context.session,
        data.provider === 'custom' ? { twoFactor: true, fresh: true } : {},
        s.now(),
      );
      if (data.provider !== 'custom') return s.aiClient.models(data.provider);
      const credential = await s.ai.credential(user.id, 'custom');
      // The saved custom key cannot be sent to an unsaved/different endpoint supplied by a browser.
      if (data.baseUrl !== undefined && data.baseUrl.replace(/\/+$/, '') !== credential.baseUrl)
        throw new AiError('AI_CONFIG_CHANGED');
      return s.aiClient.models('custom', credential.baseUrl, credential.apiKey);
    });
  });

export const testAiConnection = createServerFn({ method: 'POST' })
  .validator(z.object({ provider, expectedRevision: z.uuid(), requestId: z.uuid() }))
  .handler(async ({ context, data }): Promise<Result<AiConnectionTestResult>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, { twoFactor: true, fresh: true }, s.now());
      const credential = await s.ai.credential(user.id, data.provider, data.expectedRevision);
      const catalog =
        credential.pricingSource === 'manual'
          ? null
          : await s.aiClient.models(
              data.provider,
              credential.baseUrl,
              data.provider === 'custom' ? credential.apiKey : undefined,
            );
      const quote =
        credential.pricingSource === 'manual'
          ? credential.pricing
          : (catalog?.models.find((model) => model.id === credential.modelId)?.pricing ?? null);
      if (quote === null) throw new AiError('AI_PRICING_REQUIRED');
      const messages = [
        { role: 'user' as const, content: 'Reply with OK. This is a connection test; do not call tools.' },
      ] as const;
      const maxTokens = 32;
      // Conservative text/protocol estimate, not a promise about a third-party invoice or hidden provider fees.
      const inputTokens = new TextEncoder().encode(messages[0].content).byteLength + 1024;
      const costUsd = calculateAiCost(quote, { inputTokens, outputTokens: maxTokens, images: 0 });
      await s.ai.reserve(user.id, {
        id: data.requestId,
        expectedRevision: data.expectedRevision,
        provider: data.provider,
        modelId: credential.modelId,
        feature: 'test',
        costUsd,
        dataSent: { images: 0, categories: 0, accounts: 0, transactions: 0 },
        needsDraftPermission: false,
      });
      const result = await s.aiClient.complete({ ...credential, messages, maxTokens, pricing: quote });
      await s.ai.settle(user.id, data.requestId, {
        status: result.status,
        httpStatus: result.httpStatus,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        costSource: result.costUsd === null ? 'estimated' : 'reported',
        durationMs: result.durationMs,
        errorCode: result.errorCode,
        toolCalls: [],
        pricing: quote,
        connectionStatus:
          result.status === 'ok'
            ? 'connected'
            : result.httpStatus === 401 || result.httpStatus === 403
              ? 'invalid_key'
              : 'error',
      });
      const settings = await s.ai.settings(user.id);
      if (settings.revision !== data.expectedRevision) throw new AiError('AI_CONFIG_CHANGED');
      // The repository always includes all providers, including a disconnected provider's empty connection.
      const connection = settings.connections.find((item) => item.provider === data.provider) as AiConnectionView;
      return { connection, usage: settings.usage };
    });
  });

export const listAiLogs = createServerFn({ method: 'GET' })
  .validator(
    filters.extend({ offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(200).optional() }),
  )
  .handler(async ({ context, data }): Promise<Result<AiLogsPage>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, s.now());
      return s.ai.logs(user.id, filterInput(data), { offset: data.offset ?? 0, limit: data.limit ?? 50 });
    });
  });

export const exportAiLogs = createServerFn({ method: 'GET' })
  .validator(filters)
  .handler(async ({ context, data }): Promise<Result<AiLogExport>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, s.now());
      const { items } = await s.ai.logs(user.id, filterInput(data));
      const header = [
        'id',
        'at',
        'provider',
        'feature',
        'model',
        'status',
        'http_status',
        'input_tokens',
        'output_tokens',
        'cost_usd',
        'cost_source',
        'duration_ms',
        'images',
        'categories',
        'accounts',
        'transactions',
        'tool_calls',
        'error_code',
      ];
      const cell = (value: string | number | null): string => {
        const text = value === null ? '' : String(value);
        return csvField(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text);
      };
      const rows = items.map((row) =>
        [
          row.id,
          row.createdAt.toISOString(),
          row.provider,
          row.feature,
          row.modelId,
          row.status,
          row.httpStatus,
          row.inputTokens,
          row.outputTokens,
          row.costUsd,
          row.costSource,
          row.durationMs,
          row.dataSent.images,
          row.dataSent.categories,
          row.dataSent.accounts,
          row.dataSent.transactions,
          row.toolCalls.join(';'),
          row.errorCode,
        ]
          .map(cell)
          .join(','),
      );
      return {
        csv: [header.join(','), ...rows].join('\r\n'),
        fileName: `ai-activity-${s.now().toISOString().slice(0, 10)}.csv`,
      };
    });
  });
