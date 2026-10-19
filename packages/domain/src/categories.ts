// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Category kinds, groups, and the built-in catalog (FR-K1). Built-in categories are stored with their key as the
 * name (`system:food`) and rendered per locale by the UI; user-created names are stored as typed (plan §7).
 */

/** `fee` = the system group "Biaya keuangan" (financial costs: bank/platform fees, admin, tax, FX difference). */
export const CATEGORY_KINDS = ['expense', 'income', 'fee'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

/** Expense: needs/wants; fee: financial; income: active/passive/other ("Aktif/Pasif/Lainnya"). */
export const CATEGORY_GROUPS = ['needs', 'wants', 'financial', 'active', 'passive', 'other'] as const;
export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];

/** The groups a category of each kind may belong to. */
export const GROUPS_BY_KIND: Readonly<Record<CategoryKind, readonly CategoryGroup[]>> = {
  expense: ['needs', 'wants'],
  income: ['active', 'passive', 'other'],
  fee: ['financial'],
};

/** Prefix of a built-in category name; user-typed names cannot start with it. */
export const BUILT_IN_PREFIX = 'system:';

/** Maximum length of a category name (FR-K1). */
export const CATEGORY_NAME_MAX = 24;

export interface BuiltInCategory {
  readonly key: `system:${string}`;
  readonly kind: CategoryKind;
  readonly group: CategoryGroup;
  /** Lucide icon name (kebab-case). */
  readonly icon: string;
  /** Color token name from `design/tokens.json`. */
  readonly color: string;
  /** System categories (the "Biaya keuangan" group) cannot be deleted. */
  readonly isSystem: boolean;
  /** Fixed monthly cost (rent, bills, subscriptions). */
  readonly isFixed: boolean;
}

/** The built-in catalog in display order (FR-K1; design Sections 01, 03, 06 and Settings › Kategori). */
export const BUILT_IN_CATEGORIES = [
  { key: 'system:rent', kind: 'expense', group: 'needs', icon: 'house', color: 'blue', isSystem: false, isFixed: true },
  {
    key: 'system:food',
    kind: 'expense',
    group: 'needs',
    icon: 'utensils',
    color: 'orange',
    isSystem: false,
    isFixed: false,
  },
  {
    key: 'system:transport',
    kind: 'expense',
    group: 'needs',
    icon: 'bus',
    color: 'cyan',
    isSystem: false,
    isFixed: false,
  },
  {
    key: 'system:bills',
    kind: 'expense',
    group: 'needs',
    icon: 'receipt',
    color: 'yellow',
    isSystem: false,
    isFixed: true,
  },
  {
    key: 'system:health',
    kind: 'expense',
    group: 'needs',
    icon: 'heart-pulse',
    color: 'rose',
    isSystem: false,
    isFixed: false,
  },
  {
    key: 'system:shopping',
    kind: 'expense',
    group: 'wants',
    icon: 'shopping-bag',
    color: 'violet',
    isSystem: false,
    isFixed: false,
  },
  {
    key: 'system:entertainment',
    kind: 'expense',
    group: 'wants',
    icon: 'clapperboard',
    color: 'red',
    isSystem: false,
    isFixed: false,
  },
  {
    key: 'system:subscriptions',
    kind: 'expense',
    group: 'wants',
    icon: 'repeat',
    color: 'amber',
    isSystem: false,
    isFixed: true,
  },
  {
    key: 'system:hobby',
    kind: 'expense',
    group: 'wants',
    icon: 'palette',
    color: 'green',
    isSystem: false,
    isFixed: false,
  },
  {
    key: 'system:personal_care',
    kind: 'expense',
    group: 'wants',
    icon: 'sparkles',
    color: 'rose',
    isSystem: false,
    isFixed: false,
  },
  {
    key: 'system:gifts',
    kind: 'expense',
    group: 'wants',
    icon: 'gift',
    color: 'violet',
    isSystem: false,
    isFixed: false,
  },
  {
    key: 'system:bank_fee',
    kind: 'fee',
    group: 'financial',
    icon: 'landmark',
    color: 'subtle',
    isSystem: true,
    isFixed: false,
  },
  {
    key: 'system:platform_fee',
    kind: 'fee',
    group: 'financial',
    icon: 'percent',
    color: 'subtle',
    isSystem: true,
    isFixed: false,
  },
  {
    key: 'system:monthly_admin',
    kind: 'fee',
    group: 'financial',
    icon: 'calendar-clock',
    color: 'subtle',
    isSystem: true,
    isFixed: false,
  },
  {
    key: 'system:tax_stamp',
    kind: 'fee',
    group: 'financial',
    icon: 'stamp',
    color: 'subtle',
    isSystem: true,
    isFixed: false,
  },
  {
    key: 'system:fx_difference',
    kind: 'fee',
    group: 'financial',
    icon: 'arrow-left-right',
    color: 'subtle',
    isSystem: true,
    isFixed: false,
  },
  {
    key: 'system:salary',
    kind: 'income',
    group: 'active',
    icon: 'briefcase',
    color: 'green',
    isSystem: false,
    isFixed: false,
  },
  {
    key: 'system:freelance',
    kind: 'income',
    group: 'active',
    icon: 'laptop',
    color: 'blue',
    isSystem: false,
    isFixed: false,
  },
  {
    key: 'system:bonus',
    kind: 'income',
    group: 'active',
    icon: 'party-popper',
    color: 'amber',
    isSystem: false,
    isFixed: false,
  },
  {
    key: 'system:dividend_interest',
    kind: 'income',
    group: 'passive',
    icon: 'trending-up',
    color: 'cyan',
    isSystem: false,
    isFixed: false,
  },
  {
    key: 'system:property_rent',
    kind: 'income',
    group: 'passive',
    icon: 'building',
    color: 'violet',
    isSystem: false,
    isFixed: false,
  },
  {
    key: 'system:royalty',
    kind: 'income',
    group: 'passive',
    icon: 'badge-percent',
    color: 'yellow',
    isSystem: false,
    isFixed: false,
  },
  {
    key: 'system:sales',
    kind: 'income',
    group: 'other',
    icon: 'tag',
    color: 'orange',
    isSystem: false,
    isFixed: false,
  },
  {
    key: 'system:reimbursement',
    kind: 'income',
    group: 'other',
    icon: 'receipt-text',
    color: 'blue',
    isSystem: false,
    isFixed: false,
  },
  {
    key: 'system:cashback',
    kind: 'income',
    group: 'other',
    icon: 'rotate-ccw',
    color: 'green',
    isSystem: false,
    isFixed: false,
  },
  {
    key: 'system:gift_received',
    kind: 'income',
    group: 'other',
    icon: 'gift',
    color: 'rose',
    isSystem: false,
    isFixed: false,
  },
] as const satisfies readonly BuiltInCategory[];

export type BuiltInCategoryKey = (typeof BUILT_IN_CATEGORIES)[number]['key'];

/** Category of the FX difference recorded automatically on cross-currency transfers (FR-T4). */
export const FX_DIFFERENCE_CATEGORY = 'system:fx_difference' satisfies BuiltInCategoryKey;

/** Verbatim Indonesian design names, for tests and CLI output (UI names come from i18n). */
export const BUILT_IN_NAMES_ID: Readonly<Record<BuiltInCategoryKey, string>> = {
  'system:rent': 'Sewa Kos',
  'system:food': 'Makan & Dapur',
  'system:transport': 'Transportasi',
  'system:bills': 'Tagihan & Utilitas',
  'system:health': 'Kesehatan',
  'system:shopping': 'Belanja Online',
  'system:entertainment': 'Hiburan',
  'system:subscriptions': 'Langganan',
  'system:hobby': 'Hobi',
  'system:personal_care': 'Perawatan Diri',
  'system:gifts': 'Hadiah & Donasi',
  'system:bank_fee': 'Biaya bank',
  'system:platform_fee': 'Biaya platform',
  'system:monthly_admin': 'Admin bulanan',
  'system:tax_stamp': 'Pajak & meterai',
  'system:fx_difference': 'Selisih kurs',
  'system:salary': 'Gaji',
  'system:freelance': 'Freelance',
  'system:bonus': 'Bonus / THR',
  'system:dividend_interest': 'Dividen & bunga',
  'system:property_rent': 'Sewa properti',
  'system:royalty': 'Royalti & afiliasi',
  'system:sales': 'Penjualan barang',
  'system:reimbursement': 'Reimburse kantor',
  'system:cashback': 'Cashback & refund',
  'system:gift_received': 'Hadiah diterima',
};
