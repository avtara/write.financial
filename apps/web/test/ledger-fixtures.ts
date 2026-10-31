// SPDX-License-Identifier: AGPL-3.0-only
/** Ledger views for component tests (shapes from `@wf/db`). */
import type { CategoryView } from '@wf/db/categories';
import type { TagView } from '@wf/db/tags';
import type { AccountView } from '@wf/db/accounts';
import { BUILT_IN_CATEGORIES, type BuiltInCategoryKey } from '@wf/domain/categories';
import type { LocalDate } from '@wf/domain/period';

export function categoryView(patch: Partial<CategoryView> = {}): CategoryView {
  return {
    id: 'c-1',
    kind: 'expense',
    group: 'wants',
    name: 'Belanja',
    builtInKey: null,
    icon: 'shopping-bag',
    color: 'violet',
    sortOrder: 0,
    isFixed: false,
    isSystem: false,
    archivedAt: null,
    transactionCount: 12,
    ...patch,
  };
}

export function tagView(slug: string, usageCount = 0, aliases: string[] = []): TagView {
  return { id: `t-${slug}`, slug, usageCount, aliases };
}

const CREATED = new Date('2026-01-01T00:00:00Z');

/** An active IDR bank account; override what the test needs. */
export function account(overrides: Partial<AccountView> & Pick<AccountView, 'id' | 'displayName'>): AccountView {
  return {
    type: 'bank',
    providerName: overrides.displayName,
    logoKey: null,
    catalogId: null,
    last4: null,
    phoneMasked: null,
    currency: 'IDR',
    openingBalanceMinor: 0n,
    openingDate: '2026-01-01' as LocalDate,
    color: 'blue',
    includeInAvailable: true,
    isSavings: false,
    sortOrder: 0,
    status: 'active',
    archivedAt: null,
    lowBalanceThresholdMinor: null,
    lastReconciledAt: null,
    ccLimitMinor: null,
    ccStatementDay: null,
    ccDueDay: null,
    parentAccountId: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    balanceMinor: 0n,
    balanceBaseMinor: 0n,
    locked: false,
    transactionCount: 0,
    holdingsValueBaseMinor: null,
    ...overrides,
  };
}

export const BCA = account({
  id: 'acc-bca',
  displayName: 'BCA Tahapan',
  providerName: 'BCA',
  last4: '4821',
  balanceMinor: 42_810_000n,
  balanceBaseMinor: 42_810_000n,
  sortOrder: 0,
});
export const JAGO = account({
  id: 'acc-jago',
  displayName: 'Bank Jago',
  providerName: 'Jago',
  color: 'yellow',
  balanceMinor: 5_250_000n,
  balanceBaseMinor: 5_250_000n,
  sortOrder: 1,
});
export const OVO = account({
  id: 'acc-ovo',
  type: 'ewallet',
  displayName: 'OVO',
  providerName: 'OVO',
  phoneMasked: '0812••••7788',
  color: 'violet',
  balanceMinor: 86_000n,
  balanceBaseMinor: 86_000n,
  sortOrder: 2,
});
/** US$52,00 at Rp16.350. */
export const GOTRADE = account({
  id: 'acc-gotrade',
  type: 'investment',
  displayName: 'Gotrade',
  providerName: 'Gotrade',
  currency: 'USD',
  color: 'green',
  balanceMinor: 5_200n,
  balanceBaseMinor: 850_200n,
  sortOrder: 3,
});
export const CARD = account({
  id: 'acc-card',
  type: 'credit_card',
  displayName: 'BCA Visa',
  providerName: 'BCA',
  last4: '9012',
  color: 'red',
  includeInAvailable: false,
  balanceMinor: -1_250_000n,
  balanceBaseMinor: -1_250_000n,
  ccLimitMinor: 20_000_000n,
  sortOrder: 4,
});
export const ARCHIVED = account({
  id: 'acc-old',
  displayName: 'Mandiri Lama',
  providerName: 'Mandiri',
  status: 'archived',
  archivedAt: new Date('2026-06-01T00:00:00Z'),
  sortOrder: 5,
});

export const ACCOUNTS: readonly AccountView[] = [BCA, JAGO, OVO, GOTRADE, CARD, ARCHIVED];

/** Built-in category ids are `cat-<key without "system:">`, e.g. `cat-food`. */
export const categoryId = (key: BuiltInCategoryKey): string => `cat-${key.slice('system:'.length)}`;

/** Usage counts behind "most used first". */
const USAGE: Partial<Record<BuiltInCategoryKey, number>> = {
  'system:food': 42,
  'system:transport': 30,
  'system:shopping': 12,
  'system:bills': 8,
  'system:entertainment': 5,
  'system:health': 2,
  'system:salary': 10,
  'system:freelance': 4,
  'system:bank_fee': 3,
};

/** Every built-in category, stored like the server lists them (the key as the name). */
export const CATEGORIES: readonly CategoryView[] = BUILT_IN_CATEGORIES.map((builtIn, index) => ({
  id: categoryId(builtIn.key),
  kind: builtIn.kind,
  group: builtIn.group,
  name: builtIn.key,
  builtInKey: builtIn.key,
  icon: builtIn.icon,
  color: builtIn.color,
  sortOrder: index,
  isFixed: builtIn.isFixed,
  isSystem: builtIn.isSystem,
  archivedAt: null,
  transactionCount: USAGE[builtIn.key] ?? 0,
}));

/** A user category (not built in), e.g. "Kopi". */
export function userCategory(overrides: Partial<CategoryView> & Pick<CategoryView, 'id' | 'name'>): CategoryView {
  return {
    kind: 'expense',
    group: 'wants',
    builtInKey: null,
    icon: 'coffee',
    color: 'orange',
    sortOrder: 100,
    isFixed: false,
    isSystem: false,
    archivedAt: null,
    transactionCount: 0,
    ...overrides,
  };
}

export const TAGS: readonly TagView[] = [
  { id: 'tag-kantor', slug: 'kantor', usageCount: 18, aliases: [] },
  { id: 'tag-liburan-bali', slug: 'liburan-bali', usageCount: 7, aliases: ['bali'] },
  { id: 'tag-keluarga', slug: 'keluarga', usageCount: 4, aliases: [] },
  { id: 'tag-kopi', slug: 'kopi', usageCount: 2, aliases: [] },
  { id: 'tag-baru', slug: 'baru', usageCount: 0, aliases: [] },
];

/** `LedgerData` of the ledger forms: base currency IDR, every fixture above. */
export const LEDGER = {
  baseCurrency: 'IDR',
  accounts: ACCOUNTS,
  categories: CATEGORIES,
  tags: TAGS,
  rules: [],
  subscriptionNames: [],
} as const;
