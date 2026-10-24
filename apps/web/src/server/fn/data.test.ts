// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext } from '../../../test/server-fn.ts';
import type { Result } from '../access.ts';
import { cancelAccountDeletion, deleteAfterOf, exportMyData, getDataSettings, requestAccountDeletion } from './data.ts';

const USER_ID = fakeSession().user.id;
const REQUESTED_AT = new Date('2026-10-16T09:00:00Z');
const DELETE_AFTER = new Date('2026-10-23T09:00:00Z');

const fake = vi.hoisted(() => ({
  accountDeletion: {
    request: vi.fn(() => Promise.resolve(DELETE_AFTER)),
    cancel: vi.fn(() => Promise.resolve(true)),
  },
  export: {
    collect: vi.fn(() =>
      Promise.resolve({
        exportedAt: NOW,
        truncated: [],
        user: { name: 'Avtara K.' },
        accounts: [{ id: 'a1', displayName: 'Bank', openingBalanceMinor: 1_000_000n }],
        // The db layer strips the ciphertext columns; the export never sees them.
        transactions: [{ id: 't1', description: 'Kopi' }],
      }),
    ),
    ledgerRows: vi.fn(() =>
      Promise.resolve([
        {
          id: 't1',
          occurredAt: new Date('2026-10-05T05:00:00Z'),
          type: 'expense',
          description: 'Kopi, susu',
          merchant: null,
          amountMinor: '-18000',
          currency: 'IDR',
          account: 'Bank',
          category: null,
          tags: null,
          deletedAt: null,
        },
      ]),
    ),
  },
  securityEvents: { list: vi.fn(), append: vi.fn(() => Promise.resolve()) },
}));

vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () =>
    Promise.resolve({
      now: () => NOW,
      accountDeletion: fake.accountDeletion,
      export: fake.export,
      securityEvents: fake.securityEvents,
    }),
}));

const signedIn = (twoFactorEnabled = true) => requestContext(fakeSession({ twoFactorEnabled }));

beforeEach(() => {
  vi.clearAllMocks();
  fake.accountDeletion.request.mockResolvedValue(DELETE_AFTER);
  fake.accountDeletion.cancel.mockResolvedValue(true);
});

describe('getDataSettings', () => {
  it('reports a pending deletion and the day the grace period ends', async () => {
    const withRequest = fakeSession();
    const context = requestContext({
      ...withRequest,
      user: { ...withRequest.user, deletionRequestedAt: REQUESTED_AT },
    });
    expect(await call(getDataSettings, { context })).toEqual({
      ok: true,
      value: { deletionRequestedAt: REQUESTED_AT.toISOString(), deleteAfter: DELETE_AFTER.toISOString() },
    });
    expect(await call(getDataSettings, { context: signedIn() })).toEqual({
      ok: true,
      value: { deletionRequestedAt: null, deleteAfter: null },
    });
    expect(await call(getDataSettings, { context: requestContext(null) })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
  });

  it('adds the 7 days, and none when there is no request', () => {
    expect(deleteAfterOf(REQUESTED_AT)).toEqual(DELETE_AFTER);
    expect(deleteAfterOf(null)).toBeNull();
  });
});

describe('exportMyData', () => {
  it('requires 2FA, then returns the JSON document and the CSV of the ledger', async () => {
    expect(await call(exportMyData, { context: signedIn(false) })).toEqual({ ok: false, code: 'TWO_FACTOR_REQUIRED' });
    expect(fake.export.collect).not.toHaveBeenCalled();
    const result = await call<Result<{ exportedAt: string; json: string; csv: string }>>(exportMyData, {
      context: signedIn(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exportedAt).toBe(NOW.toISOString());
    expect(fake.export.collect).toHaveBeenCalledWith(USER_ID);
    expect(fake.export.ledgerRows).toHaveBeenCalledWith(USER_ID);
    // Amounts as decimal strings (JSON has no bigint).
    expect(result.value.json).toContain('"openingBalanceMinor": "1000000"');
    // The CSV quotes a comma inside a description (RFC 4180).
    expect(result.value.csv).toContain('"Kopi, susu"');
  });
});

describe('account deletion', () => {
  it('requires 2FA to start the grace period, records it, and returns the deletion date', async () => {
    expect(await call(requestAccountDeletion, { context: signedIn(false) })).toEqual({
      ok: false,
      code: 'TWO_FACTOR_REQUIRED',
    });
    expect(fake.accountDeletion.request).not.toHaveBeenCalled();
    expect(await call(requestAccountDeletion, { context: signedIn() })).toEqual({
      ok: true,
      value: { deletionRequestedAt: NOW.toISOString(), deleteAfter: DELETE_AFTER.toISOString() },
    });
    expect(fake.accountDeletion.request).toHaveBeenCalledWith(USER_ID, NOW);
    expect(fake.securityEvents.append).toHaveBeenCalledWith(USER_ID, {
      type: 'account_deletion_requested',
      ipHash: null,
      userAgent: null,
    });
  });

  it('cancels during the grace period and records it only when something was pending', async () => {
    expect(await call(cancelAccountDeletion, { context: signedIn(false) })).toEqual({
      ok: false,
      code: 'TWO_FACTOR_REQUIRED',
    });
    expect(await call(cancelAccountDeletion, { context: signedIn() })).toEqual({
      ok: true,
      value: { deletionRequestedAt: null, deleteAfter: null },
    });
    expect(fake.accountDeletion.cancel).toHaveBeenCalledWith(USER_ID);
    expect(fake.securityEvents.append).toHaveBeenCalledWith(USER_ID, {
      type: 'account_deletion_cancelled',
      ipHash: null,
      userAgent: null,
    });
    fake.securityEvents.append.mockClear();
    fake.accountDeletion.cancel.mockResolvedValue(false);
    await call(cancelAccountDeletion, { context: signedIn() });
    expect(fake.securityEvents.append).not.toHaveBeenCalled();
  });
});
