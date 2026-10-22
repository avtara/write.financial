// SPDX-License-Identifier: AGPL-3.0-only
/** Ledger fixtures for the account screens' tests: `AccountView`s and categories shaped like the repositories'. */
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';

let next = 0;

/** A bank account in IDR, created 1 Oct 2026 (00.00 WIB); override any field. */
export function accountView(overrides: Partial<AccountView> = {}): AccountView {
  next += 1;
  const id = `0192a6c4-0000-7000-8000-${String(next).padStart(12, '0')}`;
  return {
    id,
    type: 'bank',
    providerName: 'Bank Central Asia',
    logoKey: null,
    displayName: `Rekening ${next}`,
    last4: '4821',
    phoneMasked: null,
    currency: 'IDR',
    openingBalanceMinor: 1_000_000n,
    openingDate: '2026-09-30' as AccountView['openingDate'],
    color: 'blue',
    includeInAvailable: true,
    showAsCard: false,
    isDefaultQuickEntry: false,
    sortOrder: next,
    status: 'active',
    archivedAt: null,
    lowBalanceThresholdMinor: null,
    lastReconciledAt: null,
    ccLimitMinor: null,
    ccStatementDay: null,
    ccDueDay: null,
    parentAccountId: null,
    createdAt: new Date('2026-09-30T17:00:00Z'),
    updatedAt: new Date('2026-09-30T17:00:00Z'),
    balanceMinor: 1_000_000n,
    balanceBaseMinor: 1_000_000n,
    locked: false,
    transactionCount: 0,
    holdingsValueBaseMinor: null,
    ...overrides,
  };
}

export function categoryView(overrides: Partial<CategoryView> = {}): CategoryView {
  next += 1;
  return {
    id: `0192a6c4-0000-7000-8001-${String(next).padStart(12, '0')}`,
    kind: 'expense',
    group: 'needs',
    name: `Kategori ${next}`,
    builtInKey: null,
    icon: 'tag',
    color: 'blue',
    sortOrder: next,
    isFixed: false,
    isSystem: false,
    archivedAt: null,
    transactionCount: 0,
    ...overrides,
  };
}

/** Built-ins the reconciliation tests pick from (names render per locale). */
export const CATEGORIES: CategoryView[] = [
  categoryView({ kind: 'fee', group: 'financial', name: 'system:monthly_admin', builtInKey: 'system:monthly_admin' }),
  categoryView({ kind: 'expense', group: 'needs', name: 'system:food', builtInKey: 'system:food' }),
  categoryView({ kind: 'income', group: 'other', name: 'system:cashback', builtInKey: 'system:cashback' }),
  categoryView({ kind: 'fee', group: 'financial', name: 'system:fx_difference', builtInKey: 'system:fx_difference' }),
  categoryView({ kind: 'expense', name: 'Lama', archivedAt: new Date('2026-01-01T00:00:00Z') }),
];
