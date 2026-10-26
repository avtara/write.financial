// SPDX-License-Identifier: AGPL-3.0-only
import type { AssistantAnswer, AssistantCard, AssistantDraft } from '@wf/domain/assistant';
import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_MAX_TURNS,
  assistantText,
  draftPrefill,
  historyOf,
  nextTurns,
  sourceLinks,
  type AssistantTurn,
} from './assistant-model.ts';

const localDate = (value: string) => value as never;
const answer = (text: string): AssistantAnswer => ({
  text,
  cards: [],
  draft: null,
  provider: 'openrouter',
  modelId: 'fixture/model',
  toolCalls: [],
  usage: { month: '2026-10', requests: 1, spentUsd: '0.1', estimatedUsd: '0', reservedUsd: '0', limitUsd: '5' },
});
const turn = (id: string, question: string, text: string | null): AssistantTurn => ({
  id,
  question,
  answer: text === null ? null : answer(text),
  errorCode: null,
  pending: false,
});

describe('assistant conversation', () => {
  it('keeps only the device window and sends answered turns in order', () => {
    let turns: readonly AssistantTurn[] = [];
    for (let index = 0; index < ASSISTANT_MAX_TURNS + 2; index++)
      turns = nextTurns(turns, turn(`t${index}`, `q${index}`, `a${index}`));
    expect(turns).toHaveLength(ASSISTANT_MAX_TURNS);
    expect(turns[0]?.question).toBe('q2');
    const history = historyOf(turns);
    expect(history).toHaveLength(ASSISTANT_MAX_TURNS * 2);
    expect(history[0]).toEqual({ role: 'user', content: 'q2' });
    expect(history[1]).toEqual({ role: 'assistant', content: 'a2' });
  });

  it('does not send a failed or empty answer as context', () => {
    expect(historyOf([turn('t1', 'q1', null), turn('t2', 'q2', '   ')])).toEqual([]);
  });

  it('masks amounts only while privacy mode is on', () => {
    expect(assistantText('Sisa Rp300.000 dari Rp3.500.000 (91%)', false)).toBe('Sisa Rp300.000 dari Rp3.500.000 (91%)');
    expect(assistantText('Sisa Rp300.000 dari Rp3.500.000 (91%)', true)).toBe('Sisa Rp•••••• dari Rp•••••• (91%)');
  });

  it('offers one chip per source page, without duplicate ranges', () => {
    const cards: AssistantCard[] = [
      {
        kind: 'budget',
        from: localDate('2026-10-01'),
        to: localDate('2026-10-31'),
        currency: 'IDR',
        lines: [],
        unbudgetedSpentMinor: 0n,
      },
      {
        kind: 'spending',
        from: localDate('2026-10-01'),
        to: localDate('2026-10-15'),
        currency: 'IDR',
        totalMinor: 0n,
        categories: [],
      },
      {
        kind: 'transactions',
        from: localDate('2026-10-01'),
        to: localDate('2026-10-15'),
        currency: 'IDR',
        items: [],
      },
      { kind: 'accounts', currency: 'IDR', items: [] },
    ];
    expect(sourceLinks(cards)).toEqual([
      { kind: 'budget', from: '2026-10-01', to: '2026-10-31', categoryId: null },
      { kind: 'transactions', from: '2026-10-01', to: '2026-10-15', categoryId: null },
      { kind: 'accounts', from: null, to: null, categoryId: null },
    ]);
    expect(sourceLinks([])).toEqual([]);
  });

  it('turns a draft into the Record form values for "Ubah"', () => {
    const draft: AssistantDraft = {
      type: 'expense',
      description: 'Makan siang',
      amountMinor: 45_000n,
      currency: 'IDR',
      accountId: 'a1',
      accountName: 'GoPay',
      categoryId: 'c1',
      categoryName: 'Makan & Dapur',
      categoryBuiltInKey: 'system:food',
      occurredAt: new Date('2026-10-15T05:10:00Z'),
      tags: [],
      budget: null,
      balance: null,
      duplicate: null,
    };
    expect(draftPrefill(draft, 'Asia/Jakarta')).toEqual({
      type: 'expense',
      description: 'Makan siang',
      date: '2026-10-15',
      time: '12:10',
      accountId: 'a1',
      amountMinor: 45_000n,
      categoryId: 'c1',
    });
    expect(draftPrefill({ ...draft, categoryId: null }, 'Asia/Jakarta')).not.toHaveProperty('categoryId');
  });
});
