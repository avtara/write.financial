// SPDX-License-Identifier: AGPL-3.0-only
import { formatDecimal, parseDecimal } from './decimal.ts';

export const AI_PROVIDERS = ['openrouter', 'zenmux', 'custom'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const AI_FEATURES = ['test', 'chat', 'receipt', 'categorize', 'gmail'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];
export const AI_LOG_STATUSES = ['pending', 'ok', 'error', 'timeout', 'blocked'] as const;
export type AiLogStatus = (typeof AI_LOG_STATUSES)[number];
export type AiConnectionStatus = 'not_connected' | 'untested' | 'connected' | 'invalid_key' | 'error';
export type AiCostSource = 'reported' | 'estimated' | 'free' | 'unknown';

export const AI_ERROR_CODES = [
  'AI_INVALID_CONFIG',
  'AI_NOT_CONFIGURED',
  'AI_CONFIG_CHANGED',
  'AI_PERMISSION_REQUIRED',
  'AI_COST_LIMIT',
  'AI_PRICING_REQUIRED',
  'AI_EGRESS_DENIED',
  'AI_PROVIDER_FAILED',
  'AI_REQUEST_EXISTS',
  'AI_TIMEOUT',
  'AI_ASSISTANT_FAILED',
  'AI_MODEL_REASONING_REQUIRED',
  'AI_MODEL_TOOLS_REQUIRED',
  'AI_REASONING_ONLY',
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/** Error messages never interpolate credentials, prompts, or provider response bodies. */
export class AiError extends Error {
  override readonly name = 'AiError';
  readonly code: AiErrorCode;
  constructor(code: AiErrorCode) {
    super(code);
    this.code = code;
  }
}
export const AI_BASE_URLS = { openrouter: 'https://openrouter.ai/api/v1', zenmux: 'https://zenmux.ai/api/v1' } as const;

export function resolveAiBaseUrl(provider: AiProvider, input: string | undefined, allowed: readonly string[]): string {
  if (provider !== 'custom') return AI_BASE_URLS[provider];
  const parsed = URL.parse(input ?? '');
  if (
    parsed === null ||
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new AiError('AI_INVALID_CONFIG');
  }
  const normalized = parsed.href.replace(/\/+$/, '');
  if (!allowed.includes(normalized)) throw new AiError('AI_EGRESS_DENIED');
  return normalized;
}

/** USD decimal strings; token rates are per million, not per token. */
export interface AiPricing {
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
  requestUsd: string;
  imageUsd: string;
}

export interface AiConnectionView {
  provider: AiProvider;
  baseUrl: string;
  last4: string | null;
  status: AiConnectionStatus;
  modelId: string | null;
  addedAt: Date | null;
  testedAt: Date | null;
  errorCode: string | null;
  httpStatus: number | null;
  /** The model's provider-catalog prices, stored when the settings are saved; null means paid requests are refused. */
  pricing: AiPricing | null;
  pricingSource: 'catalog' | null;
}

export interface AiUsageSummary {
  /** User-local request-start month, YYYY-MM. */
  month: string;
  requests: number;
  /** Accounted spend, including the estimated subset below. */
  spentUsd: string;
  estimatedUsd: string;
  reservedUsd: string;
  limitUsd: string;
}

export interface AiSettingsView {
  /** Changes only when configuration changes, not when logs/usage change. */
  revision: string | null;
  twoFactorEnabled: boolean;
  provider: AiProvider;
  connections: readonly AiConnectionView[];
  allowReadFinancial: boolean;
  allowCreateDrafts: boolean;
  requireConfirmation: true;
  monthlyLimitUsd: string;
  usage: AiUsageSummary;
  allowedCustomBaseUrls: readonly string[];
}

/** Carries no prices: the server stores the chosen model's provider-catalog prices and refuses a model without them. */
export interface AiSettingsInput {
  expectedRevision: string | null;
  provider: AiProvider;
  baseUrl?: string;
  /** Omit to retain the saved key. Removing a key is an explicit separate action. */
  apiKey?: string;
  modelId: string;
  allowReadFinancial: boolean;
  allowCreateDrafts: boolean;
  requireConfirmation: true;
  monthlyLimitUsd: string;
}

/**
 * How a model reasons, from the provider catalog: `none` never reasons, `optional` reasons unless the request switches
 * it off (`reasoning: { enabled: false }`), `mandatory` always reasons and would spend the answer budget on it.
 */
export type AiReasoning = 'none' | 'optional' | 'mandatory';
/** What a saved connection stores: a model with mandatory reasoning is never saved. */
export type AiConnectionReasoning = Exclude<AiReasoning, 'mandatory'>;

export interface AiModel {
  id: string;
  name: string;
  contextLength: number | null;
  maxOutputTokens: number | null;
  pricing: AiPricing | null;
  reasoning: AiReasoning;
  /** Whether the model can call tools (the Assistant needs them); `null` when the catalog does not say. */
  tools: boolean | null;
}

/** Why a catalog model cannot be chosen. */
export type AiModelUnsupported = 'no_pricing' | 'reasoning_required' | 'no_tools';

/** The refusal a save of an unsupported model answers with. */
export const AI_UNSUPPORTED_ERRORS: Readonly<Record<AiModelUnsupported, AiErrorCode>> = {
  no_pricing: 'AI_PRICING_REQUIRED',
  reasoning_required: 'AI_MODEL_REASONING_REQUIRED',
  no_tools: 'AI_MODEL_TOOLS_REQUIRED',
};

/**
 * `null` when the app can use the model: priced in the catalog (never treated as free), reasoning the app can switch
 * off, and tool calling unless the catalog does not say.
 */
export function aiModelSupport(model: Pick<AiModel, 'pricing' | 'reasoning' | 'tools'>): AiModelUnsupported | null {
  if (model.pricing === null) return 'no_pricing';
  if (model.reasoning === 'mandatory') return 'reasoning_required';
  if (model.tools === false) return 'no_tools';
  return null;
}

/** The adapter's `errorCode` for an answer cut off at `max_tokens` while it was (mostly) still reasoning. */
export const AI_REASONING_EXHAUSTED = 'reasoning_exhausted';

/** The refusal for a completion that did not finish. */
export function aiFailureCode(status: 'error' | 'timeout', errorCode: string | null): AiErrorCode {
  if (status === 'timeout') return 'AI_TIMEOUT';
  return errorCode === AI_REASONING_EXHAUSTED ? 'AI_REASONING_ONLY' : 'AI_ASSISTANT_FAILED';
}

export interface AiModelCatalog {
  provider: AiProvider;
  models: readonly AiModel[];
  loadedAt: Date;
  /** Public catalogs do not authenticate a key or establish connection success. */
  catalogPublic: boolean;
}

/** Counts only. Never put names, balances, merchant text, prompts, or tool arguments here. */
export interface AiDataCounts {
  images: number;
  categories: number;
  accounts: number;
  transactions: number;
}

export interface AiLogView {
  id: string;
  createdAt: Date;
  provider: AiProvider;
  feature: AiFeature;
  modelId: string | null;
  status: AiLogStatus;
  httpStatus: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null;
  costSource: AiCostSource;
  durationMs: number;
  dataSent: AiDataCounts;
  /** Allowlisted tool names only; full arguments belong on the user's device. */
  toolCalls: readonly string[];
  errorCode: string | null;
}

export interface AiLogFilters {
  feature?: AiFeature;
  status?: AiLogStatus;
}

export interface AiLogsPage {
  items: readonly AiLogView[];
  total: number;
  /** Errors, timeouts and blocked attempts across all matching 30-day rows, not only this page. */
  failed: number;
}

export interface AiLogExport {
  csv: string;
  fileName: string;
}

export interface AiConnectionTestInput {
  provider: AiProvider;
  expectedRevision: string;
  requestId: string;
}

export interface AiConnectionTestResult {
  connection: AiConnectionView;
  usage: AiUsageSummary;
}

/** Nonnegative exact USD. Invalid input is not repeated in an exception/log. */
export function parseAiUsd(value: string): bigint {
  try {
    const parsed = parseDecimal(value);
    if (parsed < 0n) throw new AiError('AI_INVALID_CONFIG');
    return parsed;
  } catch {
    throw new AiError('AI_INVALID_CONFIG');
  }
}

export function normalizeAiPricing(pricing: AiPricing): AiPricing {
  return {
    inputUsdPerMillion: formatDecimal(parseAiUsd(pricing.inputUsdPerMillion)),
    outputUsdPerMillion: formatDecimal(parseAiUsd(pricing.outputUsdPerMillion)),
    requestUsd: formatDecimal(parseAiUsd(pricing.requestUsd)),
    imageUsd: formatDecimal(parseAiUsd(pricing.imageUsd)),
  };
}

function count(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new AiError('AI_INVALID_CONFIG');
  return BigInt(value);
}

/** Round each variable charge upward to the database's 10^-18 USD quantum. */
export function calculateAiCost(
  pricing: AiPricing,
  usage: { inputTokens: number; outputTokens: number; images: number },
): string {
  const million = 1_000_000n;
  const input = parseAiUsd(pricing.inputUsdPerMillion) * count(usage.inputTokens);
  const output = parseAiUsd(pricing.outputUsdPerMillion) * count(usage.outputTokens);
  return formatDecimal(
    (input + million - 1n) / million +
      (output + million - 1n) / million +
      parseAiUsd(pricing.requestUsd) +
      parseAiUsd(pricing.imageUsd) * count(usage.images),
  );
}

/** Reservations participate in the same cap as settled costs, including at a zero cap. */
export function canReserveAiCost(values: {
  spentUsd: string;
  reservedUsd: string;
  nextUsd: string;
  limitUsd: string;
}): boolean {
  return (
    parseAiUsd(values.spentUsd) + parseAiUsd(values.reservedUsd) + parseAiUsd(values.nextUsd) <=
    parseAiUsd(values.limitUsd)
  );
}
