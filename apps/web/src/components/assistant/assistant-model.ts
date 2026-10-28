// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-AI3 assistant, device side: the in-memory conversation (never persisted), the history window sent with the next
 * question, the source chips behind an answer, and the prefill that turns a draft into the Record Transaction form.
 */
import {
  ASSISTANT_HISTORY_MAX,
  maskAssistantAmounts,
  type AssistantAnswer,
  type AssistantCard,
  type AssistantDraft,
} from '@wf/domain/assistant';
import type { LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { formatTime, toLocalDate } from '@wf/ui/dates';
import type { RecordPrefill } from '../ledger/record-transaction.tsx';

/** One question on the device: waiting for its answer, refused (a `Result` code such as `AI_TIMEOUT`), or answered. */
export type AssistantTurn = { readonly id: string; readonly question: string } & (
  | { readonly status: 'pending' }
  | { readonly status: 'failed'; readonly errorCode: string }
  | { readonly status: 'answered'; readonly answer: AssistantAnswer }
);

/** Questions kept on screen; the provider also sees at most {@link ASSISTANT_HISTORY_MAX} messages. */
export const ASSISTANT_MAX_TURNS = ASSISTANT_HISTORY_MAX / 2;

/** Appends `turn` and drops the oldest, so the device never grows an unbounded transcript. */
export function nextTurns(turns: readonly AssistantTurn[], turn: AssistantTurn): readonly AssistantTurn[] {
  return [...turns, turn].slice(-ASSISTANT_MAX_TURNS);
}

/** What the next question carries: the answered turns, oldest first, as provider messages. */
export function historyOf(
  turns: readonly AssistantTurn[],
): readonly { readonly role: 'user' | 'assistant'; readonly content: string }[] {
  return turns
    .flatMap((turn) => {
      if (turn.status !== 'answered' || turn.answer.text.trim() === '') return [];
      return [
        { role: 'user' as const, content: turn.question },
        { role: 'assistant' as const, content: turn.answer.text },
      ];
    })
    .slice(-ASSISTANT_HISTORY_MAX);
}

/** Privacy mode masks amounts inside the model's prose; percentages and dates stay readable. */
export function assistantText(text: string, hidden: boolean): string {
  return hidden ? maskAssistantAmounts(text) : text;
}

/** A chip that opens the page holding the same numbers as a card. */
export type AssistantSource =
  | {
      readonly kind: 'budget' | 'transactions';
      readonly from: LocalDate;
      readonly to: LocalDate;
    }
  | {
      readonly kind: 'accounts';
      readonly from: null;
      readonly to: null;
    };

/** One chip per card kind and date range. */
export function sourceLinks(cards: readonly AssistantCard[]): readonly AssistantSource[] {
  const links: AssistantSource[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    const link: AssistantSource =
      card.kind === 'budget'
        ? { kind: 'budget', from: card.from, to: card.to }
        : card.kind === 'spending'
          ? { kind: 'transactions', from: card.from, to: card.to }
          : card.kind === 'transactions'
            ? { kind: 'transactions', from: card.from, to: card.to }
            : { kind: 'accounts', from: null, to: null };
    const key = `${link.kind}:${link.from ?? ''}:${link.to ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(link);
  }
  return links;
}

/** The Record Transaction values of an unsaved draft ("Ubah"). */
export function draftPrefill(draft: AssistantDraft, timeZone: string): RecordPrefill {
  return {
    type: draft.type,
    description: draft.description,
    date: toLocalDate(draft.occurredAt, timeZone),
    time: new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(draft.occurredAt),
    accountId: draft.accountId,
    amountMinor: draft.amountMinor,
    ...(draft.categoryId === null ? {} : { categoryId: draft.categoryId }),
  };
}

/** `Kam, 15 Okt · 12.10` (id) / `Thu, Oct 15 · 12.10` (en), in the viewer's zone. */
export function draftTimeLabel(occurredAt: Date, timeZone: string, locale: Locale): string {
  const day = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(occurredAt);
  return `${day} · ${formatTime(occurredAt, timeZone, locale)}`;
}

/** `1–31 Okt 2026` (id) / `Oct 1–31, 2026` (en). */
export function rangeLabel(from: LocalDate, to: LocalDate, locale: Locale): string {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatRange(start, end);
}
