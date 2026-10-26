// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-AI3 assistant, pure side: the bounded tool surface the model may call, the answer it may produce (data cards and
 * at most one unsaved draft with its impact), duplicate detection, and the privacy mask for amounts inside prose.
 *
 * Nothing here writes: a draft is a proposal the dialog shows, and only the existing `recordTransaction` path stores
 * it after the user confirms. Prompts and answers never leave the request; only allowlisted tool names are logged.
 */
import type { AiUsageSummary } from './ai.ts';
import type { CategoryGroup } from './categories.ts';
import type { BuiltInCategoryKey } from './categories.ts';
import { formatDecimal, parseDecimal } from './decimal.ts';
import type { LocalDate } from './period.ts';

/** Providers reject unbounded conversations; the dialog keeps the same window on the device. */
export const ASSISTANT_HISTORY_MAX = 12;
export const ASSISTANT_QUESTION_MAX = 500;
/** One answer may need a follow-up tool call; more than this is a loop, not an answer. */
export const ASSISTANT_MAX_STEPS = 4;
export const ASSISTANT_MAX_TOKENS = 700;
/** Hard stop for the whole loop, matching the design's "Timeout 30 detik". */
export const ASSISTANT_TIMEOUT_MS = 30_000;
/** A draft above this is almost certainly a misread amount; refuse rather than show an absurd impact. */
export const ASSISTANT_MAX_DRAFT_MINOR = 1_000_000_000_000n;
/** "di bawah batas Rp500.000": a balance warning threshold, in the account's currency. */
export const ASSISTANT_LOW_BALANCE_MINOR = 500_000n;

export const ASSISTANT_TOOLS = [
  'ringkasan_anggaran',
  'pengeluaran',
  'transaksi_terbesar',
  'saldo_rekening',
  'draf_transaksi',
] as const;
export type AssistantTool = (typeof ASSISTANT_TOOLS)[number];

/** Tools that read the ledger; every one of them needs `allowReadFinancial`. */
export const ASSISTANT_READ_TOOLS: readonly AssistantTool[] = [
  'ringkasan_anggaran',
  'pengeluaran',
  'transaksi_terbesar',
  'saldo_rekening',
];

export interface AssistantBudgetLine {
  readonly categoryId: string;
  readonly name: string;
  /** Set for built-in categories; the UI translates it instead of showing the stored key. */
  readonly builtInKey: BuiltInCategoryKey | null;
  readonly group: CategoryGroup;
  readonly limitMinor: bigint;
  readonly spentMinor: bigint;
  readonly remainingMinor: bigint;
  /** Rounded; `null` without a limit. 3.200.000 of 3.500.000 → 9143, shown as 91%. */
  readonly usedBps: number | null;
  readonly count: number;
}

export interface AssistantCategoryTotal {
  /** `null` = uncategorized. */
  readonly categoryId: string | null;
  readonly name: string | null;
  readonly builtInKey: BuiltInCategoryKey | null;
  /** Positive, in the base currency. */
  readonly totalMinor: bigint;
  readonly count: number;
}

export interface AssistantTransactionItem {
  readonly id: string;
  readonly description: string;
  readonly amountMinor: bigint;
  readonly localDate: LocalDate;
  readonly categoryName: string | null;
  readonly categoryBuiltInKey: BuiltInCategoryKey | null;
}

export interface AssistantAccountItem {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly balanceMinor: bigint;
}

/** Data cards are the sources of an answer: each one links to the page that holds the same numbers. */
export type AssistantCard =
  | {
      readonly kind: 'budget';
      readonly from: LocalDate;
      readonly to: LocalDate;
      readonly currency: string;
      readonly lines: readonly AssistantBudgetLine[];
      readonly unbudgetedSpentMinor: bigint;
    }
  | {
      readonly kind: 'spending';
      readonly from: LocalDate;
      readonly to: LocalDate;
      readonly currency: string;
      readonly totalMinor: bigint;
      readonly categories: readonly AssistantCategoryTotal[];
    }
  | {
      readonly kind: 'transactions';
      readonly from: LocalDate;
      readonly to: LocalDate;
      readonly currency: string;
      readonly items: readonly AssistantTransactionItem[];
    }
  | { readonly kind: 'accounts'; readonly currency: string; readonly items: readonly AssistantAccountItem[] };

export interface AssistantDraftBudgetImpact {
  readonly limitMinor: bigint;
  /** Spending of the category once the draft is recorded. */
  readonly spentAfterMinor: bigint;
  readonly usedBps: number;
}

export interface AssistantDraftBalanceImpact {
  readonly currency: string;
  readonly afterMinor: bigint;
  readonly thresholdMinor: bigint;
}

/** An existing transaction a draft would double-record (merchant + time ±2 h + amount ±1%). */
export interface AssistantDuplicate {
  readonly transactionId: string;
  readonly description: string;
  readonly localDate: LocalDate;
  readonly amountMinor: bigint;
}

/** A proposal only. `occurredAt` is an instant; the dialog shows it in the viewer's zone. */
export interface AssistantDraft {
  readonly type: 'expense' | 'income';
  readonly description: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly categoryBuiltInKey: BuiltInCategoryKey | null;
  readonly occurredAt: Date;
  readonly tags: readonly string[];
  readonly budget: AssistantDraftBudgetImpact | null;
  readonly balance: AssistantDraftBalanceImpact | null;
  readonly duplicate: AssistantDuplicate | null;
}

export interface AssistantAnswer {
  readonly text: string;
  readonly cards: readonly AssistantCard[];
  readonly draft: AssistantDraft | null;
  readonly provider: 'openrouter' | 'zenmux' | 'custom';
  readonly modelId: string;
  readonly toolCalls: readonly AssistantTool[];
  /** The month's meter after this answer, for the dialog header. */
  readonly usage: AiUsageSummary;
}

/** Rounded basis points; `null` without a limit (a category the budget does not cap). */
export function usedBps(spentMinor: bigint, limitMinor: bigint): number | null {
  if (limitMinor <= 0n) return null;
  return Number((spentMinor * 10_000n + limitMinor / 2n) / limitMinor);
}

/** The budget card of a period, with the remaining amount and the share used per category. */
export function assistantBudgetCard(input: {
  readonly from: LocalDate;
  readonly to: LocalDate;
  readonly currency: string;
  readonly unbudgetedSpentMinor: bigint;
  readonly lines: readonly {
    readonly categoryId: string;
    readonly name: string;
    readonly builtInKey: BuiltInCategoryKey | null;
    readonly group: CategoryGroup;
    readonly limitMinor: bigint;
    readonly spentMinor: bigint;
    readonly count: number;
  }[];
}): AssistantCard {
  return {
    kind: 'budget',
    from: input.from,
    to: input.to,
    currency: input.currency,
    unbudgetedSpentMinor: input.unbudgetedSpentMinor,
    lines: input.lines.map((line) => ({
      categoryId: line.categoryId,
      name: line.name,
      builtInKey: line.builtInKey,
      group: line.group,
      limitMinor: line.limitMinor,
      spentMinor: line.spentMinor,
      remainingMinor: line.limitMinor - line.spentMinor,
      usedBps: usedBps(line.spentMinor, line.limitMinor),
      count: line.count,
    })),
  };
}

/**
 * The impact shown before saving: the category's share of its limit afterwards, and the account balance afterwards
 * when an account (and its limit) is known. Amounts are the account's own currency.
 */
export function draftImpact(input: {
  readonly amountMinor: bigint;
  readonly budgetLine: { readonly limitMinor: bigint; readonly spentMinor: bigint } | null;
  readonly account: {
    readonly currency: string;
    readonly balanceMinor: bigint;
    readonly thresholdMinor?: bigint;
  } | null;
}): { readonly budget: AssistantDraftBudgetImpact | null; readonly balance: AssistantDraftBalanceImpact | null } {
  const spentAfter = input.budgetLine === null ? 0n : input.budgetLine.spentMinor + input.amountMinor;
  return {
    budget:
      input.budgetLine === null
        ? null
        : {
            limitMinor: input.budgetLine.limitMinor,
            spentAfterMinor: spentAfter,
            usedBps: usedBps(spentAfter, input.budgetLine.limitMinor) ?? 0,
          },
    balance:
      input.account === null
        ? null
        : {
            currency: input.account.currency,
            afterMinor: input.account.balanceMinor - input.amountMinor,
            thresholdMinor: input.account.thresholdMinor ?? ASSISTANT_LOW_BALANCE_MINOR,
          },
  };
}

/** `a` within 1% of `b`, both non-negative. */
function sameAmount(a: bigint, b: bigint): boolean {
  const larger = a > b ? a : b;
  const difference = a > b ? a - b : b - a;
  return larger === 0n ? difference === 0n : difference * 100n <= larger;
}

/**
 * The first candidate that looks like the same purchase: the same amount (±1%) recorded within two hours. Order is
 * the caller's (newest first), so the closest candidate wins when the user has several.
 */
export function findDuplicate(
  draft: { readonly amountMinor: bigint; readonly occurredAt: Date },
  candidates: readonly {
    readonly transactionId: string;
    readonly description: string;
    readonly localDate: LocalDate;
    readonly amountMinor: bigint;
    readonly occurredAt: Date;
  }[],
): AssistantDuplicate | null {
  const twoHours = 2 * 60 * 60 * 1000;
  for (const candidate of candidates) {
    if (!sameAmount(draft.amountMinor, candidate.amountMinor)) continue;
    if (Math.abs(candidate.occurredAt.getTime() - draft.occurredAt.getTime()) > twoHours) continue;
    return {
      transactionId: candidate.transactionId,
      description: candidate.description,
      localDate: candidate.localDate,
      amountMinor: candidate.amountMinor,
    };
  }
  return null;
}

const MASK = '••••••';
const AMOUNT = /(?<![\p{L}\p{N}])(Rp|IDR|US\$|USD|\$)\s?\d[\d.,]*/gu;

/**
 * FR-S3 privacy mode inside prose: every currency amount becomes `Rp••••••` (or `$••••••`), while percentages,
 * dates, and token counts stay readable. Sentence structure is left alone.
 */
export function maskAssistantAmounts(text: string): string {
  return text.replace(
    AMOUNT,
    (_match, currency: string) => `${currency === 'US$' || currency === 'USD' || currency === '$' ? '$' : 'Rp'}${MASK}`,
  );
}

/**
 * Exact minor units from a provider string: digits only, at least 1, never a float or an exponent. Unlike the money
 * helpers this is not scaled (it is already a count of minor units).
 */
export function parseAssistantAmount(value: string): bigint {
  if (!/^\d{1,18}$/.test(value)) throw new RangeError('assistant amount is not a whole minor-unit string');
  const amount = BigInt(value);
  if (amount <= 0n || amount > ASSISTANT_MAX_DRAFT_MINOR)
    throw new RangeError('assistant amount is outside the accepted range');
  return amount;
}

/** The zone's offset (local − UTC) at `instant`, in milliseconds. */
function zoneOffset(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return asUtc - instant.getTime();
}

/** `HH:mm` on `date` in `timeZone` → the instant; invalid input is refused instead of guessed. */
export function assistantInstant(date: LocalDate, time: string, timeZone: string): Date {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new RangeError('assistant time is not HH:mm');
  const wall = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(wall) || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new RangeError('assistant date is not a calendar date');
  // The wall clock is parsed as UTC; subtract the zone's offset, resolved twice so the second pass sees the instant's
  // own offset at a daylight-saving change.
  const first = wall - zoneOffset(new Date(wall), timeZone);
  return new Date(wall - zoneOffset(new Date(first), timeZone));
}

/** Only these tool names reach the activity log. */
export function assistantToolFromName(name: string): AssistantTool | null {
  return (ASSISTANT_TOOLS as readonly string[]).includes(name) ? (name as AssistantTool) : null;
}

export interface AssistantContext {
  readonly locale: 'id' | 'en';
  readonly timeZone: string;
  readonly today: LocalDate;
  readonly currency: string;
  readonly accounts: readonly { readonly id: string; readonly name: string; readonly currency: string }[];
  readonly categories: readonly { readonly id: string; readonly name: string; readonly group: CategoryGroup }[];
  readonly budget: boolean;
  readonly drafts: boolean;
}

/**
 * The system prompt. It carries names and identifiers only — never balances, amounts, merchants, or notes — and tells
 * the model that a draft is a proposal: the app stores it, not the model.
 */
export function assistantSystemPrompt(context: AssistantContext): string {
  const accounts = context.accounts
    .map((account) => `- ${account.id} | ${account.name} (${account.currency})`)
    .join('\n');
  const categories = context.categories
    .map((category) => `- ${category.id} | ${category.name} (${category.group})`)
    .join('\n');
  return [
    'You are the assistant inside write.financial, a personal finance app.',
    `Answer in ${context.locale === 'id' ? 'Bahasa Indonesia' : 'English'}. Be brief and concrete.`,
    `Today is ${context.today} in ${context.timeZone}. Amounts in the base currency ${context.currency} are integers in its minor unit.`,
    'Use the provided tools to read the ledger. Never invent amounts, categories, or account ids; if the data you need is not in a tool result, say so.',
    'You can propose one transaction with draf_transaksi. The app stores it only after the user confirms; you never record, edit, or delete anything yourself.',
    'Ask for a missing amount, account, or date instead of guessing. Do not ask for permission you were not given.',
    '',
    'Accounts you may use:',
    accounts === '' ? '(none)' : accounts,
    '',
    'Categories you may use:',
    categories === '' ? '(none)' : categories,
    '',
    context.budget
      ? 'Budget tools are available.'
      : 'The user did not allow reading financial data, so ledger tools are unavailable; answer only from what the user typed.',
    context.drafts
      ? 'The user allows transaction drafts.'
      : 'Draft creation is not allowed; do not call draf_transaksi.',
  ].join('\n');
}

/** JSON schemas of the tools, provider-side function definitions (OpenAI-compatible `tools`). */
export function assistantToolDefinitions(): readonly {
  readonly name: AssistantTool;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}[] {
  const range = {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Inclusive start date, YYYY-MM-DD.' },
      to: { type: 'string', description: 'Inclusive end date, YYYY-MM-DD.' },
    },
    required: ['from', 'to'],
    additionalProperties: false,
  };
  return [
    {
      name: 'ringkasan_anggaran',
      description:
        'Budget lines of the current period: limit, spending so far, remaining amount, and share used per category.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'pengeluaran',
      description: 'Expense totals per category, and the total, for a date range.',
      parameters: range,
    },
    {
      name: 'transaksi_terbesar',
      description: 'The largest transactions of a date range, largest first (at most 5).',
      parameters: range,
    },
    {
      name: 'saldo_rekening',
      description: 'Current balances of the user’s active accounts, in each account’s own currency.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'draf_transaksi',
      description:
        'Propose one expense or income for the user to confirm. Call it only when the type, amount, account, and date are known.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['expense', 'income'] },
          description: { type: 'string', description: 'Short label, e.g. "Makan siang".' },
          amount: { type: 'string', description: 'Positive integer in the account currency minor unit.' },
          accountId: { type: 'string', description: 'An id from the account list.' },
          categoryId: { type: 'string', description: 'An id from the category list, or empty when unknown.' },
          date: { type: 'string', description: 'Local date YYYY-MM-DD.' },
          time: { type: 'string', description: 'Local time HH:mm.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'At most 5 tag slugs.' },
        },
        required: ['type', 'description', 'amount', 'accountId', 'date', 'time'],
        additionalProperties: false,
      },
    },
  ];
}

/** Exact USD sum of provider costs; `null` when any step did not report one. */
export function sumReportedCost(costs: readonly (string | null)[]): string | null {
  if (costs.length === 0 || costs.some((cost) => cost === null)) return null;
  let total = 0n;
  for (const cost of costs) total += parseDecimal(cost as string);
  return formatDecimal(total);
}
