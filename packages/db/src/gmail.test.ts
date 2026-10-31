// SPDX-License-Identifier: AGPL-3.0-only
import { decryptText } from '@wf/crypto/cipher';
import { generateDek } from '@wf/crypto/envelope';
import type { GmailExtraction } from '@wf/domain/gmail';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createGmail, GMAIL_TOKENS_PURPOSE, type NewEmail } from './gmail.ts';
import { createReview } from './review.ts';

let test: TestDatabase;
let alice: string;
let bob: string;
const dek = generateDek();
let clock = new Date('2026-10-18T02:00:00Z');
const getDek = () => Promise.resolve(dek);
const tokens = {
  accessToken: 'fixture-access-token',
  refreshToken: 'fixture-refresh-token',
  expiresAt: new Date('2099-01-01'),
};
const gmail = () => createGmail(test.db, { getDek, now: () => clock });
const app = <T>(action: () => Promise<T>) => test.as('wf_app', action);
const worker = <T>(action: () => Promise<T>) => test.as('wf_worker', action);
const email = (id = 'mail-one', override: Partial<NewEmail> = {}): NewEmail => ({
  messageId: id,
  fromAddr: 'bank@example.test',
  subject: 'PLN payment',
  excerpt: 'Minimal payment evidence 350000 IDR',
  receivedAt: clock,
  filterResult: 'passed',
  ...override,
});
const extraction: GmailExtraction = {
  amountMinor: 350000n,
  occurredAt: new Date('2026-10-18T02:00:00Z'),
  merchant: 'PLN',
  currency: 'IDR',
  accountId: null,
  categoryId: null,
  confidence: { amount: 97, date: 97, merchant: 97, currency: 97, account: 0, category: 0 },
};
beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);
afterAll(async () => {
  await test.close();
});
beforeEach(async () => {
  await test.query('DELETE FROM users');
  alice = await insertUser(test, 'gmail-alice@example.test');
  bob = await insertUser(test, 'gmail-bob@example.test');
  clock = new Date('2026-10-18T02:00:00Z');
});

describe('Gmail consent and credential isolation', () => {
  it('binds encrypted tokens to user and grant, never exposes credentials, and audits lifecycle', async () => {
    const connection = await app(() => gmail().saveConnection(alice, { email: 'FIXTURE@GMAIL.COM', tokens }));
    expect(connection).toMatchObject({ email: 'fixture@gmail.com', status: 'connected' });
    expect(JSON.stringify(connection)).not.toContain(tokens.accessToken);
    const [row] = await test.query<{ tokens_enc: Uint8Array }>('SELECT tokens_enc FROM gmail_connections');
    expect(Buffer.from(row?.tokens_enc ?? []).toString()).not.toContain(tokens.refreshToken);
    expect(() =>
      decryptText(dek, row?.tokens_enc ?? new Uint8Array(), {
        userId: bob,
        purpose: `${GMAIL_TOKENS_PURPOSE}.${connection.grantId}`,
      }),
    ).toThrow();
    expect(await worker(() => gmail().tokens(alice))).toEqual(tokens);
    expect(await app(() => gmail().tokens(bob))).toBeNull();
    await worker(() => gmail().markRevoked(alice, connection.grantId));
    expect(await worker(() => gmail().tokens(alice))).toBeNull();
    await expect(worker(() => gmail().rotateTokens(alice, connection.grantId, tokens))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await test.query('SELECT tokens_enc FROM gmail_connections')).toEqual([{ tokens_enc: null }]);
    expect(await test.query('SELECT type FROM security_events ORDER BY at,id')).toEqual([
      { type: 'gmail_connected' },
      { type: 'gmail_disconnected' },
    ]);
  });
  it('consumes state once, with session/user/expiry binding and encrypted PKCE', async () => {
    const state = 'a'.repeat(64);
    const verifier = 'v'.repeat(64);
    await app(() => gmail().createConsent(alice, state, 'session-a', verifier));
    const [row] = await test.query<{ state_hash: string; verifier_enc: Uint8Array }>(
      'SELECT state_hash,verifier_enc FROM gmail_oauth_states',
    );
    expect(row?.state_hash).not.toBe(state);
    expect(Buffer.from(row?.verifier_enc ?? []).toString()).not.toContain(verifier);
    await expect(app(() => gmail().consumeConsent(bob, state, 'session-a'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(app(() => gmail().consumeConsent(alice, state, 'session-b'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await app(() => gmail().consumeConsent(alice, state, 'session-a'))).toEqual({ verifier, grantId: null });
    await expect(app(() => gmail().consumeConsent(alice, state, 'session-a'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await app(() => gmail().createConsent(alice, state, 'session-a', verifier));
    clock = new Date(clock.getTime() + 600_001);
    await expect(app(() => gmail().consumeConsent(alice, state, 'session-a'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('cannot resurrect a grant when disconnect races with an already-consumed callback or stale refresh', async () => {
    const connected = await app(() => gmail().saveConnection(alice, { email: 'fixture@gmail.com', tokens }));
    await app(() => gmail().createConsent(alice, 's', 'session', 'verifier'));
    const consent = await app(() => gmail().consumeConsent(alice, 's', 'session'));
    await app(() => gmail().markRevoked(alice, connected.grantId));
    await expect(
      app(() =>
        gmail().saveConnection(alice, { email: 'fixture@gmail.com', tokens, expectedGrantId: consent.grantId }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const replacement = await app(() => gmail().saveConnection(alice, { email: 'other@gmail.com', tokens }));
    await worker(() => gmail().markRevoked(alice, connected.grantId));
    expect(await app(() => gmail().getConnection(alice))).toMatchObject({
      grantId: replacement.grantId,
      status: 'connected',
    });
    await worker(() => gmail().rotateTokens(alice, replacement.grantId, { ...tokens, accessToken: 'rotated-fixture' }));
    expect((await app(() => gmail().tokens(alice)))?.accessToken).toBe('rotated-fixture');
  });

  it('does not create a connection by saving filters and persists tenant-owned filter changes across reconnect', async () => {
    const repository = createGmail(test.db, { getDek });
    expect(await app(() => repository.getConnection(alice))).toBeNull();
    const filters = { senders: ['bank.test'], keywords: ['paid'], ignoreKeywords: ['promo'] };
    await expect(app(() => repository.updateFilters(alice, filters))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await app(() => repository.saveConnection(alice, { email: 'fixture@gmail.com', tokens }));
    await app(() => repository.updateFilters(alice, filters));
    await app(() => repository.saveConnection(alice, { email: 'fixture@gmail.com', tokens }));
    expect((await app(() => repository.getConnection(alice)))?.filters).toEqual(filters);
    expect(await worker(() => repository.targets())).toEqual([{ userId: alice }]);
  });
});

describe('durable email processing and retention', () => {
  it('resumes a staged email after a pre-extraction crash and atomically creates exactly one proposal/log link', async () => {
    const first = await worker(() => gmail().recordEmail(alice, email()));
    const repeated = await worker(() => gmail().recordEmail(alice, email()));
    expect(repeated).toEqual({ id: first.id, duplicate: true });
    expect(await worker(() => gmail().pending(alice))).toEqual([{ id: first.id }]);
    // No AI config: a usable incomplete proposal is created, not a fake zero-value transaction.
    expect(await worker(() => gmail().claimExtraction(alice, first.id ?? ''))).toBeNull();
    expect(await worker(() => gmail().complete(alice, first.id ?? ''))).toBe('pending');
    expect(await worker(() => gmail().complete(alice, first.id ?? ''))).toBe('replay');
    const logs = await app(() => gmail().listLogs(alice));
    expect(logs[0]).toMatchObject({
      processing: 'done',
      errorCode: 'AI_NOT_CONFIGURED',
      outcome: 'pending',
    });
    const review = createReview(test.db, { getDek, now: () => clock });
    const items = await app(() => review.list(alice));
    expect(items.items.map(({ id }) => id)).toEqual([logs[0]?.reviewItemId]);
    expect(items.items[0]?.payload).toMatchObject({
      kind: 'gmail',
      extraction: { amountMinor: null, accountId: null, occurredAt: null },
    });
    expect(await test.query('SELECT id FROM transactions')).toEqual([]);
    await expect(app(() => review.confirm(alice, items.items[0]?.id ?? ''))).rejects.toMatchObject({
      code: 'INVALID_TRANSACTION',
    });
    await app(() => review.ignore(alice, [items.items[0]?.id ?? '']));
    expect((await app(() => gmail().listLogs(alice)))[0]?.outcome).toBe('ignored');
    expect(await app(() => gmail().listLogs(bob))).toEqual([]);
    const [raw] = await test.query<{ quote_enc: Uint8Array }>('SELECT quote_enc FROM email_ingest_logs');
    expect(Buffer.from(raw?.quote_enc ?? []).toString()).not.toContain('Minimal payment');
  });
  it('persists validated extraction encrypted and keeps per-field null/uncertain values', async () => {
    const row = await worker(() => gmail().recordEmail(alice, email()));
    await test.query('INSERT INTO ai_settings(user_id) VALUES ($1)', [alice]);
    const claim = await worker(() => gmail().claimExtraction(alice, row.id ?? ''));
    expect(claim?.evidence.excerpt).toContain('Minimal payment');
    await worker(() => gmail().storeExtraction(alice, row.id ?? '', extraction));
    await worker(() => gmail().complete(alice, row.id ?? ''));
    expect((await app(() => gmail().listLogs(alice)))[0]?.extraction).toMatchObject({
      amountMinor: 350000n,
      accountId: null,
      confidence: { amount: 97, account: 0 },
    });
    const [stored] = await test.query<{ extraction_enc: Uint8Array }>('SELECT extraction_enc FROM email_ingest_logs');
    expect(Buffer.from(stored?.extraction_enc ?? []).toString()).not.toContain('350000');
  });
  it('never reclaims a potentially billed call; the interrupted result becomes a correction-required review', async () => {
    await test.query('INSERT INTO ai_settings(user_id) VALUES ($1)', [alice]);
    const row = await worker(() => gmail().recordEmail(alice, email()));
    expect(await worker(() => gmail().claimExtraction(alice, row.id ?? ''))).not.toBeNull();
    expect(await worker(() => gmail().claimExtraction(alice, row.id ?? ''))).toBeNull();
    expect(await worker(() => gmail().complete(alice, row.id ?? ''))).toBe('replay');
    clock = new Date(clock.getTime() + 60_001);
    expect(await worker(() => gmail().claimExtraction(alice, row.id ?? ''))).toBeNull();
    expect(await worker(() => gmail().complete(alice, row.id ?? ''))).toBe('pending');
    expect((await app(() => gmail().listLogs(alice)))[0]).toMatchObject({
      errorCode: 'GMAIL_INTERRUPTED',
      processing: 'done',
    });
  });
  it('purges evidence and Review copies after 30 days but preserves ID-only replay suppression', async () => {
    const row = await worker(() => gmail().recordEmail(alice, email()));
    await worker(() => gmail().claimExtraction(alice, row.id ?? ''));
    await worker(() => gmail().complete(alice, row.id ?? ''));
    await test.query("UPDATE email_ingest_logs SET created_at='2026-08-01'");
    await test.query("UPDATE review_items SET created_at='2026-08-01'");
    expect(await worker(() => gmail().purgeExpired(new Date('2026-09-18')))).toBe(1);
    expect(await app(() => gmail().listLogs(alice))).toEqual([]);
    expect(await test.query('SELECT id FROM review_items')).toEqual([]);
    expect(await worker(() => gmail().recordEmail(alice, email()))).toEqual({ id: null, duplicate: true });
    expect(await worker(() => gmail().pending(alice))).toEqual([]);
  });
  it('retains filters on reconnect and keeps history/watch writes grant-bound', async () => {
    const filters = { senders: ['bank.test'], keywords: ['paid'], ignoreKeywords: ['promo'] };
    const old = await app(() => gmail().saveConnection(alice, { email: 'fixture@gmail.com', tokens, filters }));
    await worker(() => gmail().setWatch(alice, old.grantId, new Date('2026-10-25')));
    await worker(() => gmail().setHistoryId(alice, '100', old.grantId));
    await app(() => gmail().saveConnection(alice, { email: 'other@gmail.com', tokens }));
    await expect(worker(() => gmail().setHistoryId(alice, '200', old.grantId))).rejects.toThrow();
    expect(await app(() => gmail().getConnection(alice))).toMatchObject({
      historyId: null,
      filters,
      watchRenewedAt: null,
    });
    expect(await worker(() => gmail().targets('other@gmail.com'))).toEqual([{ userId: alice }]);
    expect(await worker(() => gmail().targets('not-owned@gmail.com'))).toEqual([]);
  });
  it('counts the received local-month window, not delayed ingestion time', async () => {
    await worker(() => gmail().recordEmail(alice, email('in', { receivedAt: new Date('2026-09-30T17:00:00Z') })));
    await worker(() =>
      gmail().recordEmail(
        alice,
        email('out', { receivedAt: new Date('2026-10-31T17:00:00Z'), filterResult: 'filtered' }),
      ),
    );
    await worker(() =>
      gmail().recordEmail(
        alice,
        email('filtered', { receivedAt: new Date('2026-10-10T00:00:00Z'), filterResult: 'filtered' }),
      ),
    );
    await worker(() =>
      gmail().recordEmail(
        alice,
        email('promo', { receivedAt: new Date('2026-10-11T00:00:00Z'), filterResult: 'ignored_keyword' }),
      ),
    );
    expect(
      await app(() =>
        gmail().monthlyStats(alice, { from: new Date('2026-09-30T17:00:00Z'), to: new Date('2026-10-31T17:00:00Z') }),
      ),
    ).toEqual({
      received: 3,
      passed: 1,
      pending: 1,
      confirmed: 0,
      ignored: 1,
      duplicate: 0,
      filtered: 1,
    });
  });

  it('keyset-pages equal-timestamp logs without omissions and without crossing tenant scope', async () => {
    for (const id of ['a', 'b', 'c']) await worker(() => gmail().recordEmail(alice, email(id)));
    await worker(() => gmail().recordEmail(bob, email('foreign')));
    const all = await app(() => gmail().listLogs(alice));
    const first = await app(() => gmail().listLogs(alice, { limit: 2 }));
    const cursor = first.at(-1);
    if (cursor === undefined) throw new Error('Missing log page');
    const rest = await app(() =>
      gmail().listLogs(alice, { before: { at: cursor.createdAt, id: cursor.id }, limit: 2 }),
    );
    expect([...first, ...rest].map((row) => row.id)).toEqual(all.map((row) => row.id));
    expect(rest).toHaveLength(1);
    expect([...first, ...rest].some((row) => row.messageId === 'foreign')).toBe(false);
  });

  it('offers owned rule corrections and drops overflowing tags even when the provider cannot identify a merchant', async () => {
    const [category] = await test.query<{ id: string }>(
      `INSERT INTO categories(user_id,name,kind,"group",icon,color)
      VALUES($1,'Utilities','expense','needs','house','blue') RETURNING id`,
      [alice],
    );
    await test.query('INSERT INTO ai_settings(user_id) VALUES($1)', [alice]);
    await test.query('INSERT INTO auto_rules(user_id,name,position,conditions,actions) VALUES($1,$2,0,$3,$4)', [
      alice,
      'PLN',
      JSON.stringify([{ field: 'description', op: 'containsAny', values: ['PLN'] }]),
      JSON.stringify([
        { type: 'setCategory', categoryId: category?.id },
        ...Array.from({ length: 6 }, (_, index) => ({ type: 'addTag', tag: `tag-${index}` })),
      ]),
    ]);
    const row = await worker(() => gmail().recordEmail(alice, email()));
    await worker(() => gmail().claimExtraction(alice, row.id as string));
    await worker(() => gmail().storeExtraction(alice, row.id as string, { ...extraction, merchant: null }));
    await worker(() => gmail().complete(alice, row.id as string));
    const reviews = await app(() => createReview(test.db, { getDek, now: () => clock }).list(alice));
    expect(reviews.items[0]?.payload).toMatchObject({
      kind: 'gmail',
      tags: [],
      extraction: { merchant: null, categoryId: category?.id },
    });
    expect(await test.query('SELECT id FROM transactions')).toEqual([]);
  });
});
