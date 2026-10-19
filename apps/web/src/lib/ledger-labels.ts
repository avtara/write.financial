// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Display names shared by every ledger screen (plan §7 i18n): built-in categories are stored as keys
 * (`system:food`) and rendered per locale, user categories keep the name they were typed with; category groups and
 * account types are labelled from the message catalog.
 */
import type { BuiltInCategoryKey, CategoryGroup } from '@wf/domain/categories';
import type { AccountType } from '@wf/domain/ledger';
import { m } from '@wf/i18n/messages';

const BUILT_IN_NAMES: Readonly<Record<BuiltInCategoryKey, () => string>> = {
  'system:rent': m.category_builtin_rent,
  'system:food': m.category_builtin_food,
  'system:transport': m.category_builtin_transport,
  'system:bills': m.category_builtin_bills,
  'system:health': m.category_builtin_health,
  'system:shopping': m.category_builtin_shopping,
  'system:entertainment': m.category_builtin_entertainment,
  'system:subscriptions': m.category_builtin_subscriptions,
  'system:hobby': m.category_builtin_hobby,
  'system:personal_care': m.category_builtin_personal_care,
  'system:gifts': m.category_builtin_gifts,
  'system:bank_fee': m.category_builtin_bank_fee,
  'system:platform_fee': m.category_builtin_platform_fee,
  'system:monthly_admin': m.category_builtin_monthly_admin,
  'system:tax_stamp': m.category_builtin_tax_stamp,
  'system:fx_difference': m.category_builtin_fx_difference,
  'system:salary': m.category_builtin_salary,
  'system:freelance': m.category_builtin_freelance,
  'system:bonus': m.category_builtin_bonus,
  'system:dividend_interest': m.category_builtin_dividend_interest,
  'system:property_rent': m.category_builtin_property_rent,
  'system:royalty': m.category_builtin_royalty,
  'system:sales': m.category_builtin_sales,
  'system:reimbursement': m.category_builtin_reimbursement,
  'system:cashback': m.category_builtin_cashback,
  'system:gift_received': m.category_builtin_gift_received,
};

const GROUP_LABELS: Readonly<Record<CategoryGroup, () => string>> = {
  needs: m.category_group_needs,
  wants: m.category_group_wants,
  financial: m.category_group_financial,
  active: m.category_group_active,
  passive: m.category_group_passive,
  other: m.category_group_other,
};

const ACCOUNT_TYPE_LABELS: Readonly<Record<AccountType, () => string>> = {
  bank: m.account_type_bank,
  ewallet: m.account_type_ewallet,
  cash: m.account_type_cash,
  investment: m.account_type_investment,
  credit_card: m.account_type_credit_card,
};

/**
 * The name to show for a category (`CategoryView` from `@wf/db/categories`): the localized built-in name, or the
 * user's own. A built-in key this release does not know (from a newer database) falls back to the stored name.
 */
export function categoryName(category: { readonly name: string; readonly builtInKey: string | null }): string {
  const label = category.builtInKey === null ? undefined : BUILT_IN_NAMES[category.builtInKey as BuiltInCategoryKey];
  return label === undefined ? category.name : label();
}

export function categoryGroupLabel(group: CategoryGroup): string {
  return GROUP_LABELS[group]();
}

export function accountTypeLabel(type: AccountType): string {
  return ACCOUNT_TYPE_LABELS[type]();
}
