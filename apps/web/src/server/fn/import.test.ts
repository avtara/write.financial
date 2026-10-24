// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import { requestImport } from './import.ts';

const fake = vi.hoisted(() => ({
  ledgerError: (code: string) => Object.assign(new Error(code), { code }),
  importReview: {
    propose: vi.fn(() =>
      Promise.resolve({ created: 41, duplicates: 5, rejected: 2, itemIds: ['0192a6c4-0000-7000-8000-0000000000aa'] }),
    ),
  },
}));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () => Promise.resolve({ importReview: fake.importReview, now: () => new Date('2026-10-18T09:00:00Z') }),
}));

const USER_ID = fakeSession().user.id;
const signedIn = () => requestContext(fakeSession());
const signedOut = () => requestContext(null);

const ACCOUNT = '0192a6c4-0000-7000-8000-000000000002';

const row = {
  date: '2026-10-05',
  amountMinor: 25_000n,
  direction: 'out',
  description: 'QRIS KOPI',
  categoryId: null,
  transferAccountId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requestImport', () => {
  it('proposes the session user’s rows and answers the counts', async () => {
    const data = { accountId: '0192a6c4-0000-7000-8000-000000000002', rows: [row] };
    expect(await call(requestImport, { context: signedIn(), data })).toEqual({
      ok: true,
      value: { created: 41, duplicates: 5, rejected: 2, itemIds: ['0192a6c4-0000-7000-8000-0000000000aa'] },
    });
    expect(fake.importReview.propose).toHaveBeenCalledWith(USER_ID, data);
  });

  it('turns ledger errors into expected results (another user’s account is NOT_FOUND)', async () => {
    fake.importReview.propose.mockRejectedValueOnce(fake.ledgerError('NOT_FOUND'));
    expect(await call(requestImport, { context: signedIn(), data: { accountId: 'x-1', rows: [row] } })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('caps the rows at 500 and validates each row', () => {
    const validator = validatorOf(requestImport);
    const rows = Array.from({ length: 500 }, () => row);
    const parsed = validator.parse({ accountId: ACCOUNT, rows }) as { rows: unknown[] };
    expect(parsed.rows).toHaveLength(500);
    expect(validator.safeParse({ accountId: ACCOUNT, rows: [...rows, row] }).success).toBe(false);
    expect(validator.safeParse({ accountId: ACCOUNT, rows: [{ ...row, amountMinor: 0n }] }).success).toBe(false);
    expect(validator.safeParse({ accountId: ACCOUNT, rows: [{ ...row, date: '31/09/2026' }] }).success).toBe(false);
    expect(validator.safeParse({ accountId: 'nope', rows: [row] }).success).toBe(false);
  });

  it('refuses signed-out requests', async () => {
    expect(await call(requestImport, { context: signedOut(), data: { accountId: 'x', rows: [row] } })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    expect(fake.importReview.propose).not.toHaveBeenCalled();
  });
});
