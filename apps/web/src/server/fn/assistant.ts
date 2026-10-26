// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-AI3 "Asisten ⌘J": a bounded, allowlisted tool loop over the user's own BYOK provider. It answers from aggregated
 * data (cards the dialog renders), and may propose at most one transaction draft. Nothing here writes the ledger: the
 * draft goes back to the browser and is stored only by the existing `recordTransaction` path after a confirmation.
 *
 * Only allowlisted tool names reach the activity log; prompts, answers, tool arguments, and provider bodies never do.
 */
import { createServerFn } from '@tanstack/react-start';
import type { AccountView } from '@wf/db/accounts';
import type { BudgetStatus } from '@wf/db/budgets';
import type { AiDataCounts } from '@wf/domain/ai';
import { AiError, calculateAiCost } from '@wf/domain/ai';
import {
  ASSISTANT_HISTORY_MAX,
  ASSISTANT_MAX_STEPS,
  ASSISTANT_MAX_TOKENS,
  ASSISTANT_QUESTION_MAX,
  ASSISTANT_TIMEOUT_MS,
  assistantBudgetCard,
  assistantInstant,
  assistantSystemPrompt,
  assistantToolDefinitions,
  assistantToolFromName,
  draftImpact,
  findDuplicate,
  parseAssistantAmount,
  sumReportedCost,
  type AssistantAnswer,
  type AssistantCard,
  type AssistantDraft,
  type AssistantTool,
} from '@wf/domain/assistant';
import { addDays, countDays, type LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import type { AiMessage } from '@wf/integrations/ai';
import { toLocalDate } from '@wf/ui/dates';
import * as z from 'zod';
import { categoryNameIn } from '../../lib/ledger-labels.ts';
import { attempt, requireSession, type Result } from '../access.ts';
import { services } from '../runtime.ts';

/** The name a tool argument's date must have, and the longest look-back a draft may claim. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DRAFT_LOOKBACK_DAYS = 90;
const RANGE_MAX_DAYS = 366;
const TAG = /^[a-z0-9][a-z0-9-]{0,63}$/;

const HISTORY = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
});

/**
 * One question with the device's recent turns. `requestId` is the idempotency key of the billed request: a retried
 * send after a dropped connection answers with the first result instead of paying twice.
 */
export const askAssistant = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      requestId: z.uuid(),
      expectedRevision: z.uuid(),
      question: z.string().trim().min(1).max(ASSISTANT_QUESTION_MAX),
      history: z.array(HISTORY).max(ASSISTANT_HISTORY_MAX),
    }),
  )
  .handler(async ({ context, data }): Promise<Result<AssistantAnswer>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, { twoFactor: true }, s.now());
      const settings = await s.ai.settings(user.id);
      // Every answer here may read the ledger, so the permission is the gate for the whole assistant.
      if (!settings.allowReadFinancial) throw new AiError('AI_PERMISSION_REQUIRED');
      const credential = await s.ai.credential(user.id, settings.provider, data.expectedRevision);
      const quote = credential.pricing;
      if (quote === null) throw new AiError('AI_PRICING_REQUIRED');

      const [overview, categories] = await Promise.all([
        s.accounts.list(user.id, { status: 'active' }),
        s.categories.list(user.id),
      ]);
      const timeZone = user.timezone ?? 'Asia/Jakarta';
      const locale: Locale = user.locale === 'en' ? 'en' : 'id';
      const today = toLocalDate(s.now(), timeZone);
      const accounts = overview.accounts.filter((account) => account.status === 'active');

      const system = assistantSystemPrompt({
        locale,
        timeZone,
        today,
        currency: overview.baseCurrency,
        accounts: accounts.map((account) => ({
          id: account.id,
          name: account.displayName,
          currency: account.currency,
        })),
        categories: categories.map((category) => ({
          id: category.id,
          name: categoryNameIn(category, locale),
          group: category.group,
        })),
        budget: true,
        drafts: settings.allowCreateDrafts,
      });

      const counts: AiDataCounts = {
        images: 0,
        categories: categories.length,
        accounts: accounts.length,
        transactions: 0,
      };
      const promptBytes = new TextEncoder().encode(
        `${system}\n${data.history.map((entry) => entry.content).join('\n')}\n${data.question}`,
      ).byteLength;
      // One bound for the whole loop; a settle that reports less returns the difference to the cap.
      const estimate = calculateAiCost(quote, {
        inputTokens: promptBytes + 1_000 * (ASSISTANT_MAX_STEPS - 1),
        outputTokens: ASSISTANT_MAX_TOKENS * ASSISTANT_MAX_STEPS,
        images: 0,
      });
      await s.ai.reserve(user.id, {
        id: data.requestId,
        expectedRevision: data.expectedRevision,
        provider: settings.provider,
        modelId: credential.modelId,
        feature: 'chat',
        costUsd: estimate,
        dataSent: counts,
        needsDraftPermission: settings.allowCreateDrafts,
      });

      const started = s.now().getTime();
      const deadline = started + ASSISTANT_TIMEOUT_MS;
      const cards: AssistantCard[] = [];
      const executed: AssistantTool[] = [];
      const stepCosts: (string | null)[] = [];
      const stepInputs: (number | null)[] = [];
      const stepOutputs: (number | null)[] = [];
      let draft: AssistantDraft | null = null;
      let text = '';
      let httpStatus: number | null = null;
      let budget: BudgetStatus | null = null;

      const budgetOf = async (): Promise<BudgetStatus> => {
        budget ??= await s.budgets.status(user.id);
        return budget;
      };
      const toolDefinitions = assistantToolDefinitions()
        .filter((tool) => tool.name !== 'draf_transaksi' || settings.allowCreateDrafts)
        .map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));

      const messages: AiMessage[] = [
        { role: 'system', content: system },
        ...data.history.map((entry): AiMessage => ({ role: entry.role, content: entry.content })),
        { role: 'user', content: data.question },
      ];

      /** Dates the model may ask for: an inclusive range of real calendar days, at most a year. */
      const rangeOf = (args: Record<string, unknown>): { from: LocalDate; to: LocalDate } | null => {
        const from = args.from;
        const to = args.to;
        if (typeof from !== 'string' || typeof to !== 'string') return null;
        if (
          !DATE.test(from) ||
          !DATE.test(to) ||
          from > to ||
          countDays(from as LocalDate, to as LocalDate) > RANGE_MAX_DAYS
        )
          return null;
        return { from: from as LocalDate, to: to as LocalDate };
      };

      const draftFrom = async (args: Record<string, unknown>): Promise<AssistantDraft | string> => {
        if (!settings.allowCreateDrafts) return 'draft_not_allowed';
        const type = args.type === 'income' ? 'income' : args.type === 'expense' ? 'expense' : null;
        if (type === null) return 'invalid_type';
        const description = typeof args.description === 'string' ? args.description.trim().slice(0, 200) : '';
        if (description === '') return 'invalid_description';
        let amountMinor: bigint;
        try {
          amountMinor = parseAssistantAmount(typeof args.amount === 'string' ? args.amount : '');
        } catch {
          return 'invalid_amount';
        }
        const account = accounts.find((candidate) => candidate.id === args.accountId);
        if (account === undefined) return 'unknown_account';
        const categoryId = typeof args.categoryId === 'string' && args.categoryId !== '' ? args.categoryId : null;
        const category =
          categoryId === null
            ? undefined
            : categories.find(
                (candidate) =>
                  candidate.id === categoryId && candidate.kind === (type === 'expense' ? 'expense' : 'income'),
              );
        if (categoryId !== null && category === undefined) return 'unknown_category';
        const date = args.date;
        if (typeof date !== 'string' || !DATE.test(date)) return 'invalid_date';
        if (date > today || date < addDays(today, -DRAFT_LOOKBACK_DAYS)) return 'date_out_of_range';
        const time = typeof args.time === 'string' ? args.time : '';
        let occurredAt: Date;
        try {
          occurredAt = assistantInstant(date as LocalDate, time, timeZone);
        } catch {
          return 'invalid_time';
        }
        const tags = Array.isArray(args.tags)
          ? args.tags.filter((tag): tag is string => typeof tag === 'string' && TAG.test(tag)).slice(0, 5)
          : [];
        const line =
          categoryId === null
            ? undefined
            : (await budgetOf()).lines.find((candidate) => candidate.categoryId === categoryId);
        const impact = draftImpact({
          amountMinor,
          budgetLine: line === undefined ? null : { limitMinor: line.limitMinor, spentMinor: line.spentMinor },
          account: {
            currency: account.currency,
            balanceMinor: account.balanceMinor,
            ...(account.lowBalanceThresholdMinor === null ? {} : { thresholdMinor: account.lowBalanceThresholdMinor }),
          },
        });
        const nearby = await s.transactionQuery.list(
          user.id,
          {
            from: addDays(date as LocalDate, -1),
            to: addDays(date as LocalDate, 1),
            types: [type],
            accountIds: [account.id],
          },
          { limit: 20 },
        );
        counts.transactions += nearby.rows.length;
        const duplicate = findDuplicate(
          { amountMinor, occurredAt },
          nearby.rows.map((row) => ({
            transactionId: row.id,
            description: row.description ?? row.merchant ?? '',
            localDate: row.localDate,
            amountMinor: row.amountMinor < 0n ? -row.amountMinor : row.amountMinor,
            occurredAt: row.occurredAt,
          })),
        );
        draft = {
          type,
          description,
          amountMinor,
          currency: account.currency,
          accountId: account.id,
          accountName: account.displayName,
          categoryId: category?.id ?? null,
          categoryName: category === undefined ? null : categoryNameIn(category, locale),
          categoryBuiltInKey: category?.builtInKey ?? null,
          occurredAt,
          tags,
          budget: impact.budget,
          balance: impact.balance,
          duplicate,
        };
        return draft;
      };

      /** Runs one allowlisted tool; a refusal is data for the model, never an exception for the request. */
      const runTool = async (name: AssistantTool, raw: string): Promise<unknown> => {
        let args: Record<string, unknown> = {};
        if (raw !== '') {
          try {
            const parsed: unknown = JSON.parse(raw);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
              args = parsed as Record<string, unknown>;
            }
          } catch {
            return { error: 'invalid_arguments' };
          }
        }
        if (name === 'ringkasan_anggaran') {
          const current = await budgetOf();
          const card = assistantBudgetCard({
            from: current.period.start,
            to: current.period.end,
            currency: current.baseCurrency,
            unbudgetedSpentMinor: current.totals.unbudgetedSpentMinor,
            lines: current.lines.map((line) => ({
              categoryId: line.categoryId,
              name: categoryNameIn(line, locale),
              builtInKey: line.builtInKey,
              group: line.group,
              limitMinor: line.limitMinor,
              spentMinor: line.spentMinor,
              count: line.count,
            })),
          });
          cards.push(card);
          return {
            period: { from: current.period.start, to: current.period.end },
            currency: current.baseCurrency,
            lines: current.lines.map((line) => ({
              category: categoryNameIn(line, locale),
              limit: line.limitMinor.toString(),
              spent: line.spentMinor.toString(),
              remaining: (line.limitMinor - line.spentMinor).toString(),
              transactions: line.count,
            })),
            unbudgetedSpent: current.totals.unbudgetedSpentMinor.toString(),
          };
        }
        if (name === 'pengeluaran') {
          const range = rangeOf(args);
          if (range === null) return { error: 'invalid_range' };
          const [summary, groups] = await Promise.all([
            s.transactionQuery.summary(user.id, { ...range, types: ['expense'] }),
            s.transactionQuery.groupByCategory(user.id, { ...range, types: ['expense'] }),
          ]);
          const totals = groups
            .filter((group) => group.kind === 'expense')
            .slice(0, 12)
            .map((group) => {
              const category = categories.find((candidate) => candidate.id === group.categoryId);
              return {
                categoryId: group.categoryId,
                name: category === undefined ? null : categoryNameIn(category, locale),
                builtInKey: category?.builtInKey ?? null,
                totalMinor: group.totalMinor,
                count: group.count,
              };
            });
          cards.push({
            kind: 'spending',
            from: range.from,
            to: range.to,
            currency: overview.baseCurrency,
            totalMinor: summary.outMinor,
            categories: totals,
          });
          return {
            from: range.from,
            to: range.to,
            currency: overview.baseCurrency,
            total: summary.outMinor.toString(),
            averageDaily: summary.averageDailySpendMinor.toString(),
            categories: totals.map((entry) => ({
              category: entry.name ?? 'uncategorized',
              total: entry.totalMinor.toString(),
              transactions: entry.count,
            })),
          };
        }
        if (name === 'transaksi_terbesar') {
          const range = rangeOf(args);
          if (range === null) return { error: 'invalid_range' };
          const page = await s.transactionQuery.list(
            user.id,
            { ...range, types: ['expense'] },
            { sort: 'amount_desc', limit: 5 },
          );
          counts.transactions += page.rows.length;
          const items = page.rows.map((row) => {
            const category = categories.find((candidate) => candidate.id === row.categoryId);
            return {
              id: row.id,
              description: row.description ?? row.merchant ?? '',
              amountMinor: row.amountMinor < 0n ? -row.amountMinor : row.amountMinor,
              localDate: row.localDate,
              categoryName: category === undefined ? null : categoryNameIn(category, locale),
              categoryBuiltInKey: category?.builtInKey ?? null,
            };
          });
          cards.push({
            kind: 'transactions',
            from: range.from,
            to: range.to,
            currency: overview.baseCurrency,
            items,
          });
          return {
            from: range.from,
            to: range.to,
            items: items.map((item) => ({
              description: item.description,
              amount: item.amountMinor.toString(),
              date: item.localDate,
              category: item.categoryName,
            })),
          };
        }
        if (name === 'saldo_rekening') {
          const card: AssistantCard = {
            kind: 'accounts',
            currency: overview.baseCurrency,
            items: accounts.map((account: AccountView) => ({
              id: account.id,
              name: account.displayName,
              currency: account.currency,
              balanceMinor: account.balanceMinor,
            })),
          };
          cards.push(card);
          return {
            baseCurrency: overview.baseCurrency,
            accounts: accounts.map((account) => ({
              account: account.displayName,
              currency: account.currency,
              balance: account.balanceMinor.toString(),
            })),
          };
        }
        const built = await draftFrom(args);
        if (typeof built === 'string') return { error: built };
        return {
          ok: true,
          draft: {
            type: built.type,
            description: built.description,
            amount: built.amountMinor.toString(),
            currency: built.currency,
            account: built.accountName,
            category: built.categoryName,
            date: toLocalDate(built.occurredAt, timeZone),
            time: new Intl.DateTimeFormat('en-GB', {
              timeZone,
              hour: '2-digit',
              minute: '2-digit',
              hourCycle: 'h23',
            }).format(built.occurredAt),
          },
          impact: {
            budgetUsedPercent: built.budget === null ? null : Math.round(built.budget.usedBps / 100),
            balanceAfter: built.balance === null ? null : built.balance.afterMinor.toString(),
          },
          duplicate: built.duplicate !== null,
        };
      };

      const outcome = await (async (): Promise<{ status: 'ok' | 'error' | 'timeout'; errorCode: string | null }> => {
        try {
          for (let step = 0; step < ASSISTANT_MAX_STEPS; step++) {
            const remaining = deadline - s.now().getTime();
            if (remaining <= 0) return { status: 'timeout', errorCode: 'timeout' };
            const result = await s.aiClient.complete({
              ...credential,
              messages,
              maxTokens: ASSISTANT_MAX_TOKENS,
              pricing: quote,
              tools: toolDefinitions,
              timeoutMs: remaining,
            });
            httpStatus = result.httpStatus ?? httpStatus;
            stepCosts.push(result.costUsd);
            stepInputs.push(result.inputTokens);
            stepOutputs.push(result.outputTokens);
            if (result.status !== 'ok') return { status: result.status, errorCode: result.errorCode };
            if (result.toolCalls.length === 0) {
              text = result.content ?? '';
              return { status: 'ok', errorCode: null };
            }
            messages.push({ role: 'assistant', content: result.content ?? '', toolCalls: result.toolCalls });
            for (const call of result.toolCalls) {
              const tool = assistantToolFromName(call.name);
              const output = tool === null ? { error: 'unknown_tool' } : await runTool(tool, call.arguments);
              if (tool !== null && !executed.includes(tool)) executed.push(tool);
              messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(output) });
            }
            // The last step must answer; another tool round would exceed the loop.
            if (step === ASSISTANT_MAX_STEPS - 1) return { status: 'error', errorCode: 'step_limit' };
          }
          return { status: 'error', errorCode: 'step_limit' };
        } catch {
          // A repository or tool failure is not a provider answer; the log keeps a code, the browser gets the summary.
          return { status: 'error', errorCode: 'internal' };
        }
      })();

      const reported = sumReportedCost(stepCosts);
      const sum = (values: readonly (number | null)[]): number | null =>
        values.length === 0 || values.some((value) => value === null)
          ? null
          : values.reduce<number>((total, value) => total + (value ?? 0), 0);
      const usage = await s.ai.settle(user.id, data.requestId, {
        status: outcome.status,
        httpStatus,
        inputTokens: sum(stepInputs),
        outputTokens: sum(stepOutputs),
        costUsd: reported,
        costSource: reported === null ? 'estimated' : 'reported',
        durationMs: Math.max(0, s.now().getTime() - started),
        errorCode: outcome.errorCode,
        toolCalls: executed,
        connectionStatus: outcome.status === 'ok' ? 'connected' : 'error',
        pricing: quote,
        // The tool loop knows the real counts only now; the reserved estimate may have guessed them.
        dataSent: counts,
      });
      if (outcome.status !== 'ok') {
        throw new AiError(outcome.status === 'timeout' ? 'AI_TIMEOUT' : 'AI_ASSISTANT_FAILED');
      }
      return {
        text,
        cards,
        draft,
        provider: settings.provider,
        modelId: credential.modelId,
        toolCalls: executed,
        usage,
      };
    });
  });
