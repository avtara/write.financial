// SPDX-License-Identifier: AGPL-3.0-only
import { BUILT_IN_CATEGORIES, BUILT_IN_NAMES_ID, CATEGORY_GROUPS } from '@wf/domain/categories';
import { ACCOUNT_TYPES } from '@wf/domain/ledger';
import { setLocale } from '@wf/i18n/runtime';
import { describe, expect, it } from 'vitest';
import { accountTypeLabel, categoryGroupLabel, categoryName, categoryNameIn } from './ledger-labels.ts';

describe('categoryName', () => {
  it('renders every built-in category in Indonesian exactly as the seed names them', async () => {
    await setLocale('id', { reload: false });
    for (const { key } of BUILT_IN_CATEGORIES) {
      expect(categoryName({ name: key, builtInKey: key })).toBe(BUILT_IN_NAMES_ID[key]);
    }
  });

  it('translates built-in categories to English', async () => {
    await setLocale('en', { reload: false });
    expect(categoryName({ name: 'system:fx_difference', builtInKey: 'system:fx_difference' })).toBe('FX difference');
    expect(categoryName({ name: 'system:food', builtInKey: 'system:food' })).toBe('Food & groceries');
  });

  it("keeps a user's own name as typed, in any locale", async () => {
    await setLocale('en', { reload: false });
    expect(categoryName({ name: 'Kopi pagi', builtInKey: null })).toBe('Kopi pagi');
  });

  it('falls back to the stored name for a built-in key this release does not know', () => {
    expect(categoryName({ name: 'system:future', builtInKey: 'system:future' })).toBe('system:future');
  });
});

describe('categoryNameIn', () => {
  it('names built-ins in the requested locale regardless of the runtime locale', async () => {
    await setLocale('id', { reload: false });
    expect(categoryNameIn({ name: 'system:food', builtInKey: 'system:food' }, 'en')).toBe('Food & groceries');
    await setLocale('en', { reload: false });
    expect(categoryNameIn({ name: 'system:food', builtInKey: 'system:food' }, 'id')).toBe(
      BUILT_IN_NAMES_ID['system:food'],
    );
  });

  it("keeps a user's own name and the stored name of an unknown built-in key", () => {
    expect(categoryNameIn({ name: 'Kopi pagi', builtInKey: null }, 'en')).toBe('Kopi pagi');
    expect(categoryNameIn({ name: 'system:future', builtInKey: 'system:future' }, 'id')).toBe('system:future');
  });
});

describe('categoryGroupLabel and accountTypeLabel', () => {
  it('label every group and account type in both locales', async () => {
    await setLocale('id', { reload: false });
    expect(CATEGORY_GROUPS.map(categoryGroupLabel)).toEqual([
      'Kebutuhan',
      'Keinginan',
      'Biaya keuangan',
      'Aktif',
      'Pasif',
      'Lainnya',
    ]);
    expect(ACCOUNT_TYPES.map(accountTypeLabel)).toEqual(['Bank', 'E-Wallet', 'Tunai', 'Investasi', 'Kartu kredit']);
    await setLocale('en', { reload: false });
    expect(categoryGroupLabel('financial')).toBe('Financial costs');
    expect(accountTypeLabel('credit_card')).toBe('Credit card');
  });
});
