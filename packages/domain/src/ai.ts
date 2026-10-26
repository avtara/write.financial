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
  pricing: AiPricing | null;
  pricingSource: 'catalog' | 'manual' | null;
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
  /** null asks the server to use provider catalog pricing; missing prices never mean free. */
  pricing: AiPricing | null;
}

export interface AiModel {
  id: string;
  name: string;
  contextLength: number | null;
  maxOutputTokens: number | null;
  pricing: AiPricing | null;
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
