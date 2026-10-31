// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { generateDek } from '@wf/crypto/envelope';
import { createAiRepository, type AiRepository } from '@wf/db/ai';
import { createGmail, type GmailRepository } from '@wf/db/gmail';
import { createReview } from '@wf/db/review';
import { createTransactions } from '@wf/db/transactions';
import { seedLedger } from '@wf/db/seed';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '@wf/db/testing';
import { GMAIL_EXTRACTION_SCHEMA } from '@wf/domain/gmail';
import { createAiClient } from '@wf/integrations/ai';
import { createGmailClient } from '@wf/integrations/gmail';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb, fakeDeps } from '../../test/fakes.ts';
import { createGmailProcessor } from './gmail.ts';
import type { ProcessorDeps } from '../processors.ts';
let test: TestDatabase;
let userId: string;
let accountId: string;
let otherAccountId: string;
let categoryId: string;
let ai: AiRepository;
let gmail: GmailRepository;
let clock = new Date('2026-10-18T02:00:00Z');
const dek = generateDek();
const getDek = () => Promise.resolve(dek);
const pricing = { inputUsdPerMillion: '1', outputUsdPerMillion: '2', requestUsd: '0', imageUsd: '0' };
const aiFetch = vi.fn<typeof fetch>();
const googleFetch = vi.fn<typeof fetch>();
let output = '';
let ids = ['mail1'];
let subject = 'PLN payment';
let snippet = 'Payment PLN 350000 IDR';
let failHistory = false;
const client = createAiClient({ allowedBaseUrls: [], fetch: aiFetch });
const google = createGmailClient({
  oauth: { clientId: 'fixture', clientSecret: 'fixture-secret' },
  fetch: googleFetch,
});
const ports = (): ProcessorDeps['gmail'] => ({
  enabled: true,
  topic: 'projects/fixture/topics/mail',
  fetch: google,
  client,
});
const run = (
  overrides: Partial<GmailRepository> = {},
  portOverrides: Partial<ProcessorDeps['gmail']> = {},
  aiPort = ai,
) =>
  test.as('wf_worker', () =>
    createGmailProcessor(
      fakeDeps(
        { db: { ...fakeDb(), ai: aiPort, gmail: { ...gmail, ...overrides } }, gmail: { ...ports(), ...portOverrides } },
        clock,
      ),
    )({
      id: 'gmail-fixture',
      data: { userId },
      attemptsMade: 0,
    }),
  );
const saveAi = async (
  overrides: { allowReadFinancial?: boolean; allowCreateDrafts?: boolean; monthlyLimitUsd?: string } = {},
) => {
  const current = await test.as('wf_app', () => ai.settings(userId));
  return test.as('wf_app', () =>
    ai.save(userId, {
      expectedRevision: current.revision,
      provider: 'openrouter',
      apiKey: `fixture-${randomUUID()}`,
      modelId: 'fixture/extract',
      allowReadFinancial: true,
      allowCreateDrafts: true,
      requireConfirmation: true,
      monthlyLimitUsd: '5',
      pricing,
      ...overrides,
    }),
  );
};
beforeAll(async () => {
  test = await startMigrated();
  const [user] = await test.query<{ id: string }>(
    "INSERT INTO users(name,email,two_factor_enabled) VALUES ('Gmail fixture','gmail-worker@example.test',true) RETURNING id",
  );
  userId = user?.id ?? '';
  await test.as('wf_app', () => seedLedger(test.db, userId, { getDek, now: () => clock }));
  accountId =
    (
      await test.query<{ id: string }>("SELECT id FROM accounts WHERE user_id=$1 AND display_name='BCA Tahapan'", [
        userId,
      ])
    )[0]?.id ?? '';
  otherAccountId =
    (await test.query<{ id: string }>("SELECT id FROM accounts WHERE user_id=$1 AND display_name='GoPay'", [userId]))[0]
      ?.id ?? '';
  categoryId =
    (
      await test.query<{ id: string }>("SELECT id FROM categories WHERE user_id=$1 AND name='system:health'", [userId])
    )[0]?.id ?? '';
  ai = createAiRepository(test.db, { getDek, allowedBaseUrls: [], now: () => clock });
  gmail = createGmail(test.db, { getDek, now: () => clock });
}, PGLITE_HOOK_TIMEOUT * 2);
afterAll(async () => {
  await test.close();
});
beforeEach(async () => {
  for (const statement of [
    "DELETE FROM review_items WHERE source='gmail'",
    'DELETE FROM email_ingest_logs',
    'DELETE FROM gmail_message_keys',
    'DELETE FROM gmail_connections',
    'DELETE FROM ai_logs',
    'DELETE FROM ai_usage_months',
    "DELETE FROM transactions WHERE source='gmail' OR merchant='Manual Gmail fixture'",
  ])
    await test.query(statement);
  await test.query('UPDATE users SET two_factor_enabled=true WHERE id=$1', [userId]);
  clock = new Date('2026-10-18T02:00:00Z');
  ids = ['mail1'];
  subject = 'PLN payment';
  snippet = 'Payment PLN 350000 IDR';
  failHistory = false;
  await saveAi();
  await test.as('wf_app', () =>
    gmail.saveConnection(userId, {
      email: 'fixture@gmail.com',
      tokens: {
        accessToken: 'fixture-access',
        refreshToken: 'fixture-refresh',
        expiresAt: new Date('2099-01-01'),
      },
      filters: { senders: ['bank.test'], keywords: ['payment'], ignoreKeywords: ['promo'] },
    }),
  );
  output = JSON.stringify({
    amountMinor: '350000',
    occurredAt: clock.toISOString(),
    merchant: 'PLN',
    currency: 'IDR',
    accountId,
    categoryId,
    confidence: { amount: 97, date: 97, merchant: 97, currency: 97, account: 97, category: 97 },
  });
  aiFetch.mockReset();
  googleFetch.mockReset();
  aiFetch.mockImplementation(() =>
    Promise.resolve(
      Response.json({
        choices: [{ message: { content: output }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1000, completion_tokens: 200, cost: '0.004' },
      }),
    ),
  );
  googleFetch.mockImplementation((input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.endsWith('/watch'))
      return Promise.resolve(Response.json({ historyId: '500', expiration: String(Date.now() + 7 * 86400000) }));
    if (url.endsWith('/profile'))
      return Promise.resolve(Response.json({ emailAddress: 'fixture@gmail.com', historyId: '501' }));
    if (url.includes('/history?') && failHistory)
      return Promise.resolve(Response.json({ error: 'invalid_grant' }, { status: 401 }));
    if (url.includes('/history?'))
      return Promise.resolve(
        Response.json({ historyId: '501', history: [{ messagesAdded: ids.map((id) => ({ message: { id } })) }] }),
      );
    if (url.includes('/messages?')) return Promise.resolve(Response.json({ messages: ids.map((id) => ({ id })) }));
    return Promise.resolve(
      Response.json({
        internalDate: String(clock.getTime()),
        snippet,
        payload: {
          headers: [
            { name: 'From', value: 'Bank <pay@bank.test>' },
            { name: 'Subject', value: subject },
          ],
        },
      }),
    );
  });
});

describe('real Gmail processor with role-scoped repositories', () => {
  it('PLN 97% creates one encrypted review and charge, zero ledger writes until explicit confirm, source=gmail afterwards', async () => {
    const before = await test.query('SELECT count(*) FROM transactions');
    expect(await run()).toMatchObject({ status: 'ingested', proposed: 1 });
    expect(await run()).toMatchObject({ proposed: 0, duplicates: 1 });
    expect(aiFetch).toHaveBeenCalledTimes(1);
    expect(await test.query('SELECT count(*) FROM transactions')).toEqual(before);
    const review = createReview(test.db, { getDek, now: () => clock });
    const items = await test.as('wf_app', () => review.list(userId, { source: 'gmail' }));
    expect(items.items).toHaveLength(1);
    expect(items.items[0]?.aiConfidence).toBe(97);
    expect(items.items[0]?.payload).toMatchObject({
      kind: 'gmail',
      extraction: { amountMinor: 350000n, confidence: { amount: 97 } },
    });
    const id = items.items[0]?.id ?? '';
    const confirmed = await test.as('wf_app', () => review.confirm(userId, id));
    expect(await test.as('wf_app', () => review.confirm(userId, id))).toEqual(confirmed);
    expect(
      await test.query('SELECT source,count(*)::int AS n FROM transactions WHERE id=$1 GROUP BY source', [
        confirmed.transactionId,
      ]),
    ).toEqual([{ source: 'gmail', n: 1 }]);
    expect((await test.as('wf_app', () => gmail.listLogs(userId)))[0]?.outcome).toBe('confirmed');
    expect(await test.query("SELECT feature,status,cost_usd::text AS cost FROM ai_logs WHERE feature='gmail'")).toEqual(
      [{ feature: 'gmail', status: 'ok', cost: '0.004000000000000000' }],
    );
    const detail = await test.as('wf_app', () =>
      createTransactions(test.db, { getDek }).get(userId, confirmed.transactionId ?? ''),
    );
    expect(detail.gmailEvidence).toMatchObject({ excerpt: snippet, extraction: { confidence: { amount: 97 } } });
    const sent = aiFetch.mock.calls[0]?.[1]?.body;
    expect(sent).toBeTypeOf('string');
    if (typeof sent !== 'string') throw new Error('Expected AI JSON body');
    expect(sent).toContain('UNTRUSTED DATA');
    expect(sent).not.toContain('transactions');
    expect(sent).not.toContain('fixture-access');
    expect(JSON.parse(sent)).toMatchObject({
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'gmail_extraction', strict: true, schema: GMAIL_EXTRACTION_SCHEMA },
      },
    });
  });
  it('lets an explicit owned-account correction replace an incorrect AI currency while preserving original evidence', async () => {
    output = JSON.stringify({ ...JSON.parse(output), currency: 'USD' });
    expect(await run()).toMatchObject({ proposed: 1 });
    const review = createReview(test.db, { getDek, now: () => clock });
    const items = await test.as('wf_app', () => review.list(userId, { source: 'gmail' }));
    const saved = await test.as('wf_app', () =>
      review.confirm(userId, items.items[0]?.id ?? '', { accountId, amountMinor: 350000n }),
    );
    expect(
      await test.query('SELECT currency,amount_minor::text AS amount FROM postings WHERE transaction_id=$1', [
        saved.transactionId,
      ]),
    ).toEqual([{ currency: 'IDR', amount: '-350000' }]);
    const detail = await test.as('wf_app', () =>
      createTransactions(test.db, { getDek }).get(userId, saved.transactionId ?? ''),
    );
    expect(detail.source).toBe('gmail');
    expect(detail.gmailEvidence?.extraction.currency).toBe('USD');
  });
  it('recovers a crash after durable staging and a crash after extraction without sending another paid request', async () => {
    let stagedCrash = true;
    await expect(
      run({
        recordEmail: async (...args) => {
          const row = await gmail.recordEmail(...args);
          if (stagedCrash) {
            stagedCrash = false;
            throw new Error('crash after staging');
          }
          return row;
        },
      }),
    ).rejects.toThrow('Gmail ingestion unavailable');
    expect(aiFetch).not.toHaveBeenCalled();
    let completionCrash = true;
    await expect(
      run({
        complete: async (...args) => {
          if (completionCrash) {
            completionCrash = false;
            throw new Error('crash after extraction');
          }
          return gmail.complete(...args);
        },
      }),
    ).rejects.toThrow('Gmail ingestion unavailable');
    expect(aiFetch).toHaveBeenCalledTimes(1);
    ids = []; // History already advanced; the durable drain must still finish the extracted row.
    expect(await run()).toMatchObject({ proposed: 1 });
    expect(aiFetch).toHaveBeenCalledTimes(1);
    expect(await test.query("SELECT count(*)::int AS n FROM review_items WHERE source='gmail'")).toEqual([{ n: 1 }]);
  });
  it('keeps the stored history cursor when a page reports none, yet still drains the staged work', async () => {
    const before = (await test.as('wf_app', () => gmail.getConnection(userId)))?.historyId;
    const setHistoryId = vi.fn(gmail.setHistoryId);
    const listMessages = vi.fn<ProcessorDeps['gmail']['fetch']['listMessages']>().mockResolvedValue({
      historyId: null,
      messages: [{ id: 'mail-no-history', from: 'Bank <pay@bank.test>', subject, excerpt: snippet, receivedAt: clock }],
    });
    expect(await run({ setHistoryId }, { fetch: { ...google, listMessages } })).toMatchObject({
      status: 'ingested',
      passed: 1,
      proposed: 1,
    });
    expect(setHistoryId).not.toHaveBeenCalled();
    expect((await test.as('wf_app', () => gmail.getConnection(userId)))?.historyId).toBe(before);
    expect(await test.query("SELECT count(*)::int AS n FROM review_items WHERE source='gmail'")).toEqual([{ n: 1 }]);
  });
  it('never automatically resends unknown billed attempts and preserves their reservation', async () => {
    aiFetch.mockRejectedValue(new Error('private provider diagnostics'));
    expect(await run()).toMatchObject({ proposed: 1 });
    expect(await run()).toMatchObject({ proposed: 0 });
    expect(aiFetch).toHaveBeenCalledTimes(1);
    expect(await test.query("SELECT status FROM ai_logs WHERE feature='gmail'")).toEqual([{ status: 'error' }]);
    expect((await test.as('wf_app', () => gmail.listLogs(userId)))[0]?.errorCode).not.toContain('private');
    const usage = await test.query<{ reserved: string; spent: string }>(
      'SELECT reserved_usd::text AS reserved, spent_usd::text AS spent FROM ai_usage_months',
    );
    expect(
      BigInt((usage[0]?.reserved ?? '0').replace('.', '')) + BigInt((usage[0]?.spent ?? '0').replace('.', '')),
    ).toBeGreaterThan(0n);
  });
  it.each([{ allowReadFinancial: false }, { allowCreateDrafts: false }, { monthlyLimitUsd: '0' }])(
    'blocks paid egress against current permissions/cap %j',
    async (changes) => {
      await saveAi(changes);
      expect(await run()).toMatchObject({ proposed: 1 });
      expect(aiFetch).not.toHaveBeenCalled();
      expect((await test.as('wf_app', () => gmail.listLogs(userId)))[0]?.errorCode).toMatch(
        /^AI_(PERMISSION_REQUIRED|COST_LIMIT)$/,
      );
    },
  );
  it('refuses all reads when disabled, after disconnect, or after removing current 2FA', async () => {
    expect(await run({}, { enabled: false })).toMatchObject({ status: 'disabled' });
    expect(googleFetch).not.toHaveBeenCalled();
    await test.query('UPDATE users SET two_factor_enabled=false WHERE id=$1', [userId]);
    await expect(run()).rejects.toThrow('Gmail ingestion unavailable');
    expect(aiFetch).not.toHaveBeenCalled();
    expect(googleFetch).not.toHaveBeenCalled();
    await test.as('wf_app', () => gmail.markRevoked(userId));
    googleFetch.mockClear();
    expect(await run()).toMatchObject({ status: 'no_connection' });
    expect(googleFetch).not.toHaveBeenCalled();
  });
  it('gives ignore keywords precedence in excerpts and never pays for filtered evidence', async () => {
    snippet = 'PLN payment PROMO';
    expect(await run()).toMatchObject({ passed: 0, proposed: 0 });
    expect(aiFetch).not.toHaveBeenCalled();
    expect((await test.as('wf_app', () => gmail.listLogs(userId)))[0]?.filterResult).toBe('ignored_keyword');
  });
  it('suppresses a same-user manual expense on another account within ±1%/2h and currency scope', async () => {
    expect(otherAccountId).not.toBe(accountId);
    await test.as('wf_app', () =>
      createTransactions(test.db, { getDek, now: () => clock }).create(userId, {
        clientId: randomUUID(),
        type: 'expense',
        accountId: otherAccountId,
        categoryId,
        amountMinor: 350000n,
        occurredAt: new Date(clock.getTime() + 7200000),
        merchant: 'Manual Gmail fixture',
        source: 'manual',
      }),
    );
    expect(await run()).toMatchObject({ proposed: 0, duplicates: 1 });
    expect((await test.as('wf_app', () => gmail.listLogs(userId)))[0]?.outcome).toBe('duplicate');
    expect(await test.query("SELECT id FROM review_items WHERE source='gmail'")).toEqual([]);
  });
  it('marks revoked grants with destroyed credentials, and renews a watch only after six days', async () => {
    await run();
    const watches = () =>
      googleFetch.mock.calls.filter(([input]) =>
        (input instanceof Request ? input.url : input.toString()).endsWith('/watch'),
      ).length;
    expect(watches()).toBe(1);
    await run();
    expect(watches()).toBe(1);
    clock = new Date(clock.getTime() + 6 * 86400000);
    ids = [];
    await run();
    expect(watches()).toBe(2);
    failHistory = true;
    expect(await run()).toMatchObject({ status: 'revoked' });
    expect(await test.as('wf_app', () => gmail.tokens(userId))).toBeNull();
  });

  it('does not read a disconnected token row even if a connection was observed just before disconnect', async () => {
    expect(await run({ tokens: () => Promise.resolve(null) })).toMatchObject({ status: 'no_connection' });
    expect(googleFetch).not.toHaveBeenCalled();
    expect(aiFetch).not.toHaveBeenCalled();
  });

  it('persists refreshed credentials before the watch and following mailbox read', async () => {
    await test.as('wf_app', () =>
      gmail.saveConnection(userId, {
        email: 'fixture@gmail.com',
        tokens: { accessToken: 'expired', refreshToken: 'fixture-refresh', expiresAt: new Date(0) },
        filters: { senders: ['bank.test'], keywords: ['payment'], ignoreKeywords: [] },
      }),
    );
    googleFetch.mockResolvedValueOnce(
      Response.json({
        access_token: 'fresh-access',
        refresh_token: 'fresh-refresh',
        expires_in: 3600,
      }),
    );
    expect(await run()).toMatchObject({ proposed: 1 });
    expect(await test.as('wf_app', () => gmail.tokens(userId))).toMatchObject({
      accessToken: 'fresh-access',
      refreshToken: 'fresh-refresh',
    });
    const requests = googleFetch.mock.calls.slice(1);
    expect(
      requests.every(([, init]) => new Headers(init?.headers).get('authorization') === 'Bearer fresh-access'),
    ).toBe(true);
  });

  it('rechecks live enablement during mailbox access and exposes no provider diagnostic', async () => {
    const live = { ...ports() };
    const original = googleFetch.getMockImplementation();
    googleFetch.mockImplementation((...args) => {
      live.enabled = false;
      if (original === undefined) throw new Error('Missing fetch fixture');
      return original(...args);
    });
    const process = createGmailProcessor(fakeDeps({ db: { ...fakeDb(), ai, gmail }, gmail: live }, clock));
    await expect(
      test.as('wf_worker', () => process({ id: 'disabled-race', data: { userId }, attemptsMade: 0 })),
    ).rejects.toThrow('Gmail ingestion unavailable');
    expect(aiFetch).not.toHaveBeenCalled();
  });

  it('requires known pricing before reserving or making a paid extraction', async () => {
    expect(
      await run(
        {},
        {},
        { ...ai, credential: async (...args) => ({ ...(await ai.credential(...args)), pricing: null }) },
      ),
    ).toMatchObject({ proposed: 1 });
    expect(aiFetch).not.toHaveBeenCalled();
    expect((await test.as('wf_app', () => gmail.listLogs(userId)))[0]?.errorCode).toBe('AI_PRICING_REQUIRED');
  });

  it.each([
    { choices: [{ message: { content: null }, finish_reason: 'stop' }] },
    { choices: [{ message: { content: 'private truncated evidence' }, finish_reason: 'length' }] },
    {
      choices: [
        {
          message: {
            content: '',
            tool_calls: [{ id: 'call1', type: 'function', function: { name: 'write', arguments: '{}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
    },
  ])('retains paid metadata but refuses non-extraction answers: %j', async (response) => {
    aiFetch.mockResolvedValueOnce(
      Response.json({ ...response, usage: { prompt_tokens: 100, completion_tokens: 20, cost: '0.004' } }),
    );
    expect(await run()).toMatchObject({ proposed: 1 });
    expect((await test.as('wf_app', () => gmail.listLogs(userId)))[0]?.errorCode).toBe('GMAIL_EXTRACTION_FAILED');
    await run();
    expect(aiFetch).toHaveBeenCalledTimes(1);
  });

  it('records timeout as a bounded failure and never automatically retries paid extraction', async () => {
    aiFetch.mockRejectedValueOnce(new DOMException('private timeout', 'TimeoutError'));
    const deadline = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
    expect(await run()).toMatchObject({ proposed: 1 });
    deadline.mockRestore();
    expect((await test.as('wf_app', () => gmail.listLogs(userId)))[0]?.errorCode).toBe('AI_TIMEOUT');
    await run();
    expect(aiFetch).toHaveBeenCalledTimes(1);
  });
});
