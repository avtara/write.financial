// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-AI3 evidence and proposal: the data cards an answer is built from (each one links to the page holding the same
 * numbers), and the draft card with its impact, which stays a proposal until the user saves it.
 */
import { Link } from '@tanstack/react-router';
import type { AssistantCard, AssistantDraft } from '@wf/domain/assistant';
import { formatPercent } from '@wf/i18n/format';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { useMemo } from 'react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { Button } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { RichMessage } from '../rich-message.tsx';
import { draftTimeLabel, rangeLabel, sourceLinks } from './assistant-model.ts';

const CARD = 'flex flex-col gap-2 rounded-[9px] border border-border bg-surface px-3 py-2.5';
const ROW = 'flex items-baseline justify-between gap-3 text-[12.5px]';
const SUBTLE = 'text-[11.5px] text-subtle';

/** One answer's cards; every number is already in the viewer's base currency. */
export function AssistantCards({ cards }: { readonly cards: readonly AssistantCard[] }) {
  const { locale } = usePreferences().preferences;
  if (cards.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {cards.map((card, index) => {
        if (card.kind === 'budget') {
          const lines = [...card.lines].sort((left, right) => (right.usedBps ?? 0) - (left.usedBps ?? 0)).slice(0, 5);
          return (
            <section key={`budget-${String(index)}`} className={CARD} aria-label={m.assistant_card_budget()}>
              <div className="flex items-baseline justify-between gap-3">
                <h4 className="text-[12.5px] font-medium text-fg">{m.assistant_card_budget()}</h4>
                <span className={SUBTLE}>{rangeLabel(card.from, card.to, locale)}</span>
              </div>
              {lines.map((line) => (
                <div key={line.categoryId} className={ROW}>
                  <span className="min-w-0 truncate text-muted-fg">
                    {categoryName({ name: line.name, builtInKey: line.builtInKey })}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <Money minor={line.spentMinor} currency={card.currency} context="table" locale={locale} />
                    <span className="w-[74px] text-right tabular-nums text-subtle">
                      {line.usedBps === null ? '—' : formatPercent(line.usedBps / 10_000, locale, {})}
                    </span>
                  </span>
                </div>
              ))}
            </section>
          );
        }
        if (card.kind === 'spending') {
          const categories = [...card.categories].sort((left, right) => (right.totalMinor > left.totalMinor ? 1 : -1));
          return (
            <section key={`spending-${String(index)}`} className={CARD} aria-label={m.assistant_card_spending()}>
              <div className="flex items-baseline justify-between gap-3">
                <h4 className="text-[12.5px] font-medium text-fg">{m.assistant_card_spending()}</h4>
                <span className={SUBTLE}>{rangeLabel(card.from, card.to, locale)}</span>
              </div>
              <div className={ROW}>
                <span className="text-muted-fg">{m.ai_feature_chat()}</span>
                <Money minor={card.totalMinor} currency={card.currency} context="table" locale={locale} />
              </div>
              {categories.slice(0, 5).map((entry) => (
                <div key={entry.categoryId ?? 'uncategorized'} className={ROW}>
                  <span className="min-w-0 truncate text-muted-fg">
                    {entry.name === null
                      ? m.transactions_table_uncategorized()
                      : categoryName({ name: entry.name, builtInKey: entry.builtInKey })}
                  </span>
                  <Money minor={entry.totalMinor} currency={card.currency} context="table" locale={locale} />
                </div>
              ))}
            </section>
          );
        }
        if (card.kind === 'transactions') {
          return (
            <section
              key={`transactions-${String(index)}`}
              className={CARD}
              aria-label={m.assistant_card_transactions()}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h4 className="text-[12.5px] font-medium text-fg">{m.assistant_card_transactions()}</h4>
                <span className={SUBTLE}>{rangeLabel(card.from, card.to, locale)}</span>
              </div>
              {card.items.map((item) => (
                <div key={item.id} className={ROW}>
                  <span className="min-w-0 truncate text-muted-fg">
                    {item.description || formatDate(item.localDate, locale, 'day')}
                  </span>
                  <Money minor={item.amountMinor} currency={card.currency} context="table" locale={locale} />
                </div>
              ))}
            </section>
          );
        }
        return (
          <section key={`accounts-${String(index)}`} className={CARD} aria-label={m.assistant_card_accounts()}>
            <h4 className="text-[12.5px] font-medium text-fg">{m.assistant_card_accounts()}</h4>
            {card.items.map((item) => (
              <div key={item.id} className={ROW}>
                <span className="min-w-0 truncate text-muted-fg">{item.name}</span>
                <Money minor={item.balanceMinor} currency={item.currency} context="table" locale={locale} />
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** Chips that open the page behind a card; the dialog closes first. */
export function AssistantSources({
  cards,
  onNavigate,
}: {
  readonly cards: readonly AssistantCard[];
  readonly onNavigate: () => void;
}) {
  const links = useMemo(() => sourceLinks(cards), [cards]);
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={m.assistant_source_label()}>
      {links.map((link) => {
        const className =
          'rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring';
        if (link.kind === 'budget') {
          return (
            <Link key={`${link.kind}-${link.from}`} to="/budget" className={className} onClick={onNavigate}>
              {m.assistant_source_budget()}
            </Link>
          );
        }
        if (link.kind === 'accounts') {
          return (
            <Link key={link.kind} to="/accounts" className={className} onClick={onNavigate}>
              {m.assistant_source_accounts()}
            </Link>
          );
        }
        return (
          <Link
            key={`${link.kind}-${link.from}`}
            to="/transactions"
            search={{ range: `${link.from}..${link.to}`, type: 'expense' }}
            className={className}
            onClick={onNavigate}
          >
            {m.assistant_source_transactions()}
          </Link>
        );
      })}
    </div>
  );
}

export type DraftStatus = 'unsaved' | 'saving' | 'saved';

/** The proposal: what would be recorded, its impact, and the confirmation actions. */
export function AssistantDraftCard({
  draft,
  status,
  savedTransactionId,
  timeZone,
  onEdit,
  onCancel,
  onSave,
  onOpen,
}: {
  readonly draft: AssistantDraft;
  readonly status: DraftStatus;
  readonly savedTransactionId: string | null;
  readonly timeZone: string;
  readonly onEdit: () => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly onOpen: () => void;
}) {
  const { locale } = usePreferences().preferences;
  const time = draftTimeLabel(draft.occurredAt, timeZone, locale);
  const saved = status === 'saved';
  return (
    <div
      role="group"
      aria-label={m.assistant_draft_label()}
      className="flex flex-col gap-2 rounded-[9px] border border-border bg-surface-2 px-3 py-2.5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[13px] font-medium text-fg">{draft.description}</span>
        <span className={SUBTLE}>{saved ? m.assistant_draft_saved() : m.assistant_draft_unsaved()}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-subtle">{m.assistant_draft_category()}</dt>
        <dd className="text-fg">
          {draft.categoryName === null
            ? m.assistant_draft_no_category()
            : categoryName({ name: draft.categoryName, builtInKey: draft.categoryBuiltInKey })}
        </dd>
        <dt className="text-subtle">{m.assistant_draft_account()}</dt>
        <dd className="text-fg">{draft.accountName}</dd>
        <dt className="text-subtle">{m.assistant_draft_time()}</dt>
        <dd className="text-fg">{time}</dd>
      </dl>
      <div className="flex flex-col gap-1 text-[12px] text-muted-fg">
        {draft.budget === null || draft.categoryName === null ? null : (
          <p>
            <RichMessage
              message={m.assistant_draft_budget_impact}
              slots={{
                category: categoryName({ name: draft.categoryName, builtInKey: draft.categoryBuiltInKey }),
                percent: formatPercent(draft.budget.usedBps / 10_000, locale, {}),
              }}
            />
          </p>
        )}
        {draft.balance === null ? null : draft.balance.afterMinor < draft.balance.thresholdMinor ? (
          <p>
            <RichMessage
              message={m.assistant_draft_balance_below}
              slots={{
                account: draft.accountName,
                amount: (
                  <Money
                    minor={draft.balance.afterMinor}
                    currency={draft.balance.currency}
                    context="amount"
                    locale={locale}
                  />
                ),
                threshold: (
                  <Money
                    minor={draft.balance.thresholdMinor}
                    currency={draft.balance.currency}
                    context="amount"
                    locale={locale}
                  />
                ),
              }}
            />
          </p>
        ) : (
          <p>
            <RichMessage
              message={m.assistant_draft_balance}
              slots={{
                account: draft.accountName,
                amount: (
                  <Money
                    minor={draft.balance.afterMinor}
                    currency={draft.balance.currency}
                    context="amount"
                    locale={locale}
                  />
                ),
              }}
            />
          </p>
        )}
        {draft.duplicate === null ? null : (
          <p className="text-amber-fg">
            <RichMessage
              message={m.assistant_draft_duplicate}
              slots={{
                description: draft.duplicate.description || draft.description,
                date: formatDate(draft.duplicate.localDate, locale, 'day'),
                amount: (
                  <Money
                    minor={draft.duplicate.amountMinor}
                    currency={draft.currency}
                    context="amount"
                    locale={locale}
                  />
                ),
              }}
            />
          </p>
        )}
      </div>
      {saved ? (
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" onClick={onOpen} disabled={savedTransactionId === null}>
            {m.assistant_draft_open()}
          </Button>
        </div>
      ) : (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={status === 'saving'}>
            {m.assistant_draft_cancel()}
          </Button>
          <Button size="sm" variant="secondary" onClick={onEdit} disabled={status === 'saving'}>
            {m.assistant_draft_edit()}
          </Button>
          <Button size="sm" variant="primary" pending={status === 'saving'} onClick={onSave}>
            {draft.duplicate === null ? m.assistant_draft_save() : m.assistant_draft_duplicate_confirm()}
          </Button>
        </div>
      )}
    </div>
  );
}
