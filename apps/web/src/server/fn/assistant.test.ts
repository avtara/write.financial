// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { generateDek } from '@wf/crypto/envelope';
import { createAccounts } from '@wf/db/accounts';
import { createAiRepository } from '@wf/db/ai';
import { createBudgets } from '@wf/db/budgets';
import { createCategories } from '@wf/db/categories';
import { seedLedger } from '@wf/db/seed';
import { createTransactionQuery } from '@wf/db/transaction-query';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '@wf/db/testing';
import type { AiSettingsInput, AiSettingsView } from '@wf/domain/ai';
import type { AssistantAnswer } from '@wf/domain/assistant';
import { createAiClient, type AiClient } from '@wf/integrations/ai';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext } from '../../../test/server-fn.ts';
import type { Result } from '../access.ts';
import type { Services } from '../runtime.ts';
import { askAssistant } from './assistant.ts';

const running = vi.hoisted(() => ({ services: null as Services | null }));
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () =>
    running.services !== null ? Promise.resolve(running.services) : Promise.reject(new Error('services not started')),
}));

const USER = fakeSession().user.id;
const dek = generateDek();
const getDek = () => Promise.resolve(dek);
const pricing = { inputUsdPerMillion: '0.000001', outputUsdPerMillion: '0.000002', requestUsd: '0', imageUsd: '0' };
const key = `fixture-ai-${randomUUID()}`;

/** One scripted provider answer; `undefined` answers with plain text. */
type Step = (body: Record<string, unknown>) => Response;
let script: Step[] = [];
let requests: Record<string, unknown>[] = [];

const answer = (content: string) => ({
  choices: [{ message: { content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 120, completion_tokens: 20, cost: '0.0002' },
});
const toolCall = (name: string, args: unknown) => ({
  choices: [
    {
      message: {
        content: null,
        tool_calls: [{ id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
      },
      finish_reason: 'tool_calls',
    },
  ],
  usage: { prompt_tokens: 120, completion_tokens: 10, cost: '0.0001' },
});

const fetcher = vi.fn<typeof fetch>((_url, init) => {
  const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>;
  requests.push(body);
  const next = script.shift();
  return Promise.resolve(next === undefined ? Response.json(answer('Siap.')) : next(body));
});

let test: TestDatabase;
let ai: ReturnType<typeof createAiRepository>;
let transactionQuery: ReturnType<typeof createTransactionQuery>;
let settings: AiSettingsView | undefined;
let goPayId: string;
let foodId: string;
let bcaId: string;
let activeClient: AiClient;
const realClient = createAiClient({ allowedBaseUrls: [], fetch: fetcher, now: () => NOW });

const context = (twoFactorEnabled = true) => requestContext(fakeSession({ twoFactorEnabled }));
const invoke = (data: unknown, twoFactorEnabled = true) =>
  test.as('wf_app', () => call<Result<AssistantAnswer>>(askAssistant, { context: context(twoFactorEnabled), data }));
const question = (extra: Record<string, unknown> = {}) => ({
  requestId: randomUUID(),
  expectedRevision: settings?.revision ?? '',
  question: 'Berapa sisa anggaran Makan bulan ini?',
  history: [],
  ...extra,
});
const transactionCount = async () =>
  (await test.query<{ count: number }>('SELECT count(*)::int AS count FROM transactions WHERE user_id = $1', [USER]))[0]
    ?.count;
const saveSettings = async (extra: Partial<AiSettingsInput> = {}) => {
  settings = await test.as('wf_app', () =>
    ai.save(USER, {
      expectedRevision: settings?.revision ?? null,
      provider: 'openrouter',
      apiKey: key,
      modelId: 'fixture/model',
      allowReadFinancial: true,
      allowCreateDrafts: true,
      requireConfirmation: true,
      monthlyLimitUsd: '5',
      pricing,
      ...extra,
    }),
  );
  return settings;
};

beforeAll(async () => {
  test = await startMigrated();
  await test.query(
    `INSERT INTO users (id, name, email, role) VALUES ($1, 'Avtara', 'assistant@example.test', 'user')`,
    [USER],
  );
  await test.query(`UPDATE users SET two_factor_enabled = true, timezone = 'Asia/Jakarta' WHERE id = $1`, [USER]);
  await test.as('wf_app', () => seedLedger(test.db, USER, { getDek, now: () => NOW }));
  const [goPay] = await test.query<{ id: string }>(
    `SELECT id FROM accounts WHERE user_id = $1 AND display_name = 'GoPay'`,
    [USER],
  );
  const [bca] = await test.query<{ id: string }>(
    `SELECT id FROM accounts WHERE user_id = $1 AND display_name = 'BCA Tahapan'`,
    [USER],
  );
  const [food] = await test.query<{ id: string }>(
    `SELECT id FROM categories WHERE user_id = $1 AND name = 'system:food'`,
    [USER],
  );
  if (goPay === undefined || bca === undefined || food === undefined) throw new Error('seed fixture missing');
  goPayId = goPay.id;
  bcaId = bca.id;
  foodId = food.id;
  ai = createAiRepository(test.db, { getDek, allowedBaseUrls: [], now: () => NOW });
  transactionQuery = createTransactionQuery(test.db, { getDek });
  activeClient = realClient;
  running.services = {
    now: () => NOW,
    ai,
    get aiClient() {
      return activeClient;
    },
    accounts: createAccounts(test.db, { now: () => NOW }),
    categories: createCategories(test.db, { getDek }),
    budgets: createBudgets(test.db, { now: () => NOW }),
    transactionQuery,
  } as unknown as Services;
  await saveSettings();
}, PGLITE_HOOK_TIMEOUT * 2);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  script = [];
  requests = [];
  activeClient = realClient;
  await saveSettings({
    expectedRevision: settings?.revision ?? null,
    allowReadFinancial: true,
    allowCreateDrafts: true,
  });
});

describe('assistant answers', () => {
  it('answers from an allowlisted budget tool, returns its card, and never writes', async () => {
    const before = await transactionCount();
    script.push(
      () => Response.json(toolCall('ringkasan_anggaran', {})),
      () => Response.json(answer('Makan & Dapur terpakai Rp3.200.000 dari Rp3.500.000 (91%).')),
    );
    const result = await invoke(question());
    if (!result.ok) throw new Error(result.code);

    expect(result.value.text).toBe('Makan & Dapur terpakai Rp3.200.000 dari Rp3.500.000 (91%).');
    expect(result.value.toolCalls).toEqual(['ringkasan_anggaran']);
    const card = result.value.cards.find((entry) => entry.kind === 'budget');
    expect(card).toMatchObject({ kind: 'budget', currency: 'IDR' });
    const food = card?.kind === 'budget' ? card.lines.find((line) => line.categoryId === foodId) : undefined;
    expect(food).toMatchObject({
      name: 'Makan & Dapur',
      builtInKey: 'system:food',
      limitMinor: 3_500_000n,
      spentMinor: 3_200_000n,
      remainingMinor: 300_000n,
      usedBps: 9143,
      count: 18,
    });
    expect(result.value.usage.requests).toBe(1);
    expect(await transactionCount()).toBe(before);

    // The second step carried the tool result back to the provider; the first offered the tools.
    expect(requests[0]?.tools).toBeInstanceOf(Array);
    const followUp = (requests[1]?.messages as { role: string; content: string | null }[]).find(
      (message) => message.role === 'tool',
    );
    expect(followUp?.content).toContain('3200000');
    expect(JSON.stringify(requests[1])).not.toContain(key);
  });

  it('records only the allowlisted tool names and the data actually sent', async () => {
    script.push(() => Response.json(toolCall('saldo_rekening', {})));
    const result = await invoke(question());
    if (!result.ok) throw new Error(result.code);
    const logs = await test.as('wf_app', () => ai.logs(USER, { feature: 'chat' }));
    const row = logs.items.find((item) => item.toolCalls.includes('saldo_rekening'));
    expect(row).toMatchObject({
      feature: 'chat',
      status: 'ok',
      toolCalls: ['saldo_rekening'],
      costUsd: '0.0003',
      costSource: 'reported',
    });
    expect(row?.dataSent.accounts).toBeGreaterThan(0);
    expect(JSON.stringify(row)).not.toContain('GoPay');
  });

  it('shows the design impact of a draft and stores nothing before confirmation', async () => {
    const before = await transactionCount();
    script.push(
      () =>
        Response.json(
          toolCall('draf_transaksi', {
            type: 'expense',
            description: 'Makan siang',
            amount: '45000',
            accountId: goPayId,
            categoryId: foodId,
            date: '2026-10-15',
            time: '12:10',
          }),
        ),
      () => Response.json(answer('Siap, ini draftnya. Periksa dulu sebelum disimpan:')),
    );
    const result = await invoke(question({ question: 'Catat makan siang tadi 45.000 pakai GoPay' }));
    if (!result.ok) throw new Error(result.code);
    const draft = result.value.draft;
    expect(draft).toMatchObject({
      type: 'expense',
      description: 'Makan siang',
      amountMinor: 45_000n,
      currency: 'IDR',
      accountId: goPayId,
      accountName: 'GoPay',
      categoryId: foodId,
      tags: [],
      duplicate: null,
    });
    // "Makan & Dapur jadi 93%", "saldo GoPay Rp367.000".
    expect(draft?.budget).toEqual({ limitMinor: 3_500_000n, spentAfterMinor: 3_245_000n, usedBps: 9271 });
    expect(draft?.balance).toEqual({ currency: 'IDR', afterMinor: 367_000n, thresholdMinor: 500_000n });
    expect(draft?.occurredAt.toISOString()).toBe('2026-10-15T05:10:00.000Z');
    expect(await transactionCount()).toBe(before);
  });

  it('flags the seeded Indomaret purchase as a duplicate within two hours', async () => {
    script.push(() =>
      Response.json(
        toolCall('draf_transaksi', {
          type: 'expense',
          description: 'Indomaret',
          amount: '110000',
          accountId: bcaId,
          categoryId: foodId,
          date: '2026-10-15',
          time: '08:05',
        }),
      ),
    );
    const result = await invoke(question({ question: 'Catat Indomaret 110.000 pagi ini' }));
    if (!result.ok) throw new Error(result.code);
    expect(result.value.draft?.duplicate).toMatchObject({ amountMinor: 110_000n, localDate: '2026-10-15' });
  });

  it('returns a tool refusal to the model instead of guessing a draft', async () => {
    script.push(
      () =>
        Response.json(
          toolCall('draf_transaksi', {
            type: 'expense',
            description: 'Makan siang',
            amount: '45.000',
            accountId: goPayId,
            date: '2026-10-15',
            time: '12:10',
          }),
        ),
      () => Response.json(answer('Berapa nominalnya?')),
    );
    const result = await invoke(question({ question: 'Catat makan siang tadi' }));
    if (!result.ok) throw new Error(result.code);
    expect(result.value.draft).toBeNull();
    expect(result.value.text).toBe('Berapa nominalnya?');
    const followUp = (requests[1]?.messages as { role: string; content: string | null }[]).find(
      (message) => message.role === 'tool',
    );
    expect(followUp?.content).toContain('invalid_amount');
  });

  it('refuses a draft while the draft permission is off', async () => {
    await saveSettings({ allowReadFinancial: true, allowCreateDrafts: false });
    script.push(
      () => Response.json(toolCall('draf_transaksi', { type: 'expense', description: 'X', amount: '1' })),
      () => Response.json(answer('Draf tidak diizinkan.')),
    );
    const result = await invoke(question());
    if (!result.ok) throw new Error(result.code);
    expect(result.value.draft).toBeNull();
    // The tool is not even offered to the provider.
    const offered = (requests[0]?.tools as { function: { name: string } }[]).map((tool) => tool.function.name);
    expect(offered).not.toContain('draf_transaksi');
  });

  it('keeps the conversation inside the request and never logs prompts', async () => {
    script.push(() => Response.json(answer('Baik.')));
    await invoke(
      question({
        question: 'Berapa sisa anggaran Makan?',
        history: [
          { role: 'user', content: 'Halo' },
          { role: 'assistant', content: 'Hai, ada yang bisa dibantu?' },
        ],
      }),
    );
    const sent = requests[0]?.messages as { role: string }[];
    expect(sent.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    const logs = await test.as('wf_app', () => ai.logs(USER, {}));
    expect(JSON.stringify(logs)).not.toContain('Halo');
    expect(JSON.stringify(logs)).not.toContain('Baik.');
  });
});

describe('assistant refusals', () => {
  it('needs two-step verification before any provider request', async () => {
    expect(await invoke(question(), false)).toEqual({ ok: false, code: 'TWO_FACTOR_REQUIRED' });
    expect(requests).toHaveLength(0);
  });

  it('needs financial-data permission and a saved key', async () => {
    await saveSettings({ allowReadFinancial: false });
    expect(await invoke(question())).toEqual({ ok: false, code: 'AI_PERMISSION_REQUIRED' });
    expect(requests).toHaveLength(0);

    await saveSettings({ allowReadFinancial: true });
    await test.as('wf_app', () => ai.removeKey(USER, 'openrouter', settings?.revision ?? ''));
    settings = await test.as('wf_app', () => ai.settings(USER));
    expect(await invoke(question())).toEqual({ ok: false, code: 'AI_NOT_CONFIGURED' });
    expect(requests).toHaveLength(0);
  });

  it('refuses a request above the monthly cap before egress', async () => {
    await saveSettings({ monthlyLimitUsd: '0.0000001' });
    expect(await invoke(question())).toEqual({ ok: false, code: 'AI_COST_LIMIT' });
    expect(requests).toHaveLength(0);
  });

  it('reports a timeout as a timeout and still accounts for the attempt', async () => {
    activeClient = {
      models: realClient.models,
      complete: () =>
        Promise.resolve({
          status: 'timeout',
          httpStatus: null,
          errorCode: 'timeout',
          durationMs: 30_000,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          content: null,
          toolCalls: [],
          finishReason: null,
        }),
    };
    expect(await invoke(question())).toEqual({ ok: false, code: 'AI_TIMEOUT' });
    const logs = await test.as('wf_app', () => ai.logs(USER, { status: 'timeout' }));
    expect(logs.total).toBe(1);
    const usage = await test.as('wf_app', () => ai.settings(USER));
    expect(usage.usage.reservedUsd).toBe('0');
  });

  it('stops a tool loop at the step limit and keeps the ledger unchanged', async () => {
    const before = await transactionCount();
    script.push(
      () => Response.json(toolCall('ringkasan_anggaran', {})),
      () => Response.json(toolCall('ringkasan_anggaran', {})),
      () => Response.json(toolCall('ringkasan_anggaran', {})),
      () => Response.json(toolCall('ringkasan_anggaran', {})),
    );
    expect(await invoke(question())).toEqual({ ok: false, code: 'AI_ASSISTANT_FAILED' });
    expect(requests).toHaveLength(4);
    expect(await transactionCount()).toBe(before);
  });

  it('rejects a request id that is already in flight instead of paying twice', async () => {
    const data = question();
    script.push(() => Response.json(answer('Sekali saja.')));
    const first = await invoke(data);
    if (!first.ok) throw new Error(first.code);
    script.push(() => Response.json(answer('Sekali saja.')));
    expect(await invoke(data)).toEqual({ ok: false, code: 'AI_REQUEST_EXISTS' });
    expect(requests).toHaveLength(1);
  });

  it('rejects a stale configuration revision', async () => {
    expect(await invoke(question({ expectedRevision: randomUUID() }))).toEqual({
      ok: false,
      code: 'AI_CONFIG_CHANGED',
    });
    expect(requests).toHaveLength(0);
  });
});
