// SPDX-License-Identifier: AGPL-3.0-only
import {
  AiError,
  normalizeAiPricing,
  parseAiUsd,
  resolveAiBaseUrl,
  type AiModel,
  type AiModelCatalog,
  type AiPricing,
  type AiProvider,
} from '@wf/domain/ai';
import { formatDecimal } from '@wf/domain/decimal';
import * as z from 'zod';

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
export interface AiCompletionInput {
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  messages: readonly AiMessage[];
  maxTokens: number;
  pricing: AiPricing;
}
export interface AiCompletionResult {
  status: 'ok' | 'error' | 'timeout';
  httpStatus: number | null;
  errorCode: string | null;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null;
  /** Ephemeral answer, never passed to an application logger or persisted by this adapter. */
  content: string | null;
}
export interface AiClient {
  models: (provider: AiProvider, baseUrl?: string, apiKey?: string) => Promise<AiModelCatalog>;
  complete: (input: AiCompletionInput) => Promise<AiCompletionResult>;
}

const BODY_LIMIT = 8 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const recordSchema = z.record(z.string(), z.unknown());
const catalogSchema = z.object({ data: z.array(recordSchema) });
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const field = (value: unknown, key: string): unknown => (isObject(value) ? value[key] : undefined);
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
function integer(value: unknown): number | null {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 2_147_483_647
    ? parsed
    : null;
}

/** Preserve JSON number lexemes before they can lose subcent precision in a binary float. Node 24 supplies source. */
function parseJson(input: string): unknown {
  return JSON.parse(input, (_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value !== 'number') return value;
    if (context?.source === undefined) throw new AiError('AI_PROVIDER_FAILED');
    return context.source;
  }) as unknown;
}

/** Provider decimal/scientific notation, exactly at the database's 18-digit precision. */
function decimal(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,30})(?:\.(\d{1,30}))?(?:e([+-]?\d{1,2}))?$/i.exec(value);
  if (match === null) return null;
  const fraction = match[2] ?? '';
  const exponent = Number(match[3] ?? '0') - fraction.length + 18;
  const magnitude = BigInt(`${match[1]}${fraction}`);
  if (exponent >= 0) {
    const result = magnitude * 10n ** BigInt(exponent);
    return result < 10n ** 38n ? result : null;
  }
  const divisor = 10n ** BigInt(-exponent);
  // Prices below a database quantum are rounded upward, never silently considered free.
  return (magnitude + divisor - 1n) / divisor;
}
function maximum(values: readonly bigint[]): bigint {
  return values.reduce((max, value) => (value > max ? value : max), 0n);
}
function rates(pricing: unknown, provider: AiProvider): AiPricing | null {
  if (provider === 'custom') return null; // The OpenAI models contract does not define prices.
  if (provider === 'zenmux') {
    const rate = (key: string, unit: string): bigint | null => {
      const entries = field(pricing, key);
      if (entries === undefined) return 0n;
      if (!Array.isArray(entries) || entries.length === 0) return null;
      const values: bigint[] = [];
      for (const entry of entries) {
        if (field(entry, 'currency') !== 'USD' || field(entry, 'unit') !== unit) return null;
        const value = decimal(field(entry, 'value'));
        if (value === null) return null;
        values.push(value);
      }
      return maximum(values);
    };
    if (field(pricing, 'prompt') === undefined || field(pricing, 'completion') === undefined) return null;
    const prompt = rate('prompt', 'perMTokens');
    const completion = rate('completion', 'perMTokens');
    const cacheRead = rate('input_cache_read', 'perMTokens');
    const cacheWrite = rate('input_cache_write', 'perMTokens');
    const cacheHour = rate('input_cache_write_1_h', 'perMTokens');
    const cacheShort = rate('input_cache_write_5_min', 'perMTokens');
    const reasoning = rate('internal_reasoning', 'perMTokens');
    const request = rate('request', 'perCount');
    const image = rate('image', 'perCount');
    if (
      prompt === null ||
      completion === null ||
      cacheRead === null ||
      cacheWrite === null ||
      cacheHour === null ||
      cacheShort === null ||
      reasoning === null ||
      request === null ||
      image === null
    )
      return null;
    return {
      inputUsdPerMillion: formatDecimal(prompt + cacheRead + cacheWrite + maximum([cacheHour, cacheShort])),
      outputUsdPerMillion: formatDecimal(completion + reasoning),
      requestUsd: formatDecimal(request),
      imageUsd: formatDecimal(image),
    };
  }
  const variants: unknown[] = [pricing];
  const overrides = field(pricing, 'overrides');
  if (Array.isArray(overrides)) for (const entry of overrides) variants.push(field(entry, 'pricing') ?? entry);
  const all: AiPricing[] = [];
  for (const variant of variants) {
    const prompt = decimal(field(variant, 'prompt'));
    const completion = decimal(field(variant, 'completion'));
    if (prompt === null || completion === null) return null;
    const optional = (key: string): bigint | null =>
      field(variant, key) === undefined ? 0n : decimal(field(variant, key));
    const cacheRead = optional('input_cache_read');
    const cacheWrite = optional('input_cache_write');
    const reasoning = optional('internal_reasoning');
    const request = optional('request');
    const image = optional('image');
    if (cacheRead === null || cacheWrite === null || reasoning === null || request === null || image === null)
      return null;
    all.push({
      inputUsdPerMillion: formatDecimal((prompt + cacheRead + cacheWrite) * 1_000_000n),
      outputUsdPerMillion: formatDecimal((completion + reasoning) * 1_000_000n),
      requestUsd: formatDecimal(request),
      imageUsd: formatDecimal(image),
    });
  }
  return {
    inputUsdPerMillion: formatDecimal(maximum(all.map((item) => parseAiUsd(item.inputUsdPerMillion)))),
    outputUsdPerMillion: formatDecimal(maximum(all.map((item) => parseAiUsd(item.outputUsdPerMillion)))),
    requestUsd: formatDecimal(maximum(all.map((item) => parseAiUsd(item.requestUsd)))),
    imageUsd: formatDecimal(maximum(all.map((item) => parseAiUsd(item.imageUsd)))),
  };
}

async function readJson(response: Response): Promise<unknown> {
  if (response.body === null) throw new AiError('AI_PROVIDER_FAILED');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array)) throw new AiError('AI_PROVIDER_FAILED');
      bytes += value.byteLength;
      if (bytes > BODY_LIMIT) throw new AiError('AI_PROVIDER_FAILED');
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return parseJson(body);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function amountFrom(usage: unknown): string | null {
  // OpenRouter reports USD in usage.cost. Missing/delayed provider billing stays an estimate;
  // do not invent a ZenMux management-API response inside a chat-completion payload.
  const value = decimal(field(usage, 'cost'));
  return value === null ? null : formatDecimal(value);
}

export function createAiClient(options: {
  allowedBaseUrls: readonly string[];
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}): AiClient {
  const send = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  return {
    models: async (provider, requestedBase, apiKey) => {
      const base = resolveAiBaseUrl(provider, requestedBase, options.allowedBaseUrls);
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (provider === 'custom') {
        if (apiKey === undefined) throw new AiError('AI_NOT_CONFIGURED');
        headers.Authorization = `Bearer ${apiKey}`;
      }
      try {
        const response = await send(`${base}/models`, {
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new AiError('AI_PROVIDER_FAILED');
        }
        const body = catalogSchema.parse(await readJson(response));
        const entries = body.data;
        const models: AiModel[] = [];
        for (const entry of entries) {
          const id = text(field(entry, 'id'));
          if (id === null || !/^[\w./:@+-]{1,200}$/.test(id)) continue;
          models.push({
            id,
            name: (text(field(entry, 'name')) ?? text(field(entry, 'display_name')) ?? id).slice(0, 200),
            contextLength: integer(field(entry, 'context_length')),
            maxOutputTokens:
              integer(field(entry, 'max_tokens')) ??
              integer(field(field(entry, 'top_provider'), 'max_completion_tokens')),
            pricing: rates(field(entry, provider === 'zenmux' ? 'pricings' : 'pricing'), provider),
          });
        }
        return { provider, models, loadedAt: now(), catalogPublic: provider !== 'custom' };
      } catch {
        // Never propagate a provider body, URL containing a key, or native fetch error to application logs.
        throw new AiError('AI_PROVIDER_FAILED');
      }
    },

    complete: async (input) => {
      const base = resolveAiBaseUrl(input.provider, input.baseUrl, options.allowedBaseUrls);
      if (!Number.isSafeInteger(input.maxTokens) || input.maxTokens < 1 || input.maxTokens > 32_768)
        throw new AiError('AI_INVALID_CONFIG');
      const pricing = normalizeAiPricing(input.pricing);
      const start = now().getTime();
      let httpStatus: number | null = null;
      let errorCode: string | null = null;
      let status: AiCompletionResult['status'] = 'error';
      const empty = (): AiCompletionResult => ({
        status,
        httpStatus,
        errorCode,
        durationMs: Math.max(0, now().getTime() - start),
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        content: null,
      });
      const signal = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
      try {
        // JSON.rawJSON is provided by the required Node 24 runtime: numeric provider ceilings stay exact.
        const nativeJson = JSON as typeof JSON & { rawJSON: (value: string) => unknown };
        const raw = nativeJson.rawJSON;
        const response = await send(`${base}/chat/completions`, {
          method: 'POST',
          redirect: 'error',
          signal,
          headers: {
            Authorization: `Bearer ${input.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            model: input.modelId,
            messages: input.messages,
            max_tokens: input.maxTokens,
            stream: false,
            ...(input.provider === 'openrouter'
              ? {
                  provider: {
                    allow_fallbacks: false,
                    require_parameters: true,
                    max_price: {
                      prompt: raw(pricing.inputUsdPerMillion),
                      completion: raw(pricing.outputUsdPerMillion),
                      request: raw(pricing.requestUsd),
                      image: raw(pricing.imageUsd),
                    },
                  },
                }
              : {}),
          }),
        });
        httpStatus = response.status;
        if (!response.ok) {
          errorCode = `http_${response.status}`;
          await response.body?.cancel();
          return empty();
        }
        const body = recordSchema.parse(await readJson(response));
        const choices = field(body, 'choices');
        const message = Array.isArray(choices) ? field(choices[0], 'message') : null;
        const usage = field(body, 'usage');
        const metering = {
          inputTokens: integer(field(usage, 'prompt_tokens')),
          outputTokens: integer(field(usage, 'completion_tokens')),
          costUsd: amountFrom(usage),
        };
        if (!isObject(message)) {
          errorCode = 'invalid_response';
          return { ...empty(), ...metering };
        }
        status = 'ok';
        return { ...empty(), ...metering, content: text(field(message, 'content')) };
      } catch {
        status = signal.aborted ? 'timeout' : 'error';
        errorCode = signal.aborted ? 'timeout' : httpStatus === null ? 'network' : 'invalid_response';
        return empty();
      }
    },
  };
}
