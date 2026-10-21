// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import type { LocalDate } from '@wf/domain/period';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixtureGetDek, ledgerFixture, type LedgerFixture } from '../test/ledger-fixture.ts';
import { insertUser, pgError, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createAccounts } from './accounts.ts';
import { withUser } from './db.ts';
import type { EntryDraft } from './ledger-core.ts';
import { createOccurrenceJobs } from './occurrence-jobs.ts';
import { createReceivables, type ReceivableInput } from './receivables.ts';
import { createTransactionQuery } from './transaction-query.ts';
import { createTransactions } from './transactions.ts';

let test: TestDatabase;
let alice: LedgerFixture;

const NOW = new Date('2026-10-15T05:00:00Z');
const options = { getDek: fixtureGetDek, now: () => NOW };
const repo = () => createReceivables(test.db, options);
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const at = (date: string, time = '12:00') => new Date(`${date}T${time}:00+07:00`);
const OCTOBER = { from: '2026-10-01' as LocalDate, to: '2026-10-31' as LocalDate };

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  alice = await ledgerFixture(test, 'alice@example.test');
});

const loan = (overrides: Partial<ReceivableInput> = {}): ReceivableInput => ({
  clientId: randomUUID(),
  counterparty: '  Raka Pratama  ',
  amountMinor: 400_000n,
  fromAccountId: alice.jago,
  source: 'loan',
  description: null,
  note: null,
  lentAt: at('2026-10-02'),
  dueDate: '2026-10-31' as LocalDate,
  remind: false,
  ...overrides,
});

const balanceOf = async (id: string) =>
  (await asApp(() => createAccounts(test.db, options).list(alice.userId))).accounts.find((row) => row.id === id)
    ?.balanceMinor;
const summary = () =>
  asApp(() => createTransactionQuery(test.db, { getDek: fixtureGetDek }).summary(alice.userId, OCTOBER));
const pay = (id: string, amountMinor: bigint, extra: { accountId?: string; date?: string; record?: boolean } = {}) =>
  asApp(() =>
    repo().receivePayment(alice.userId, id, {
      clientId: randomUUID(),
      amountMinor,
      accountId: extra.accountId ?? alice.jago,
      receivedAt: at(extra.date ?? '2026-10-10'),
      ...(extra.record === undefined ? {} : { recordTransaction: extra.record }),
    }),
  );

describe('record (FR-U7 "Catat piutang")', () => {
  it('golden: lending Rp500.000 is a transfer to the receivable, not an expense', async () => {
    const before = await summary();
    const { receivable, transactionId } = await asApp(() =>
      repo().record(
        alice.userId,
        loan({
          counterparty: 'Bima Aditya',
          amountMinor: 500_000n,
          fromAccountId: alice.bca,
          description: '  ',
          note: 'Pinjam untuk servis motor',
          lentAt: at('2026-10-15', '09:00'),
          dueDate: '2026-10-31' as LocalDate,
          remind: true,
        }),
      ),
    );
    expect(receivable).toMatchObject({
      counterparty: 'Bima Aditya',
      description: null,
      note: 'Pinjam untuk servis motor',
      principalMinor: 500_000n,
      paidMinor: 0n,
      remainingMinor: 500_000n,
      repaidBps: 0,
      currency: 'IDR',
      fromAccountId: alice.bca,
      source: 'loan',
      transactionId,
      lentOn: '2026-10-15',
      status: 'open',
      payments: [],
    });
    expect(await balanceOf(alice.bca)).toBe(99_500_000n);
    expect(await summary()).toMatchObject({ inMinor: before.inMinor, outMinor: before.outMinor });
    const detail = await asApp(() => createTransactions(test.db, options).get(alice.userId, transactionId as string));
    expect(detail).toMatchObject({ type: 'receivable_out', note: 'Pinjam untuk servis motor', categoryId: null });
    expect(await test.query('SELECT receivable_id FROM transactions WHERE id = $1', [transactionId])).toEqual([
      { receivable_id: receivable.id },
    ]);
    // The person is stored encrypted.
    expect(
      await test.query(`SELECT position(convert_to('Bima', 'UTF8') in counterparty_enc) AS at FROM receivables`),
    ).toEqual([{ at: 0 }]);
    // H-1 09.00 WIB.
    expect(
      await test.query(
        `SELECT due_date::text AS due, expected_minor::text AS expected, remind_at FROM scheduled_occurrences`,
      ),
    ).toEqual([{ due: '2026-10-31', expected: '500000', remind_at: new Date('2026-10-30T02:00:00Z') }]);
  });

  it('is idempotent per client id and can record without a transaction', async () => {
    const input = loan();
    const first = await asApp(() => repo().record(alice.userId, input));
    expect(await asApp(() => repo().record(alice.userId, input))).toEqual(first);
    const without = await asApp(() => repo().record(alice.userId, loan({ recordTransaction: false })));
    expect(without.transactionId).toBeNull();
    // Due tomorrow, recorded after today's 09.00: too late for the H-1 reminder, the due date is still kept.
    await asApp(() =>
      repo().record(alice.userId, loan({ dueDate: '2026-10-16' as LocalDate, remind: true, recordTransaction: false })),
    );
    expect(await test.query('SELECT due_date::text AS due, remind_at FROM scheduled_occurrences')).toEqual([
      { due: '2026-10-16', remind_at: null },
    ]);
    expect(await test.query('SELECT count(*)::int AS n FROM transactions WHERE receivable_id IS NOT NULL')).toEqual([
      { n: 1 },
    ]);
  });

  it('links a split bill to the user’s own part', async () => {
    const own = await alice.entry('expense', '2026-10-15', 242_500n, alice.category('system:entertainment'));
    const { receivable } = await asApp(() =>
      repo().record(
        alice.userId,
        loan({ source: 'split_bill', sourceTransactionId: own, counterparty: 'Nadia', amountMinor: 242_500n }),
      ),
    );
    expect(receivable).toMatchObject({ source: 'split_bill', sourceTransactionId: own });
  });

  it('refuses what is not a receivable', async () => {
    const income = await alice.entry('income', '2026-10-15', 1n, null);
    const deleted = await alice.entry('expense', '2026-10-15', 1n, null);
    await asApp(() => createTransactions(test.db, options).remove(alice.userId, [deleted]));
    for (const [input, code] of [
      [loan({ counterparty: ' ' }), 'INVALID_RECEIVABLE'],
      [loan({ counterparty: 'x'.repeat(61) }), 'INVALID_RECEIVABLE'],
      [loan({ amountMinor: 0n }), 'INVALID_RECEIVABLE'],
      [loan({ dueDate: '2026-10-01' as LocalDate }), 'INVALID_RECEIVABLE'],
      [loan({ dueDate: null, remind: true }), 'INVALID_RECEIVABLE'],
      [loan({ sourceTransactionId: income }), 'INVALID_RECEIVABLE'],
      [loan({ source: 'split_bill', sourceTransactionId: income }), 'INVALID_RECEIVABLE'],
      [loan({ source: 'split_bill', sourceTransactionId: deleted }), 'NOT_FOUND'],
      [loan({ source: 'split_bill', sourceTransactionId: randomUUID() }), 'NOT_FOUND'],
      [loan({ fromAccountId: randomUUID() }), 'NOT_FOUND'],
    ] as const) {
      await expect(asApp(() => repo().record(alice.userId, input))).rejects.toMatchObject({ code });
    }
    await test.query(
      `INSERT INTO periods (user_id, label, start_date, end_date, days, status, closed_at)
       VALUES ($1, '2026-09', '2026-09-01', '2026-09-30', 30, 'closed', now())`,
      [alice.userId],
    );
    await expect(
      asApp(() => repo().record(alice.userId, loan({ lentAt: at('2026-09-20'), dueDate: null }))),
    ).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });
    // Lent before the ledger started: no transaction, so a closed period does not matter.
    expect(
      (
        await asApp(() =>
          repo().record(alice.userId, loan({ lentAt: at('2026-09-20'), dueDate: null, recordTransaction: false })),
        )
      ).receivable.lentOn,
    ).toBe('2026-09-20');
  });
});

describe('split bill (FR-L5 "Pisah tagihan")', () => {
  const bill = (overrides: Partial<EntryDraft> = {}): EntryDraft => ({
    type: 'expense',
    clientId: randomUUID(),
    occurredAt: at('2026-10-11', '19:30'),
    accountId: alice.bca,
    amountMinor: 242_500n,
    categoryId: alice.category('system:entertainment'),
    description: '  ',
    merchant: 'CGV Grand Indonesia',
    ...overrides,
  });
  const nadia = () => ({
    clientId: randomUUID(),
    counterparty: 'Nadia',
    amountMinor: 242_500n,
    dueDate: null,
    remind: false,
  });
  const count = async () => (await test.query<{ n: number }>('SELECT count(*)::int AS n FROM transactions'))[0]?.n;

  it('golden: CGV 485.000 halved — only the user’s 242.500 is spending, Nadia’s part is a receivable', async () => {
    const before = await summary();
    const input = { draft: bill(), shares: [{ ...nadia(), dueDate: '2026-10-18' as LocalDate, remind: true }] };
    const made = await asApp(() => repo().recordSplitBill(alice.userId, input));
    expect(made.receivables).toEqual([
      expect.objectContaining({
        counterparty: 'Nadia',
        description: 'CGV Grand Indonesia',
        principalMinor: 242_500n,
        fromAccountId: alice.bca,
        source: 'split_bill',
        sourceTransactionId: made.transactionId,
        lentOn: '2026-10-11',
        dueDate: '2026-10-18',
        remind: true,
      }),
    ]);
    expect(await balanceOf(alice.bca)).toBe(99_515_000n);
    expect(await summary()).toMatchObject({ inMinor: before.inMinor, outMinor: before.outMinor + 242_500n });
    expect(await test.query('SELECT due_date::text AS due FROM scheduled_occurrences')).toEqual([
      { due: '2026-10-18' },
    ]);
    // A replay returns the first result and records nothing more.
    const recorded = await count();
    expect(await asApp(() => repo().recordSplitBill(alice.userId, input))).toEqual(made);
    expect(await count()).toBe(recorded);
  });

  it('takes the description first and records several people', async () => {
    const made = await asApp(() =>
      repo().recordSplitBill(alice.userId, {
        draft: bill({ description: 'Nonton bareng', merchant: null }),
        shares: [nadia(), { ...nadia(), counterparty: 'Dimas', amountMinor: 100_000n }],
      }),
    );
    expect(made.receivables.map((row) => [row.counterparty, row.description, row.principalMinor])).toEqual([
      ['Nadia', 'Nonton bareng', 242_500n],
      ['Dimas', 'Nonton bareng', 100_000n],
    ]);
    expect(await balanceOf(alice.bca)).toBe(99_415_000n);
  });

  it('refuses what is not a split bill and keeps nothing of a refused one', async () => {
    const recorded = await count();
    for (const input of [
      { draft: bill({ type: 'income', categoryId: null }), shares: [nadia()] },
      { draft: bill(), shares: [] },
      { draft: bill(), shares: [{ ...nadia(), counterparty: ' ' }] },
      { draft: bill(), shares: [{ ...nadia(), dueDate: '2026-10-01' as LocalDate }] },
    ]) {
      await expect(asApp(() => repo().recordSplitBill(alice.userId, input))).rejects.toMatchObject({
        code: 'INVALID_RECEIVABLE',
      });
    }
    expect(await count()).toBe(recorded);
    expect(await balanceOf(alice.bca)).toBe(100_000_000n);
  });
});

describe('receive payment (FR-U7 "Terima pembayaran")', () => {
  it('golden: Raka 400.000 − 100.000 − 200.000 = 100.000 (75%), an incoming transfer, not income', async () => {
    const { receivable } = await asApp(() => repo().record(alice.userId, loan({ remind: true })));
    const first = await pay(receivable.id, 100_000n);
    expect(first).toMatchObject({ status: 'partial', paidMinor: 100_000n, remainingMinor: 300_000n, repaidBps: 2500 });
    const before = await summary();
    const second = await pay(receivable.id, 200_000n, { date: '2026-10-15' });
    expect(second).toMatchObject({ status: 'partial', remainingMinor: 100_000n, repaidBps: 7500, settledAt: null });
    expect(second.payments.map((payment) => [payment.amountMinor, payment.receivedOn])).toEqual([
      [100_000n, '2026-10-10'],
      [200_000n, '2026-10-15'],
    ]);
    expect(await balanceOf(alice.jago)).toBe(99_900_000n);
    expect(await summary()).toMatchObject({ inMinor: before.inMinor, outMinor: before.outMinor });
    expect(
      await test.query(
        `SELECT t.type, p.amount_minor::text AS amount FROM transactions t JOIN postings p ON p.transaction_id = t.id
         WHERE t.receivable_id = $1 ORDER BY t.occurred_at`,
        [receivable.id],
      ),
    ).toEqual([
      { type: 'receivable_out', amount: '-400000' },
      { type: 'receivable_in', amount: '100000' },
      { type: 'receivable_in', amount: '200000' },
    ]);
    // The reminder expects what is left; settling removes it.
    expect(await test.query('SELECT expected_minor::text AS expected FROM scheduled_occurrences')).toEqual([
      { expected: '100000' },
    ]);
    const settled = await pay(receivable.id, 100_000n, { date: '2026-10-20', record: false });
    expect(settled).toMatchObject({
      status: 'settled',
      remainingMinor: 0n,
      repaidBps: 10_000,
      settledAt: at('2026-10-20'),
    });
    expect(settled.payments.at(-1)?.transactionId).toBeNull();
    expect(await test.query('SELECT count(*)::int AS n FROM scheduled_occurrences')).toEqual([{ n: 0 }]);
  });

  it('is idempotent per client id and refuses what does not fit', async () => {
    const { receivable } = await asApp(() => repo().record(alice.userId, loan()));
    const input = { clientId: randomUUID(), amountMinor: 1n, accountId: alice.jago, receivedAt: at('2026-10-10') };
    const first = await asApp(() => repo().receivePayment(alice.userId, receivable.id, input));
    expect(await asApp(() => repo().receivePayment(alice.userId, receivable.id, input))).toEqual(first);
    const [usdAccount] = await test.query<{ id: string }>(
      `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_date, color)
       VALUES ($1, 'bank', 'US', 'US', 'USD', '2026-01-01', 'blue') RETURNING id`,
      [alice.userId],
    );
    const usd = usdAccount?.id as string;
    for (const [amount, extra] of [
      [0n, {}],
      [400_000n, {}],
      [1n, { accountId: usd }],
      [1n, { date: '2026-10-01' }],
    ] as const) {
      await expect(pay(receivable.id, amount, extra)).rejects.toMatchObject({ code: 'INVALID_RECEIVABLE' });
    }
    await pay(receivable.id, 399_999n);
    await expect(pay(receivable.id, 1n)).rejects.toMatchObject({ code: 'INVALID_RECEIVABLE' });
    await expect(pay(randomUUID(), 1n)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('never lets random repayments exceed the principal (Σ payments ≤ principal)', async () => {
    let seed = 7;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    for (let round = 0; round < 5; round += 1) {
      const principal = BigInt(1 + (next() % 1_000_000));
      const { receivable } = await asApp(() =>
        repo().record(alice.userId, loan({ amountMinor: principal, recordTransaction: false })),
      );
      let paid = 0n;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const amount = BigInt(1 + (next() % 600_000));
        const result = pay(receivable.id, amount, { record: false });
        if (paid + amount <= principal) {
          paid += amount;
          expect((await result).remainingMinor).toBe(principal - paid);
        } else {
          await expect(result).rejects.toMatchObject({ code: 'INVALID_RECEIVABLE' });
        }
      }
      expect((await asApp(() => repo().get(alice.userId, receivable.id))).paidMinor).toBe(paid);
    }
  });

  it('backs the rule with a trigger, even for raw SQL', async () => {
    const { receivable } = await asApp(() => repo().record(alice.userId, loan({ recordTransaction: false })));
    await pay(receivable.id, 300_000n, { record: false });
    const raw = (statement: SQL) => asApp(() => withUser(test.db, alice.userId, (tx) => tx.execute(statement)));
    const insert = (amount: bigint) =>
      raw(sql`INSERT INTO receivable_payments (user_id, receivable_id, account_id, amount_minor, received_on)
              VALUES (${alice.userId}, ${receivable.id}, ${alice.jago}, ${amount}, '2026-10-12')`);
    await expect(insert(100_001n)).rejects.toMatchObject(pgError(/exceed the principal/));
    await expect(raw(sql`UPDATE receivables SET principal_minor = 299999`)).rejects.toMatchObject(
      pgError(/exceed the principal/),
    );
    await insert(100_000n);
    await expect(
      raw(sql`UPDATE receivable_payments SET amount_minor = amount_minor + 1 WHERE amount_minor = 100000`),
    ).rejects.toMatchObject(pgError(/exceed the principal/));
  });
});

describe('write off (FR-U7 "Hapuskan")', () => {
  it('turns the remaining amount into an expense in the chosen category, moving no money', async () => {
    const { receivable } = await asApp(() => repo().record(alice.userId, loan({ remind: true })));
    await pay(receivable.id, 100_000n);
    const before = await summary();
    const input = {
      clientId: randomUUID(),
      occurredAt: at('2026-10-15'),
      categoryId: alice.category('system:bank_fee'),
    };
    const written = await asApp(() => repo().writeOff(alice.userId, receivable.id, input));
    expect(written).toMatchObject({ status: 'written_off', writtenOffAt: at('2026-10-15'), remainingMinor: 300_000n });
    expect(await balanceOf(alice.jago)).toBe(99_700_000n);
    expect((await summary()).outMinor).toBe(before.outMinor + 300_000n);
    expect(
      await test.query(
        `SELECT p.amount_minor::text AS amount, p.amount_base_minor::text AS base FROM postings p
         WHERE p.transaction_id = $1`,
        [written.writeoffTransactionId],
      ),
    ).toEqual([{ amount: '0', base: '-300000' }]);
    expect(await test.query('SELECT count(*)::int AS n FROM scheduled_occurrences')).toEqual([{ n: 0 }]);
    // A replay changes nothing; anything else on a written-off receivable is refused.
    expect(await asApp(() => repo().writeOff(alice.userId, receivable.id, input))).toEqual(written);
    await expect(
      asApp(() => repo().writeOff(alice.userId, receivable.id, { ...input, clientId: randomUUID() })),
    ).rejects.toMatchObject({ code: 'INVALID_RECEIVABLE' });
    await expect(pay(receivable.id, 1n)).rejects.toMatchObject({ code: 'INVALID_RECEIVABLE' });
  });

  it('refuses an income category and a date before the loan', async () => {
    const { receivable } = await asApp(() => repo().record(alice.userId, loan()));
    const input = { clientId: randomUUID(), occurredAt: at('2026-10-15'), categoryId: alice.category('system:salary') };
    await expect(asApp(() => repo().writeOff(alice.userId, receivable.id, input))).rejects.toMatchObject({
      code: 'CATEGORY_KIND_MISMATCH',
    });
    await expect(
      asApp(() =>
        repo().writeOff(alice.userId, receivable.id, {
          ...input,
          occurredAt: at('2026-10-01'),
          categoryId: alice.category('system:bank_fee'),
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RECEIVABLE' });
    // Without a category: the built-in "Piutang tak tertagih".
    const written = await asApp(() =>
      repo().writeOff(alice.userId, receivable.id, { clientId: randomUUID(), occurredAt: at('2026-10-15') }),
    );
    expect(
      await test.query('SELECT c.name FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.id = $1', [
        written.writeoffTransactionId,
      ]),
    ).toEqual([{ name: 'system:bad_debt' }]);
  });
});

describe('list, update, remove', () => {
  it('lists the active ones by due date, a 90-day history, the outstanding total, and the people', async () => {
    const record = async (input: Partial<ReceivableInput>) =>
      (await asApp(() => repo().record(alice.userId, loan({ recordTransaction: false, ...input })))).receivable;
    const nadia = await record({
      counterparty: 'Nadia',
      amountMinor: 242_500n,
      lentAt: at('2026-10-15'),
      dueDate: '2026-10-18' as LocalDate,
    });
    const raka = await record({ counterparty: 'Raka Pratama' });
    const open = await record({ counterparty: 'Sari', amountMinor: 1n, lentAt: at('2026-10-01'), dueDate: null });
    const dimas = await record({
      counterparty: 'Dimas',
      amountMinor: 150_000n,
      lentAt: at('2026-09-26'),
      dueDate: null,
    });
    const old = await record({ counterparty: 'Bima Aditya', lentAt: at('2026-06-05'), dueDate: null });
    const gone = await record({ counterparty: 'Nadia', amountMinor: 10n, lentAt: at('2026-10-14'), dueDate: null });
    await pay(raka.id, 100_000n, { record: false });
    await pay(dimas.id, 150_000n, { date: '2026-10-02', record: false });
    await pay(old.id, 400_000n, { date: '2026-06-20', record: false });
    await asApp(() =>
      repo().writeOff(alice.userId, gone.id, {
        clientId: randomUUID(),
        occurredAt: at('2026-10-14'),
        categoryId: alice.category('system:bank_fee'),
      }),
    );
    const overview = await asApp(() => repo().list(alice.userId));
    expect(overview.today).toBe('2026-10-15');
    expect(overview.active.map((row) => row.id)).toEqual([nadia.id, raka.id, open.id]);
    expect(overview.history.map((row) => row.id)).toEqual([gone.id, dimas.id]);
    expect(overview.outstandingMinor).toBe(542_501n);
    expect(overview.people).toEqual(['Nadia', 'Raka Pratama', 'Sari', 'Dimas', 'Bima Aditya']);
    expect((await asApp(() => repo().list(alice.userId, { historyDays: 200 }))).history).toHaveLength(3);
    const bob = await insertUser(test, 'bob@example.test');
    expect(await asApp(() => repo().list(bob))).toMatchObject({
      active: [],
      history: [],
      outstandingMinor: 0n,
      people: [],
    });
    await expect(asApp(() => repo().get(bob, nadia.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('updates the person, description, note (carried to the transactions), due date, and reminder', async () => {
    const { receivable, transactionId } = await asApp(() =>
      repo().record(alice.userId, loan({ description: 'Talangan', note: 'catatan' })),
    );
    await pay(receivable.id, 100_000n);
    const updated = await asApp(() =>
      repo().update(alice.userId, receivable.id, {
        counterparty: 'Raka',
        description: 'Talangan tiket kereta',
        note: 'baru',
        dueDate: '2026-11-07' as LocalDate,
        remind: true,
      }),
    );
    expect(updated).toMatchObject({
      counterparty: 'Raka',
      description: 'Talangan tiket kereta',
      note: 'baru',
      dueDate: '2026-11-07',
      remind: true,
    });
    expect(
      await test.query(`SELECT DISTINCT description FROM transactions WHERE receivable_id = $1`, [receivable.id]),
    ).toEqual([{ description: 'Talangan tiket kereta' }]);
    expect(
      (await asApp(() => createTransactions(test.db, options).get(alice.userId, transactionId as string))).note,
    ).toBe('baru');
    expect(await test.query('SELECT due_date::text AS due FROM scheduled_occurrences')).toEqual([
      { due: '2026-11-07' },
    ]);
    // Unchanged fields stay; the note can be cleared; the reminder can go.
    expect(await asApp(() => repo().update(alice.userId, receivable.id, {}))).toEqual(updated);
    const cleared = await asApp(() => repo().update(alice.userId, receivable.id, { note: null, remind: false }));
    expect(cleared).toMatchObject({ note: null, remind: false, dueDate: '2026-11-07' });
    expect(await test.query('SELECT count(*)::int AS n FROM scheduled_occurrences')).toEqual([{ n: 0 }]);
    await expect(
      asApp(() => repo().update(alice.userId, receivable.id, { dueDate: null, remind: true })),
    ).rejects.toMatchObject({ code: 'INVALID_RECEIVABLE' });
    await expect(asApp(() => repo().update(alice.userId, randomUUID(), {}))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('removes a receivable with its transactions and reminder, returning their stored files', async () => {
    const { receivable, transactionId } = await asApp(() => repo().record(alice.userId, loan({ remind: true })));
    await pay(receivable.id, 100_000n);
    for (const [objectKey, thumbnailKey] of [
      ['u/a/1', 'u/a/1t'],
      ['u/a/2', null],
    ]) {
      await test.query(
        `INSERT INTO attachments (user_id, transaction_id, bucket, object_key, thumbnail_key, mime, size, sha256, kind)
         VALUES ($1, $2, 'wf', $3, $4, 'image/jpeg', 1, repeat('a', 64), 'receipt')`,
        [alice.userId, transactionId, objectKey, thumbnailKey],
      );
    }
    expect(await asApp(() => repo().remove(alice.userId, receivable.id))).toEqual({
      objectKeys: ['u/a/1', 'u/a/1t', 'u/a/2'],
    });
    expect(await test.query('SELECT count(*)::int AS n FROM transactions WHERE receivable_id IS NOT NULL')).toEqual([
      { n: 0 },
    ]);
    expect(await test.query('SELECT count(*)::int AS n FROM scheduled_occurrences')).toEqual([{ n: 0 }]);
    expect(await balanceOf(alice.jago)).toBe(100_000_000n);
    await expect(asApp(() => repo().remove(alice.userId, receivable.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps transactions dated in a closed period: no edit carried to them, no removal', async () => {
    const { receivable } = await asApp(() =>
      repo().record(alice.userId, loan({ lentAt: at('2026-09-20'), dueDate: null })),
    );
    await test.query(
      `INSERT INTO periods (user_id, label, start_date, end_date, days, status, closed_at)
       VALUES ($1, '2026-09', '2026-09-01', '2026-09-30', 30, 'closed', now())`,
      [alice.userId],
    );
    await expect(asApp(() => repo().update(alice.userId, receivable.id, { description: 'x' }))).rejects.toMatchObject({
      code: 'PERIOD_CLOSED',
    });
    await expect(asApp(() => repo().remove(alice.userId, receivable.id))).rejects.toMatchObject({
      code: 'PERIOD_CLOSED',
    });
    // A due date is not carried to the transactions.
    expect(
      (await asApp(() => repo().update(alice.userId, receivable.id, { dueDate: '2026-10-31' as LocalDate }))).dueDate,
    ).toBe('2026-10-31');
  });

  it('cannot be written by the worker', async () => {
    const worker = createReceivables(test.db, { getDek: fixtureGetDek });
    await expect(test.as('wf_worker', () => worker.record(alice.userId, loan()))).rejects.toMatchObject(
      pgError(/permission denied/),
    );
  });
});

describe('managed transactions and reminders', () => {
  it('refuses generic edits of lending, repayment, and write-off transactions', async () => {
    const { receivable, transactionId } = await asApp(() => repo().record(alice.userId, loan()));
    const transactions = createTransactions(test.db, options);
    const id = transactionId as string;
    const attempts: (() => Promise<unknown>)[] = [
      () =>
        transactions.update(alice.userId, id, {
          type: 'expense',
          clientId: randomUUID(),
          occurredAt: at('2026-10-02'),
          accountId: alice.jago,
          amountMinor: 1n,
          categoryId: null,
        }),
      () => transactions.remove(alice.userId, [id]),
      () => transactions.duplicate(alice.userId, id, { clientId: randomUUID() }),
      () => transactions.split(alice.userId, id, { clientId: randomUUID(), parts: [] }),
      () => transactions.unsplit(alice.userId, id),
      () => transactions.bulkSetCategory(alice.userId, [id], null),
      () => transactions.bulkMoveAccount(alice.userId, [id], alice.bca),
    ];
    for (const attempt of attempts) {
      await expect(asApp(attempt)).rejects.toMatchObject({ code: 'INVALID_TRANSACTION' });
    }
    expect((await pay(receivable.id, 1n)).paidMinor).toBe(1n);
  });

  it('reminds H-1 in the app only, without the person’s name', async () => {
    await test.query(`UPDATE user_preferences SET notif = '{"email": true}'::jsonb WHERE user_id = $1`, [alice.userId]);
    await asApp(() =>
      repo().record(
        alice.userId,
        loan({ counterparty: 'Nadia', description: 'Nonton bareng', remind: true, dueDate: '2026-10-18' as LocalDate }),
      ),
    );
    await asApp(() => repo().record(alice.userId, loan({ remind: true, dueDate: '2026-10-18' as LocalDate })));
    const jobs = createOccurrenceJobs(test.db, { getDek: fixtureGetDek });
    const reminders = await test.query<{ id: string }>('SELECT id FROM scheduled_occurrences ORDER BY created_at');
    for (const { id } of reminders) {
      expect(await test.as('wf_worker', () => jobs.remind(alice.userId, id, new Date('2026-10-17T02:00:00Z')))).toEqual(
        {
          reminded: true,
          emailed: false,
        },
      );
    }
    expect(await test.query(`SELECT type, body_key, params, action FROM notifications ORDER BY created_at`)).toEqual([
      {
        type: 'receivable_due',
        body_key: 'notification_receivable_due_body',
        params: {
          description: 'Nonton bareng',
          amount: { amountMinor: '400000', currency: 'IDR' },
          dueDate: '2026-10-18',
          days: 1,
        },
        action: { href: '/debts?tab=receivables' },
      },
      {
        type: 'receivable_due',
        body_key: 'notification_receivable_due_plain_body',
        params: {
          description: null,
          amount: { amountMinor: '400000', currency: 'IDR' },
          dueDate: '2026-10-18',
          days: 1,
        },
        action: { href: '/debts?tab=receivables' },
      },
    ]);
    expect(await test.query('SELECT count(*)::int AS n FROM notification_outbox')).toEqual([{ n: 0 }]);
    // A reminder whose receivable is gone (raw SQL) does nothing.
    await test.query(
      `INSERT INTO scheduled_occurrences (user_id, source_type, source_id, due_date, expected_minor, currency, remind_at)
       VALUES ($1, 'receivable', $2, '2026-10-18', 1, 'IDR', '2026-10-17T02:00:00Z')`,
      [alice.userId, randomUUID()],
    );
    const [orphan] = await test.query<{ id: string }>(`SELECT id FROM scheduled_occurrences WHERE reminded_at IS NULL`);
    expect(
      await test.as('wf_worker', () =>
        jobs.remind(alice.userId, orphan?.id as string, new Date('2026-10-17T02:00:00Z')),
      ),
    ).toEqual({ reminded: false, emailed: false });
  });
});
