// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  BAD_DEBT_CATEGORY,
  BUILT_IN_CATEGORIES,
  BUILT_IN_NAMES_ID,
  BUILT_IN_PREFIX,
  CATEGORY_GROUPS,
  CATEGORY_KINDS,
  CATEGORY_NAME_MAX,
  FX_DIFFERENCE_CATEGORY,
  GROUPS_BY_KIND,
} from './categories.ts';

const keys = BUILT_IN_CATEGORIES.map((category) => category.key);

describe('category kinds and groups', () => {
  it('assigns every group to exactly one kind', () => {
    const assigned = CATEGORY_KINDS.flatMap((kind) => GROUPS_BY_KIND[kind]);
    expect([...assigned].sort()).toEqual([...CATEGORY_GROUPS].sort());
  });
});

describe('BUILT_IN_CATEGORIES (FR-K1)', () => {
  it('has unique, prefixed keys within the name limit', () => {
    expect(BUILT_IN_PREFIX).toBe('system:');
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key.startsWith(BUILT_IN_PREFIX)).toBe(true);
      expect(key.length).toBeLessThanOrEqual(CATEGORY_NAME_MAX);
    }
  });

  it('puts every category in a group valid for its kind', () => {
    for (const category of BUILT_IN_CATEGORIES) {
      expect(GROUPS_BY_KIND[category.kind]).toContain(category.group);
    }
  });

  it('marks exactly the six "Biaya keuangan" categories as system categories', () => {
    const system = BUILT_IN_CATEGORIES.filter((category) => category.isSystem);
    expect(system.map((category) => category.key)).toEqual([
      'system:bank_fee',
      'system:platform_fee',
      'system:monthly_admin',
      'system:tax_stamp',
      'system:fx_difference',
      'system:bad_debt',
    ]);
    expect(BUILT_IN_CATEGORIES.filter((category) => category.kind === 'fee')).toEqual(system);
  });

  it('marks rent, bills and subscriptions as fixed costs', () => {
    expect(BUILT_IN_CATEGORIES.filter((category) => category.isFixed).map((category) => category.key)).toEqual([
      'system:rent',
      'system:bills',
      'system:subscriptions',
    ]);
  });

  it('uses kebab-case lucide icon names', () => {
    for (const category of BUILT_IN_CATEGORIES) expect(category.icon).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it('golden: catalog per group in display order', () => {
    const byGroup = Object.fromEntries(
      CATEGORY_GROUPS.map((group) => [
        group,
        BUILT_IN_CATEGORIES.filter((category) => category.group === group).map(
          (category) => BUILT_IN_NAMES_ID[category.key],
        ),
      ]),
    );
    expect(byGroup).toEqual({
      needs: ['Sewa Kos', 'Makan & Dapur', 'Transportasi', 'Tagihan & Utilitas', 'Kesehatan'],
      wants: ['Belanja Online', 'Hiburan', 'Langganan', 'Hobi', 'Perawatan Diri', 'Hadiah & Donasi'],
      financial: [
        'Biaya bank',
        'Biaya platform',
        'Admin bulanan',
        'Pajak & meterai',
        'Selisih kurs',
        'Piutang tak tertagih',
      ],
      active: ['Gaji', 'Freelance', 'Bonus / THR'],
      passive: ['Dividen & bunga', 'Sewa properti', 'Royalti & afiliasi'],
      other: ['Penjualan barang', 'Reimburse kantor', 'Cashback & refund', 'Hadiah diterima'],
    });
  });

  it('names every built-in category within the name limit', () => {
    expect(Object.keys(BUILT_IN_NAMES_ID)).toEqual(keys);
    for (const name of Object.values(BUILT_IN_NAMES_ID)) expect(name.length).toBeLessThanOrEqual(CATEGORY_NAME_MAX);
  });

  it('contains the FX difference category as a system fee', () => {
    expect(FX_DIFFERENCE_CATEGORY).toBe('system:fx_difference');
    expect(BUILT_IN_CATEGORIES.find((category) => category.key === FX_DIFFERENCE_CATEGORY)).toMatchObject({
      kind: 'fee',
      isSystem: true,
    });
  });

  it('contains the bad debt category of receivable write-offs as a system fee (FR-U7)', () => {
    expect(BAD_DEBT_CATEGORY).toBe('system:bad_debt');
    expect(BUILT_IN_CATEGORIES.find((category) => category.key === BAD_DEBT_CATEGORY)).toMatchObject({
      kind: 'fee',
      group: 'financial',
      isSystem: true,
    });
  });
});
