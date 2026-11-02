// SPDX-License-Identifier: AGPL-3.0-only
/** FR-AI2: explicit BYOK consent/configuration, a billed connection probe and metadata-only activity. */
import { createServerFn } from '@tanstack/react-start';
import { csvField } from '@wf/db/export';
import {
  AI_FEATURES,
  AI_LOG_STATUSES,
  AI_PROVIDERS,
  AI_REASONING_EXHAUSTED,
  AI_UNSUPPORTED_ERRORS,
  AiError,
  aiModelSupport,
  calculateAiCost,
  type AiConnectionReasoning,
  type AiConnectionTestResult,
  type AiLogExport,
  type AiLogFilters,
  type AiLogsPage,
  type AiModelCatalog,
  type AiPricing,
  type AiProvider,
  type AiSettingsInput,
  type AiSettingsView,
  type AiConnectionView,
} from '@wf/domain/ai';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import { services, type Services } from '../runtime.ts';

const provider = z.enum(AI_PROVIDERS);
const usd = z.string().regex(/^\d{1,20}(?:\.\d{1,18})?$/);
const filters = z.object({ feature: z.enum(AI_FEATURES).optional(), status: z.enum(AI_LOG_STATUSES).optional() });

function filterInput(input: z.infer<typeof filters>): AiLogFilters {
  return {
    ...(input.feature === undefined ? {} : { feature: input.feature }),
    ...(input.status === undefined ? {} : { status: input.status }),
  };
}

/**
 * The model's entry in the provider catalog, the only price and reasoning source: a model the catalog does not list or
 * price is refused rather than treated as free, and so is one the app cannot use (mandatory reasoning, no tools).
 * Public catalogs are read without the key.
 */
async function catalogModel(
  s: Pick<Services, 'aiClient'>,
  target: { provider: AiProvider; baseUrl: string | undefined; apiKey: string | undefined; modelId: string },
): Promise<{ pricing: AiPricing; reasoning: AiConnectionReasoning }> {
  const catalog = await s.aiClient.models(
    target.provider,
    target.baseUrl,
    target.provider === 'custom' ? target.apiKey : undefined,
  );
  const model = catalog.models.find((entry) => entry.id === target.modelId);
  if (model === undefined) throw new AiError('AI_PRICING_REQUIRED');
  // The last two conditions only narrow the types: `aiModelSupport` already refuses both.
  const unsupported = aiModelSupport(model);
  if (unsupported !== null || model.pricing === null || model.reasoning === 'mandatory')
    throw new AiError(AI_UNSUPPORTED_ERRORS[unsupported ?? 'no_pricing']);
  return { pricing: model.pricing, reasoning: model.reasoning };
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
    }),
  )
  .handler(async ({ context, data }): Promise<Result<AiSettingsView>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, { twoFactor: true, fresh: true }, s.now());
      const { baseUrl, apiKey, ...settings } = data;
      const input: AiSettingsInput = {
        ...settings,
        ...(baseUrl === undefined ? {} : { baseUrl }),
        ...(apiKey === undefined ? {} : { apiKey }),
      };
      // A custom catalog is read with the key being saved, else the saved key at its own endpoint only.
      let catalogKey = apiKey;
      if (data.provider === 'custom' && catalogKey === undefined) {
        const saved = await s.ai.credential(user.id, 'custom');
        if (baseUrl?.replace(/\/+$/, '') !== saved.baseUrl) throw new AiError('AI_INVALID_CONFIG');
        catalogKey = saved.apiKey;
      }
      const model = await catalogModel(s, {
        provider: data.provider,
        baseUrl,
        apiKey: catalogKey,
        modelId: data.modelId,
      });
      return s.ai.save(user.id, input, model.pricing, model.reasoning);
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
  .validator(
    z.object({
      provider,
      baseUrl: z.string().max(2048).optional(),
      apiKey: z.string().trim().min(4).max(512).optional(),
    }),
  )
  .handler(async ({ context, data }): Promise<Result<AiModelCatalog>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(
        context.session,
        data.provider === 'custom' ? { twoFactor: true, fresh: true } : {},
        s.now(),
      );
      if (data.provider !== 'custom') return s.aiClient.models(data.provider);
      // A key typed for this save is sent only to the allowlisted endpoint it is being saved with.
      if (data.apiKey !== undefined) return s.aiClient.models('custom', data.baseUrl, data.apiKey);
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
      const { pricing: quote, reasoning } = await catalogModel(s, credential);
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
      const result = await s.aiClient.complete({
        ...credential,
        messages,
        maxTokens,
        pricing: quote,
        disableReasoning: reasoning === 'optional',
      });
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
        reasoning,
        connectionStatus:
          result.status === 'ok'
            ? 'connected'
            : result.httpStatus === 401 || result.httpStatus === 403
              ? 'invalid_key'
              : 'error',
      });
      // A model that reasons through the whole answer budget is caught here, before anything else is asked of it.
      if (result.errorCode === AI_REASONING_EXHAUSTED) throw new AiError('AI_REASONING_ONLY');
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
