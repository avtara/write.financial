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
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** `role: 'tool'`: the call this result answers. */
  toolCallId?: string;
  /** `role: 'assistant'`: the calls the model made in that turn. */
  toolCalls?: readonly AiToolCall[];
  /** Receipt vision only: bounded, sanitized image bytes; never a remote URL or raw PDF. */
  images?: readonly { readonly mime: 'image/webp'; readonly bytes: Uint8Array }[];
}
/** One function the model may call; `parameters` is a JSON Schema object. */
export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface AiToolCall {
  id: string;
  name: string;
  /** Raw JSON arguments as the provider sent them; the caller validates before use. */
  arguments: string;
}
export interface AiCompletionInput {
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  messages: readonly AiMessage[];
  maxTokens: number;
  pricing: AiPricing;
  /** At most {@link MAX_TOOLS}; omitted for a plain completion. */
  tools?: readonly AiToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required';
  /**
   * Strict JSON Schema for a plain (tool-free) answer, sent as OpenAI-compatible
   * `response_format: { type: 'json_schema' }`. Best effort: a provider/model that refuses structured outputs is
   * retried once without it, so the caller still validates every answer itself. Not allowed together with `tools`.
   */
  responseSchema?: { readonly name: string; readonly schema: Record<string, unknown> };
  /** Shorter deadline for one call inside a bounded multi-step loop; never above the adapter's own limit. */
  timeoutMs?: number;
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
  /** Allowlisted by the caller before execution; an unknown name is not called. */
  toolCalls: readonly AiToolCall[];
  finishReason: string | null;
}
export interface AiClient {
  models: (provider: AiProvider, baseUrl?: string, apiKey?: string) => Promise<AiModelCatalog>;
  complete: (input: AiCompletionInput) => Promise<AiCompletionResult>;
}

const BODY_LIMIT = 8 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
/** One turn never needs more; anything above is a provider bug or a loop. */
const MAX_TOOLS = 8;
const MAX_TOOL_CALLS = 8;
const MAX_TOOL_ARGUMENTS = 8_192;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
/**
 * Statuses a provider uses to refuse an unsupported `response_format` before any generation (OpenRouter with
 * `require_parameters: true` answers 404 when no endpoint supports structured outputs; others 400/422). Nothing is
 * billed for such a refusal, so exactly one retry without the schema is safe.
 */
const SCHEMA_REFUSALS: ReadonlySet<number> = new Set([400, 404, 422]);
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

/** Bounded, well-named calls only; an unknown or malformed entry is dropped rather than executed. */
function parseToolCalls(value: unknown): AiToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: AiToolCall[] = [];
  for (const entry of value.slice(0, MAX_TOOL_CALLS)) {
    const id = text(field(entry, 'id'));
    const call = field(entry, 'function');
    const name = text(field(call, 'name'));
    const raw = field(call, 'arguments');
    if (id === null || id === '' || name === null || !TOOL_NAME.test(name)) continue;
    const args = typeof raw === 'string' ? raw : raw === undefined || raw === null ? '{}' : JSON.stringify(raw);
    if (args.length > MAX_TOOL_ARGUMENTS) continue;
    calls.push({ id: id.slice(0, 128), name, arguments: args });
  }
  return calls;
}

/** OpenAI-compatible wire shape; an assistant turn that only calls tools has no content. */
function wireMessages(messages: readonly AiMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === 'tool')
      return { role: 'tool', tool_call_id: message.toolCallId ?? '', content: message.content };
    if (message.toolCalls !== undefined && message.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: message.content === '' ? null : message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    return {
      role: message.role,
      content:
        message.images === undefined || message.images.length === 0
          ? message.content
          : [
              { type: 'text', text: message.content },
              ...message.images.map((image) => ({
                type: 'image_url',
                image_url: { url: `data:${image.mime};base64,${Buffer.from(image.bytes).toString('base64')}` },
              })),
            ],
    };
  });
}

/** Preserve JSON number lexemes before they can lose subcent precision in a binary float. Node 24 supplies source. */
function parseJson(input: string): unknown {
  return JSON.parse(input, (_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value !== 'number') return value;
    // The required Node 24 runtime supplies source for primitive numbers; older TS libraries omit that argument.
    const lexeme = context as { source: string };
    return lexeme.source;
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
      if (
        input.tools !== undefined &&
        (input.tools.length > MAX_TOOLS ||
          input.tools.some((tool) => !TOOL_NAME.test(tool.name)) ||
          (input.tools.length > 0 && input.responseSchema !== undefined))
      )
        throw new AiError('AI_INVALID_CONFIG');
      if (input.responseSchema !== undefined && !TOOL_NAME.test(input.responseSchema.name))
        throw new AiError('AI_INVALID_CONFIG');
      if (
        input.messages.some(
          (message) =>
            message.images !== undefined &&
            (message.role !== 'user' ||
              message.images.length > 4 ||
              message.images.some(
                (image: { mime: string; bytes: Uint8Array }) =>
                  image.mime !== 'image/webp' || image.bytes.byteLength > 8 * 1024 * 1024,
              )),
        )
      )
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
        toolCalls: [],
        finishReason: null,
      });
      const requested = input.timeoutMs ?? options.timeoutMs;
      const deadline =
        requested !== undefined && Number.isSafeInteger(requested) && requested > 0
          ? Math.min(requested, TIMEOUT_MS)
          : TIMEOUT_MS;
      const signal = AbortSignal.timeout(deadline);
      try {
        // JSON.rawJSON is provided by the required Node 24 runtime: numeric provider ceilings stay exact.
        const nativeJson = JSON as typeof JSON & { rawJSON: (value: string) => unknown };
        const raw = nativeJson.rawJSON;
        const request = {
          model: input.modelId,
          messages: wireMessages(input.messages),
          max_tokens: input.maxTokens,
          stream: false,
          ...(input.tools === undefined || input.tools.length === 0
            ? {}
            : {
                tools: input.tools.map((tool) => ({
                  type: 'function',
                  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
                })),
                tool_choice: input.toolChoice ?? 'auto',
              }),
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
        };
        const post = (body: unknown) =>
          send(`${base}/chat/completions`, {
            method: 'POST',
            redirect: 'error',
            signal,
            headers: {
              Authorization: `Bearer ${input.apiKey}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(body),
          });
        const schema = input.responseSchema;
        let response = await post(
          schema === undefined
            ? request
            : {
                ...request,
                response_format: {
                  type: 'json_schema',
                  json_schema: { name: schema.name, strict: true, schema: schema.schema },
                },
              },
        );
        if (schema !== undefined && SCHEMA_REFUSALS.has(response.status)) {
          // Refused before generation: retry once, plain, within the same deadline; the answer is validated anyway.
          await response.body?.cancel();
          response = await post(request);
        }
        httpStatus = response.status;
        if (!response.ok) {
          errorCode = `http_${response.status}`;
          await response.body?.cancel();
          return empty();
        }
        const body = recordSchema.parse(await readJson(response));
        const choices = field(body, 'choices');
        const choice = Array.isArray(choices) ? (choices as unknown[])[0] : undefined;
        const message = field(choice, 'message');
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
        return {
          ...empty(),
          ...metering,
          content: text(field(message, 'content')),
          toolCalls: parseToolCalls(field(message, 'tool_calls')),
          finishReason: text(field(choice, 'finish_reason')),
        };
      } catch {
        status = signal.aborted ? 'timeout' : 'error';
        errorCode = signal.aborted ? 'timeout' : httpStatus === null ? 'network' : 'invalid_response';
        return empty();
      }
    },
  };
}
