// SPDX-License-Identifier: AGPL-3.0-only
import type { RuleCondition, RuleConditionReason } from '@wf/domain/rules';
import { describe, expect, it } from 'vitest';
import { ACCOUNTS, BCA, CATEGORIES, categoryId } from '../../../test/ledger-fixtures.ts';
import {
  actionsSummary,
  conditionText,
  conditionsSummary,
  reasonText,
  ruleActionText,
  ruleCategoryName,
} from './rules-format.ts';

const lookup = { categories: CATEGORIES, accounts: ACCOUNTS, locale: 'id' as const };
const food = categoryId('system:food');
const transport = categoryId('system:transport');

describe('conditionText', () => {
  it('labels every field with its values', () => {
    expect(conditionText({ field: 'description', op: 'containsAny', values: ['gojek', 'krl'] }, lookup)).toBe(
      'Deskripsi berisi salah satu: gojek, krl',
    );
    expect(conditionText({ field: 'weekday', op: 'oneOf', values: [1, 4] }, lookup)).toBe('Hari: Senin, Kamis');
    expect(conditionText({ field: 'time', op: 'before', minute: 600 }, lookup)).toBe('Jam sebelum 10:00');
    expect(conditionText({ field: 'account', op: 'oneOf', values: [BCA.id] }, lookup)).toBe('Rekening: BCA Tahapan');
    expect(conditionText({ field: 'direction', op: 'oneOf', values: ['income', 'expense'] }, lookup)).toBe(
      'Arah: Pemasukan, Pengeluaran',
    );
    expect(conditionText({ field: 'subscription', op: 'isRegistered' }, lookup)).toBe('Langganan terdaftar');
  });

  it('names a deleted account instead of blank', () => {
    expect(
      conditionText(
        { field: 'account', op: 'oneOf', values: ['0192a6c4-0000-7000-8000-0000000000ff'] },
        { ...lookup, locale: 'en' },
      ),
    ).toBe('Rekening: rekening dihapus');
  });
});

describe('actions and categories', () => {
  it('shows category and tag actions and a neutral missing category', () => {
    expect(ruleActionText({ type: 'setCategory', categoryId: transport }, lookup)).toBe('Kategori: Transportasi');
    expect(ruleActionText({ type: 'addTag', tag: 'kantor' }, lookup)).toBe('Tag: #kantor');
    expect(ruleCategoryName(lookup, null)).toBe('Tanpa kategori');
    expect(ruleCategoryName(lookup, 'missing')).toBe('kategori dihapus');
    expect(
      actionsSummary(
        [
          { type: 'setCategory', categoryId: food },
          { type: 'addTag', tag: 'makan' },
        ],
        lookup,
      ),
    ).toBe('Kategori: Makan & Dapur · Tag: #makan');
    expect(conditionsSummary([{ field: 'time', op: 'before', minute: 540 }], lookup)).toBe('Jam sebelum 09:00');
  });
});

describe('reasonText', () => {
  const condition: RuleCondition = { field: 'description', op: 'containsAny', values: ['gojek', 'krl'] };
  it('adds the actual value to matching and non-matching reasons', () => {
    expect(
      reasonText(condition, { field: 'description', matched: true, values: ['gojek', 'krl'], hit: 'gojek' }, lookup),
    ).toBe('Cocok: Deskripsi berisi salah satu: gojek, krl (gojek)');
    expect(
      reasonText(condition, { field: 'description', matched: false, values: ['gojek', 'krl'], hit: null }, lookup),
    ).toBe('Tidak cocok: Deskripsi berisi salah satu: gojek, krl (tidak ada)');
  });

  it('explains every other field, including a date-only source and a deleted account', () => {
    const cases: [RuleCondition, RuleConditionReason][] = [
      [
        { field: 'weekday', op: 'oneOf', values: [7] },
        { field: 'weekday', matched: false, values: [7], actual: 4 },
      ],
      [
        { field: 'time', op: 'before', minute: 600 },
        { field: 'time', matched: false, before: 600, actual: null },
      ],
      [
        { field: 'account', op: 'oneOf', values: [BCA.id] },
        { field: 'account', matched: false, values: [BCA.id], actual: [] },
      ],
      [
        { field: 'account', op: 'oneOf', values: [BCA.id] },
        { field: 'account', matched: false, values: [BCA.id], actual: ['0192a6c4-0000-7000-8000-0000000000ff'] },
      ],
      [
        { field: 'direction', op: 'oneOf', values: ['income'] },
        { field: 'direction', matched: false, values: ['income'], actual: 'expense' },
      ],
      [
        { field: 'subscription', op: 'isRegistered' },
        { field: 'subscription', matched: true, actual: true },
      ],
      [
        { field: 'subscription', op: 'isRegistered' },
        { field: 'subscription', matched: false, actual: false },
      ],
    ];
    expect(cases.map(([subject, entry]) => reasonText(subject, entry, lookup))).toEqual([
      'Tidak cocok: Hari: Minggu (Kamis)',
      'Tidak cocok: Jam sebelum 10:00 (tanpa jam)',
      'Tidak cocok: Rekening: BCA Tahapan (tidak ada)',
      'Tidak cocok: Rekening: BCA Tahapan (rekening dihapus)',
      'Tidak cocok: Arah: Pemasukan (Pengeluaran)',
      'Cocok: Langganan terdaftar (langganan terdaftar)',
      'Tidak cocok: Langganan terdaftar (bukan langganan terdaftar)',
    ]);
  });

  it('shows a matched time and account', () => {
    expect(
      reasonText(
        { field: 'time', op: 'before', minute: 600 },
        { field: 'time', matched: true, before: 600, actual: 540 },
        lookup,
      ),
    ).toBe('Cocok: Jam sebelum 10:00 (09:00)');
    expect(
      reasonText(
        { field: 'account', op: 'oneOf', values: [BCA.id] },
        { field: 'account', matched: true, values: [BCA.id], actual: [BCA.id] },
        lookup,
      ),
    ).toBe('Cocok: Rekening: BCA Tahapan (BCA Tahapan)');
  });

  it('uses the English locale for weekday names', () => {
    expect(
      reasonText(
        { field: 'weekday', op: 'oneOf', values: [7] },
        { field: 'weekday', matched: false, values: [7], actual: 4 },
        { ...lookup, locale: 'en' },
      ),
    ).toBe('Tidak cocok: Hari: Sunday (Thursday)');
  });
});
