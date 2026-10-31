// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { generateDek } from '@wf/crypto/envelope';
import { createAiRepository, type AiRepository } from '@wf/db/ai';
import { createReceiptJobs } from '@wf/db/receipt-jobs';
import { createReceipts } from '@wf/db/receipts';
import { seedLedger } from '@wf/db/seed';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '@wf/db/testing';
import { RECEIPT_EXTRACTION_SCHEMA } from '@wf/domain/receipt';
import { createAiClient } from '@wf/integrations/ai';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb, fakeDeps } from '../../test/fakes.ts';
import { createOcrProcessor } from './ocr.ts';
import type { ProcessorDeps } from '../processors.ts';
let test: TestDatabase;
let userId: string;
let accountId: string;
let categoryId: string;
let revision: string;
let ai: AiRepository;
const now = new Date('2026-10-15T09:00:00Z');
const dek = generateDek();
const getDek = () => Promise.resolve(dek);
const pricing = { inputUsdPerMillion: '1', outputUsdPerMillion: '2', requestUsd: '0', imageUsd: '0.001' };
const fetcher = vi.fn<typeof fetch>();
let content = '';
const client = createAiClient({ allowedBaseUrls: [], fetch: fetcher });
const objects = {
  get: () => Promise.resolve({ mime: 'image/webp', bytes: new Uint8Array([82, 73, 70, 70]) }),
  delete: () => Promise.resolve(),
};
const run = async (id: string, receipt: ProcessorDeps['receipt'] = { client, objects }, aiPort = ai) => {
  const processor = createOcrProcessor(
    fakeDeps({
      db: { ...fakeDb(), receipts: createReceiptJobs(test.db, { getDek, now: () => now }), ai: aiPort },
      receipt,
    }),
  );
  return test.as('wf_worker', () =>
    processor({ id: `ocr.${userId}.${id}`, data: { userId, receiptId: id }, attemptsMade: 0 }),
  );
};
async function stage() {
  const id = randomUUID();
  const object = { key: `u/${userId}/${randomUUID()}`, size: 4, sha256: 'a'.repeat(64), mime: 'image/webp' };
  await test.as('wf_app', () =>
    createReceipts(test.db, { getDek }).stage(userId, {
      id,
      revision,
      provider: 'openrouter',
      payload: {
        name: 'private-receipt.png',
        original: object,
        pages: [object],
        timeZone: 'Asia/Jakarta',
        evidence: null,
      },
    }),
  );
  return id;
}
beforeAll(async () => {
  test = await startMigrated();
  const [user] = await test.query<{ id: string }>(
    "INSERT INTO users (name,email,two_factor_enabled) VALUES ('OCR','ocr@example.test',true) RETURNING id",
  );
  userId = user?.id ?? '';
  await test.as('wf_app', () => seedLedger(test.db, userId, { getDek, now: () => now }));
  accountId =
    (
      await test.query<{ id: string }>("SELECT id FROM accounts WHERE user_id=$1 AND display_name='BCA Tahapan'", [
        userId,
      ])
    )[0]?.id ?? '';
  categoryId =
    (
      await test.query<{ id: string }>("SELECT id FROM categories WHERE user_id=$1 AND name='system:health'", [userId])
    )[0]?.id ?? '';
  ai = createAiRepository(test.db, { getDek, allowedBaseUrls: [], now: () => now });
}, PGLITE_HOOK_TIMEOUT * 2);
afterAll(async () => {
  await test.close();
});
beforeEach(async () => {
  const current = await test.as('wf_app', () => ai.settings(userId));
  const saved = await test.as('wf_app', () =>
    ai.save(userId, {
      expectedRevision: current.revision,
      provider: 'openrouter',
      apiKey: `fixture-${randomUUID()}`,
      modelId: 'fixture/vision',
      allowReadFinancial: true,
      allowCreateDrafts: true,
      requireConfirmation: true,
      monthlyLimitUsd: '5',
      pricing,
    }),
  );
  revision = saved.revision ?? '';
  content = JSON.stringify({
    merchant: 'Apotek K-24',
    description: 'Obat',
    amountMinor: '96500',
    currency: 'IDR',
    date: '2026-10-15',
    time: '15:20',
    accountId,
    categoryId,
    uncertain: [],
    items: [],
  });
  fetcher.mockReset();
  fetcher.mockImplementation(() =>
    Promise.resolve(
      Response.json({
        choices: [{ message: { content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1000, completion_tokens: 200, cost: '0.009' },
      }),
    ),
  );
});
describe('real queued receipt processor', () => {
  it('sends vision through the existing transport, persists one proposal and charge, and never creates ledger rows', async () => {
    const before = await test.query('SELECT count(*) FROM transactions');
    const id = await stage();
    expect(await run(id)).toMatchObject({ status: 'ready' });
    expect(await run(id)).toMatchObject({ replay: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const requestBody = fetcher.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe('string');
    const body = JSON.parse(requestBody as string) as {
      messages: { content: { type: string; image_url?: { url: string } }[] }[];
      tools?: unknown;
      response_format?: { type: string; json_schema: { name: string; strict: boolean; schema: unknown } };
    };
    expect(body.messages[0]?.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/webp;base64,UklGRg==' },
    });
    expect(body.tools).toBeUndefined();
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'receipt_extraction', strict: true, schema: RECEIPT_EXTRACTION_SCHEMA },
    });
    expect(await test.query('SELECT count(*) FROM transactions')).toEqual(before);
    expect(
      await test.query('SELECT count(*)::int AS n FROM review_items WHERE dedupe_key=$1', [`receipt.${id}`]),
    ).toEqual([{ n: 1 }]);
    expect(
      await test.query('SELECT feature, images, cost_usd::text AS cost, status FROM ai_logs WHERE id=$1', [id]),
    ).toEqual([{ feature: 'receipt', images: 1, cost: '0.009000000000000000', status: 'ok' }]);
    const rows = await test.query('SELECT payload_enc FROM receipt_uploads WHERE id=$1', [id]);
    expect(JSON.stringify(rows)).not.toContain('Apotek');
  });
  it.each(['key', 'permission', '2fa'] as const)(
    'refuses revoked %s between enqueue and process without provider egress',
    async (kind) => {
      const id = await stage();
      if (kind === 'key') await test.as('wf_app', () => ai.removeKey(userId, 'openrouter', revision));
      if (kind === 'permission')
        await test.query('UPDATE ai_settings SET allow_create_drafts=false WHERE user_id=$1', [userId]);
      if (kind === '2fa') await test.query('UPDATE users SET two_factor_enabled=false WHERE id=$1', [userId]);
      expect(await run(id)).toMatchObject({ status: 'failed' });
      expect(fetcher).not.toHaveBeenCalled();
      await test.query('UPDATE users SET two_factor_enabled=true WHERE id=$1', [userId]);
    },
  );
  it('enforces the persisted cap before egress and does not charge a blocked request', async () => {
    await test.query('UPDATE ai_settings SET monthly_limit_usd=0 WHERE user_id=$1', [userId]);
    const id = await stage();
    expect(await run(id)).toMatchObject({ status: 'failed', code: 'AI_COST_LIMIT' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await test.query('SELECT status,reserved_usd::text AS reserved FROM ai_logs WHERE id=$1', [id])).toEqual([
      { status: 'blocked', reserved: '0.000000000000000000' },
    ]);
  });
  it('offers manual entry for unreadable structured data without losing known provider charges or retry-billing', async () => {
    content = JSON.stringify({ amountMinor: null, date: null });
    const id = await stage();
    expect(await run(id)).toMatchObject({ status: 'failed', code: 'RECEIPT_UNREADABLE' });
    await run(id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      await test.query('SELECT count(*)::int AS n FROM review_items WHERE dedupe_key=$1', [`receipt.${id}`]),
    ).toEqual([{ n: 0 }]);
    expect(await test.query('SELECT cost_usd > 0 AS charged FROM ai_logs WHERE id=$1', [id])).toEqual([
      { charged: true },
    ]);
  });
  it('settles unknown network billing conservatively and stores no native failure text', async () => {
    fetcher.mockRejectedValueOnce(new Error('private-receipt provider failure'));
    const id = await stage();
    expect(await run(id)).toMatchObject({ status: 'failed' });
    const [log] = await test.query<{ cost_source: string; spent: boolean; error_code: string }>(
      'SELECT cost_source,cost_usd > 0 AS spent,error_code FROM ai_logs WHERE id=$1',
      [id],
    );
    expect(log).toMatchObject({ cost_source: 'estimated', spent: true, error_code: 'network' });
    expect(JSON.stringify(log)).not.toContain('private');
  });

  it('fails safely when receipt services are absent before provider egress', async () => {
    const id = await stage();
    const process = createOcrProcessor(
      fakeDeps({
        db: { ...fakeDb(), receipts: createReceiptJobs(test.db, { getDek, now: () => now }), ai },
      }),
    );
    expect(
      await test.as('wf_worker', () => process({ id, data: { userId, receiptId: id }, attemptsMade: 0 })),
    ).toMatchObject({ status: 'failed', code: 'RECEIPT_FAILED' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects missing pricing and tampered page media before paid egress', async () => {
    const unpriced = await stage();
    expect(
      await run(
        unpriced,
        { client, objects },
        {
          ...ai,
          credential: async (...args) => ({ ...(await ai.credential(...args)), pricing: null }),
        },
      ),
    ).toMatchObject({ status: 'failed', code: 'AI_PRICING_REQUIRED' });
    const tampered = await stage();
    expect(
      await run(tampered, {
        client,
        objects: {
          ...objects,
          get: () => Promise.resolve({ mime: 'text/html', bytes: new Uint8Array([1]) }),
        },
      }),
    ).toMatchObject({ status: 'failed', code: 'RECEIPT_UNREADABLE' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { choices: [{ message: { content: null }, finish_reason: 'stop' }] },
    { choices: [{ message: { content: 'private partial' }, finish_reason: 'length' }] },
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
  ])('refuses incomplete or tool-bearing answers without losing the known charge: %j', async (response) => {
    fetcher.mockResolvedValueOnce(
      Response.json({ ...response, usage: { cost: '0.009', prompt_tokens: 10, completion_tokens: 5 } }),
    );
    const id = await stage();
    expect(await run(id)).toMatchObject({ status: 'failed', code: 'RECEIPT_UNREADABLE' });
    await run(id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await test.query('SELECT cost_usd > 0 AS charged FROM ai_logs WHERE id=$1', [id])).toEqual([
      { charged: true },
    ]);
  });

  it('keeps a timeout terminal instead of billing the same receipt twice', async () => {
    fetcher.mockRejectedValueOnce(new DOMException('private timeout', 'TimeoutError'));
    const deadline = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
    const id = await stage();
    expect(await run(id)).toMatchObject({ status: 'failed', code: 'AI_TIMEOUT' });
    deadline.mockRestore();
    await run(id);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
