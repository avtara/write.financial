// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { parseLocalDate } from './period.ts';
import {
  applyRuleSuggestion,
  categoryFitsDirection,
  checkRuleDefinition,
  correctionPattern,
  evaluateRules,
  formatTimeOfDay,
  InvalidRuleError,
  parseTimeOfDay,
  ruleSuggestionKey,
  weekdayOf,
  type AutoRuleView,
  type AutoRuleDefinition,
  type RuleCondition,
  type RuleSubject,
  type RulesEvaluation,
} from './rules.ts';

const ACCOUNT = '0192a6c4-0000-7000-8000-000000000001';
const OTHER_ACCOUNT = '0192a6c4-0000-7000-8000-000000000002';
const FOOD = '0192a6c4-0000-7000-8000-000000000010';
const TRANSPORT = '0192a6c4-0000-7000-8000-000000000011';
const SALARY = '0192a6c4-0000-7000-8000-000000000012';
const COMMUTER = '0192a6c4-0000-7000-8000-000000000020';

const d = (date: string) => parseLocalDate(date);

function rule(overrides: Partial<AutoRuleView> = {}): AutoRuleView {
  return {
    id: crypto.randomUUID(),
    name: 'Berangkat ke kantor',
    enabled: true,
    position: 0,
    conditions: [{ field: 'description', op: 'containsAny', values: ['gojek', 'krl'] }],
    actions: [{ type: 'setCategory', categoryId: TRANSPORT }],
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

function subject(overrides: Partial<RuleSubject> = {}): RuleSubject {
  return {
    description: 'Gojek ke kantor',
    date: d('2026-10-15'),
    minuteOfDay: 8 * 60 + 30,
    accountIds: [ACCOUNT],
    direction: 'expense',
    subscription: false,
    ...overrides,
  };
}

const condition = (): RuleCondition => ({ field: 'description', op: 'containsAny', values: ['gojek'] });

describe('weekdayOf', () => {
  it('is the ISO weekday of the calendar date, independent of the host zone', () => {
    expect(weekdayOf(d('2026-10-15'))).toBe(4);
    expect(weekdayOf(d('2026-10-18'))).toBe(7);
    expect(weekdayOf(d('2026-10-19'))).toBe(1);
    expect(weekdayOf(d('1970-01-01'))).toBe(4);
    expect(weekdayOf(d('1969-12-31'))).toBe(3);
  });
});

describe('time of day', () => {
  it('parses and formats round trips and rejects invalid times', () => {
    expect(parseTimeOfDay('00:00')).toBe(0);
    expect(parseTimeOfDay('10:00')).toBe(600);
    expect(parseTimeOfDay('23:59')).toBe(1439);
    expect(formatTimeOfDay(600)).toBe('10:00');
    expect(formatTimeOfDay(0)).toBe('00:00');
    expect(() => parseTimeOfDay('24:00')).toThrow(RangeError);
    expect(() => parseTimeOfDay('9:00')).toThrow(RangeError);
    expect(() => formatTimeOfDay(1440)).toThrow(RangeError);
    expect(() => formatTimeOfDay(1.5)).toThrow(RangeError);
  });
});

describe('checkRuleDefinition', () => {
  it('normalizes names, values, weekdays, tags, and duplicate actions', () => {
    const checked = checkRuleDefinition({
      name: '  Berangkat   ke kantor ',
      enabled: true,
      conditions: [
        { field: 'description', op: 'containsAny', values: ['  Gojek ', 'KRL', 'gojek'] },
        { field: 'weekday', op: 'oneOf', values: [5, 1, 5] },
        { field: 'time', op: 'before', minute: 600 },
        { field: 'subscription', op: 'isRegistered' },
      ],
      actions: [
        { type: 'setCategory', categoryId: TRANSPORT },
        { type: 'addTag', tag: '#Kantor' },
        { type: 'addTag', tag: 'kantor' },
      ],
    });
    expect(checked).toEqual({
      name: 'Berangkat ke kantor',
      enabled: true,
      conditions: [
        { field: 'description', op: 'containsAny', values: ['Gojek', 'KRL'] },
        { field: 'weekday', op: 'oneOf', values: [1, 5] },
        { field: 'time', op: 'before', minute: 600 },
        { field: 'subscription', op: 'isRegistered' },
      ],
      actions: [
        { type: 'setCategory', categoryId: TRANSPORT },
        { type: 'addTag', tag: 'kantor' },
      ],
    });
  });

  it('refuses empty, oversized, repeated, or malformed rules by field', () => {
    const reason = (overrides: Partial<AutoRuleDefinition>) => {
      try {
        checkRuleDefinition({
          name: 'Kantor',
          enabled: true,
          conditions: [condition()],
          actions: [{ type: 'addTag', tag: 'kantor' }],
          ...overrides,
        });
        return null;
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidRuleError);
        return (error as InvalidRuleError).field;
      }
    };
    expect(reason({ name: '   ' })).toBe('name');
    expect(reason({ name: 'x'.repeat(61) })).toBe('name');
    expect(reason({ conditions: [] })).toBe('conditions');
    expect(reason({ conditions: [condition(), condition()] })).toBe('conditions');
    expect(reason({ actions: [] })).toBe('actions');
    expect(
      reason({
        actions: [
          { type: 'setCategory', categoryId: FOOD },
          { type: 'setCategory', categoryId: FOOD },
        ],
      }),
    ).toBe('actions');
    expect(
      reason({
        actions: ['a', 'b', 'c', 'd', 'e', 'f'].map((tag) => ({ type: 'addTag' as const, tag })),
      }),
    ).toBe('actions');
    expect(reason({ conditions: [{ field: 'description', op: 'containsAny', values: [' '] }] })).toBe('description');
    expect(reason({ conditions: [{ field: 'weekday', op: 'oneOf', values: [0 as never] }] })).toBe('weekday');
    expect(reason({ conditions: [{ field: 'time', op: 'before', minute: 1440 }] })).toBe('time');
    expect(reason({ conditions: [{ field: 'account', op: 'oneOf', values: ['not-an-id'] }] })).toBe('account');
    expect(reason({ conditions: [{ field: 'direction', op: 'oneOf', values: ['transfer' as never] }] })).toBe(
      'direction',
    );
    expect(reason({ actions: [{ type: 'addTag', tag: '#' }] })).toBe('tag');
    expect(reason({ actions: [{ type: 'setCategory', categoryId: 'nope' }] })).toBe('categoryId');
    expect(reason({ conditions: [{ field: 'description', op: 'containsAny', values: ['x'.repeat(41)] }] })).toBe(
      'description',
    );
    expect(
      reason({
        conditions: [
          {
            field: 'account',
            op: 'oneOf',
            values: Array.from(
              { length: 11 },
              (_, index) => `0192a6c4-0000-7000-8000-${String(index + 1).padStart(12, '0')}`,
            ),
          },
        ],
      }),
    ).toBe('account');
  });
});

describe('evaluateRules', () => {
  it('applies the topmost category and unions every matching rule’s tags', () => {
    const first = rule({
      position: 0,
      name: 'Transport',
      conditions: [{ field: 'description', op: 'containsAny', values: ['gojek'] }],
      actions: [
        { type: 'setCategory', categoryId: TRANSPORT },
        { type: 'addTag', tag: 'transport' },
      ],
    });
    const second = rule({
      position: 1,
      name: 'Pagi',
      conditions: [{ field: 'time', op: 'before', minute: 600 }],
      actions: [
        { type: 'setCategory', categoryId: FOOD },
        { type: 'addTag', tag: 'pagi' },
      ],
    });
    const third = rule({
      position: 2,
      name: 'Kantor',
      conditions: [{ field: 'account', op: 'oneOf', values: [ACCOUNT] }],
      actions: [{ type: 'addTag', tag: 'kantor' }],
    });
    const result = evaluateRules([third, second, first], subject());
    expect(result.categoryId).toBe(TRANSPORT);
    expect(result.winningRule).toEqual({ id: first.id, name: 'Transport' });
    expect(result.tags).toEqual(['transport', 'pagi', 'kantor']);
    expect(result.tagOverflow).toBe(false);
    expect(result.rules.map((match) => [match.name, match.matched])).toEqual([
      ['Transport', true],
      ['Pagi', true],
      ['Kantor', true],
    ]);
  });

  it('orders equal positions by their persisted order', () => {
    const first = rule({ position: 0, name: 'First', actions: [{ type: 'setCategory', categoryId: FOOD }] });
    const second = rule({ position: 0, name: 'Second', actions: [{ type: 'setCategory', categoryId: TRANSPORT }] });
    expect(evaluateRules([first, second], subject()).categoryId).toBe(FOOD);
    expect(evaluateRules([first, second], subject()).rules.map((match) => match.name)).toEqual(['First', 'Second']);
  });

  it('keeps the earlier rule’s category when a later rule also sets one', () => {
    const first = rule({ position: 0, actions: [{ type: 'setCategory', categoryId: TRANSPORT }] });
    const second = rule({
      position: 1,
      conditions: [{ field: 'weekday', op: 'oneOf', values: [4] }],
      actions: [{ type: 'setCategory', categoryId: FOOD }],
    });
    expect(evaluateRules([first, second], subject()).categoryId).toBe(TRANSPORT);
  });

  it('ANDs conditions and reports every reason, including the misses', () => {
    const candidate = rule({
      conditions: [
        { field: 'description', op: 'containsAny', values: ['gojek', 'krl'] },
        { field: 'weekday', op: 'oneOf', values: [1] },
        { field: 'time', op: 'before', minute: 600 },
        { field: 'account', op: 'oneOf', values: [OTHER_ACCOUNT] },
        { field: 'direction', op: 'oneOf', values: ['income'] },
        { field: 'subscription', op: 'isRegistered' },
      ],
    });
    const [match] = evaluateRules([candidate], subject()).rules;
    expect(match?.matched).toBe(false);
    expect(match?.reasons).toEqual([
      { field: 'description', matched: true, values: ['gojek', 'krl'], hit: 'gojek' },
      { field: 'weekday', matched: false, values: [1], actual: 4 },
      { field: 'time', matched: true, before: 600, actual: 510 },
      { field: 'account', matched: false, values: [OTHER_ACCOUNT], actual: [ACCOUNT] },
      { field: 'direction', matched: false, values: ['income'], actual: 'expense' },
      { field: 'subscription', matched: false, actual: false },
    ]);
  });

  it('uses the local time and weekday boundaries exactly (before 10:00 excludes 10:00)', () => {
    const morning = rule({ conditions: [{ field: 'time', op: 'before', minute: 600 }] });
    expect(evaluateRules([morning], subject({ minuteOfDay: 599 })).rules[0]?.matched).toBe(true);
    expect(evaluateRules([morning], subject({ minuteOfDay: 600 })).rules[0]?.matched).toBe(false);
    expect(evaluateRules([morning], subject({ minuteOfDay: null })).rules[0]?.matched).toBe(false);
    expect(evaluateRules([morning], subject({ minuteOfDay: null })).rules[0]?.reasons).toEqual([
      { field: 'time', matched: false, before: 600, actual: null },
    ]);
    const sunday = rule({ conditions: [{ field: 'weekday', op: 'oneOf', values: [7] }] });
    expect(evaluateRules([sunday], subject({ date: d('2026-10-18') })).rules[0]?.matched).toBe(true);
    expect(evaluateRules([sunday], subject({ date: d('2026-10-19') })).rules[0]?.matched).toBe(false);
  });

  it('ignores disabled rules, matches subscriptions only when marked, and matches a description case-insensitively', () => {
    const disabled = rule({ enabled: false, actions: [{ type: 'setCategory', categoryId: FOOD }] });
    expect(evaluateRules([disabled], subject())).toEqual({
      categoryId: null,
      winningRule: null,
      tags: [],
      tagOverflow: false,
      rules: [],
    });
    const subscription = rule({ conditions: [{ field: 'subscription', op: 'isRegistered' }] });
    expect(evaluateRules([subscription], subject()).rules[0]?.matched).toBe(false);
    expect(evaluateRules([subscription], subject({ subscription: true })).rules[0]?.matched).toBe(true);
    const mixed = rule({ conditions: [{ field: 'description', op: 'containsAny', values: ['KOPI KENANGAN'] }] });
    expect(evaluateRules([mixed], subject({ description: 'kopi kenangan senayan' })).rules[0]?.matched).toBe(true);
    expect(evaluateRules([mixed], subject({ description: null })).rules[0]?.reasons).toEqual([
      { field: 'description', matched: false, values: ['KOPI KENANGAN'], hit: null },
    ]);
  });

  it('flags more than five tags instead of truncating them', () => {
    const rules = ['a', 'b', 'c', 'd', 'e', 'f'].map((tag, position) =>
      rule({ position, actions: [{ type: 'addTag', tag }] }),
    );
    const result = evaluateRules(rules, subject());
    expect(result.tags).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(result.tagOverflow).toBe(true);
  });

  it('matches a transfer on either account', () => {
    const candidate = rule({ conditions: [{ field: 'account', op: 'oneOf', values: [OTHER_ACCOUNT] }] });
    expect(evaluateRules([candidate], subject({ accountIds: [ACCOUNT, OTHER_ACCOUNT] })).rules[0]?.matched).toBe(true);
  });
});

describe('applyRuleSuggestion', () => {
  const categories = [
    { id: FOOD, kind: 'expense' as const, archived: false },
    { id: SALARY, kind: 'income' as const, archived: false },
    { id: COMMUTER, kind: 'expense' as const, archived: true },
  ];
  const evaluation = (overrides: Partial<RulesEvaluation> = {}): RulesEvaluation => ({
    categoryId: FOOD,
    winningRule: { id: 'rule', name: 'Kopi' },
    tags: ['kopi'],
    tagOverflow: false,
    rules: [],
    ...overrides,
  });

  it('fills an empty category and unions tags, never replacing the user’s own', () => {
    expect(
      applyRuleSuggestion({ categoryId: null, tags: ['kantor'] }, evaluation(), { categories, direction: 'expense' }),
    ).toEqual({ categoryId: FOOD, tags: ['kantor', 'kopi'], conflicts: [] });
    expect(
      applyRuleSuggestion({ categoryId: TRANSPORT, tags: [] }, evaluation(), { categories, direction: 'expense' }),
    ).toEqual({ categoryId: TRANSPORT, tags: ['kopi'], conflicts: [] });
  });

  it('refuses an archived, missing, or wrong-direction category', () => {
    for (const categoryId of [COMMUTER, 'missing', SALARY]) {
      expect(
        applyRuleSuggestion({ categoryId: null, tags: [] }, evaluation({ categoryId }), {
          categories,
          direction: 'expense',
        }),
      ).toEqual({ categoryId: null, tags: ['kopi'], conflicts: ['category_unavailable'] });
    }
    expect(
      applyRuleSuggestion({ categoryId: null, tags: [] }, evaluation({ categoryId: SALARY }), {
        categories,
        direction: 'income',
      }).categoryId,
    ).toBe(SALARY);
  });

  it('adds no tags at all when the union exceeds five', () => {
    expect(
      applyRuleSuggestion({ categoryId: null, tags: ['a', 'b', 'c', 'd'] }, evaluation({ tags: ['e', 'f'] }), {
        categories,
        direction: 'expense',
      }),
    ).toEqual({ categoryId: FOOD, tags: ['a', 'b', 'c', 'd'], conflicts: ['tag_limit'] });
  });
});

describe('categoryFitsDirection', () => {
  it('fits expense and fee categories to expenses, income to income', () => {
    expect(categoryFitsDirection('expense', 'expense')).toBe(true);
    expect(categoryFitsDirection('fee', 'expense')).toBe(true);
    expect(categoryFitsDirection('income', 'expense')).toBe(false);
    expect(categoryFitsDirection('income', 'income')).toBe(true);
    expect(categoryFitsDirection('expense', 'income')).toBe(false);
  });
});

describe('correctionPattern', () => {
  it('prefers the merchant and strips trailing amounts and references', () => {
    expect(correctionPattern('Kopi Kenangan 25.000', null)).toEqual({
      pattern: 'kopi kenangan',
      label: 'Kopi Kenangan',
    });
    expect(correctionPattern('ignored', 'Kopi Kenangan')).toEqual({
      pattern: 'kopi kenangan',
      label: 'Kopi Kenangan',
    });
    expect(correctionPattern('GOJEK  ref: ABC123', null)).toEqual({ pattern: 'gojek', label: 'GOJEK' });
    expect(correctionPattern('  transfer   ke   bibit ', null)).toEqual({
      pattern: 'transfer ke bibit',
      label: 'transfer ke bibit',
    });
  });

  it('refuses descriptions without letters or a usable phrase', () => {
    expect(correctionPattern(null, null)).toBeNull();
    expect(correctionPattern('   ', null)).toBeNull();
    expect(correctionPattern('25.000', null)).toBeNull();
    expect(correctionPattern('ab', null)).toBeNull();
    expect(correctionPattern('---', null)).toBeNull();
  });

  it('caps the label and keeps a stable suggestion key', () => {
    const long = correctionPattern('Kopi '.repeat(20), null);
    expect(long?.label.length).toBeLessThanOrEqual(60);
    expect(ruleSuggestionKey('kopi kenangan', FOOD, TRANSPORT)).toBe('kopi kenangan|' + FOOD + '|' + TRANSPORT);
  });
});
