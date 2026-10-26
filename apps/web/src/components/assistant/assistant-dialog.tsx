// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-AI3 "Asisten ⌘J": a sheet that answers from the user's own data and proposes drafts. It has no write path of its
 * own — "Simpan" calls the same `recordTransaction` every other form uses, with `source: assistant`, and the answer's
 * transcript stays on this device (only questions are sent, once, with the recent turns for context).
 */
import { useNavigate, useRouter } from '@tanstack/react-router';
import type { AiProvider, AiSettingsView, AiUsageSummary } from '@wf/domain/ai';
import { ASSISTANT_QUESTION_MAX, type AssistantAnswer, type AssistantDraft } from '@wf/domain/assistant';
import { m } from '@wf/i18n/messages';
import { PageState } from '@wf/ui/page-state';
import { Sheet } from '@wf/ui/sheet';
import { toast } from '@wf/ui/toast';
import { SendHorizontal, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { aiErrorMessage } from '../../lib/ai-errors.ts';
import { formatUsd } from '../../lib/ai-usd.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { askAssistant } from '../../server/fn/assistant.ts';
import type { Result } from '../../server/access.ts';
import { getAiSettings } from '../../server/fn/ai.ts';
import { recordTransaction } from '../../server/fn/transactions-write.ts';
import { Button } from '../form.tsx';
import { announceSaved, useRecordTransaction } from '../ledger/record-transaction.tsx';
import { usePreferences } from '../preferences.tsx';
import { openSettings } from '../settings/settings-sections.ts';
import { AssistantCards, AssistantDraftCard, AssistantSources, type DraftStatus } from './assistant-cards.tsx';
import { assistantText, draftPrefill, historyOf, nextTurns, type AssistantTurn } from './assistant-model.ts';

const PROVIDER_LABEL: Readonly<Record<AiProvider, () => string>> = {
  openrouter: m.ai_provider_openrouter,
  zenmux: m.ai_provider_zenmux,
  custom: m.ai_provider_custom,
};

type Config =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly code: string }
  | {
      readonly status: 'ready';
      readonly revision: string;
      readonly provider: AiProvider;
      readonly modelId: string;
      readonly usage: AiUsageSummary;
      readonly connected: boolean;
      readonly readAllowed: boolean;
    };

interface DraftState {
  readonly clientId: string;
  /** `cancelled` drops the card without touching the ledger. */
  readonly status: DraftStatus | 'cancelled';
  readonly savedId: string | null;
}

export interface AssistantDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly timeZone: string;
}

export function AssistantDialog({ open, onClose, timeZone }: AssistantDialogProps) {
  const router = useRouter();
  const navigate = useNavigate();
  const { open: openRecord } = useRecordTransaction();
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const [config, setConfig] = useState<Config>({ status: 'loading' });
  const [turns, setTurns] = useState<readonly AssistantTurn[]>([]);
  const [drafts, setDrafts] = useState<Readonly<Record<string, DraftState>>>({});
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement | null>(null);

  const applySettings = useCallback((result: Result<AiSettingsView> | null) => {
    if (result === null) {
      setConfig({ status: 'failed', code: 'NETWORK' });
      return;
    }
    if (!result.ok) {
      setConfig({ status: 'failed', code: result.code });
      return;
    }
    const view = result.value;
    const connection = view.connections.find((entry) => entry.provider === view.provider);
    setConfig({
      status: 'ready',
      revision: view.revision ?? '',
      provider: view.provider,
      modelId: connection?.modelId ?? '',
      usage: view.usage,
      connected: connection?.last4 != null && connection.last4 !== '',
      readAllowed: view.allowReadFinancial,
    });
  }, []);

  // Every open starts from the saved configuration; the transcript survives while the sheet stays mounted.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void getAiSettings()
      .catch(() => null)
      .then((result) => {
        if (live) applySettings(result);
      });
    return () => {
      live = false;
    };
  }, [open, applySettings]);
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: 'end' });
  }, [open, turns.length]);

  const ready = config.status === 'ready' && config.connected && config.readAllowed;

  const send = async (question: string) => {
    const trimmed = question.trim();
    if (trimmed === '' || busy || config.status !== 'ready') return;
    setBusy(true);
    setText('');
    const id = crypto.randomUUID();
    const history = historyOf(turns);
    setTurns((current) => nextTurns(current, { id, question: trimmed, answer: null, errorCode: null, pending: true }));
    const result = await askAssistant({
      data: {
        requestId: crypto.randomUUID(),
        expectedRevision: config.revision,
        question: trimmed,
        history: [...history],
      },
    }).catch(() => null);
    setBusy(false);
    if (result === null) {
      setTurns((current) =>
        current.map((turn) => (turn.id === id ? { ...turn, pending: false, errorCode: 'NETWORK' } : turn)),
      );
      return;
    }
    if (!result.ok) {
      setTurns((current) =>
        current.map((turn) => (turn.id === id ? { ...turn, pending: false, errorCode: result.code } : turn)),
      );
      return;
    }
    const answer: AssistantAnswer = result.value;
    setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, pending: false, answer } : turn)));
    if (answer.draft !== null) {
      setDrafts((current) => ({
        ...current,
        [id]: { clientId: crypto.randomUUID(), status: 'unsaved', savedId: null },
      }));
    }
    setConfig((current) => (current.status === 'ready' ? { ...current, usage: answer.usage } : current));
  };

  const setDraft = (id: string, patch: Partial<DraftState>) => {
    setDrafts((current) => (current[id] === undefined ? current : { ...current, [id]: { ...current[id], ...patch } }));
  };

  const save = async (id: string, draft: AssistantDraft) => {
    const state = drafts[id] ?? { clientId: crypto.randomUUID(), status: 'unsaved' as const, savedId: null };
    setDraft(id, { status: 'saving' });
    const result = await recordTransaction({
      data: {
        type: draft.type,
        clientId: state.clientId,
        occurredAt: draft.occurredAt,
        accountId: draft.accountId,
        amountMinor: draft.amountMinor,
        categoryId: draft.categoryId,
        description: draft.description,
        tags: [...draft.tags],
        source: 'assistant',
      },
    }).catch(() => null);
    if (result === null || !result.ok) {
      setDraft(id, { status: 'unsaved', clientId: crypto.randomUUID() });
      toast({
        tone: 'error',
        title: m.record_save_failed(),
        ...(result === null ? {} : { description: ledgerErrorMessage(result.code, locale) }),
      });
      return;
    }
    setDraft(id, { status: 'saved', savedId: result.value.id });
    announceSaved({
      id: result.value.id,
      label: draft.categoryName ?? draft.description,
      amountMinor: draft.type === 'income' ? draft.amountMinor : -draft.amountMinor,
      currency: draft.currency,
      accountName: draft.accountName,
      locale,
      onChange: () => {
        void router.invalidate();
      },
    });
    void router.invalidate();
  };

  const edit = (draft: AssistantDraft) => {
    onClose();
    openRecord(draftPrefill(draft, timeZone));
  };

  const goToSettings = (section: 'ai' | 'security') => {
    onClose();
    void navigate(openSettings(section));
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    void send(text);
  };

  const examples = useMemo(
    () => [m.assistant_example_budget(), m.assistant_example_record(), m.assistant_example_compare()],
    [],
  );

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={m.assistant_title()}
      description={
        config.status === 'ready' && config.connected
          ? [
              config.modelId,
              PROVIDER_LABEL[config.provider](),
              m.assistant_usage({
                spent: formatUsd(config.usage.spentUsd, locale),
                limit: formatUsd(config.usage.limitUsd, locale),
              }),
            ]
              .filter((part) => part !== '')
              .join(' · ')
          : m.assistant_not_connected_title()
      }
      closeLabel={m.assistant_close()}
      size="md"
      footer={
        ready ? (
          <form onSubmit={submit} className="flex w-full flex-col gap-1.5">
            <div className="flex items-end gap-2">
              <textarea
                aria-label={m.assistant_question()}
                value={text}
                rows={2}
                maxLength={ASSISTANT_QUESTION_MAX}
                placeholder={m.assistant_composer()}
                onChange={(event) => {
                  setText(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void send(text);
                  }
                }}
                className="min-h-[52px] flex-1 resize-none rounded-[9px] border border-border bg-surface px-3 py-2 text-[13px] text-fg placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-ring"
              />
              <Button type="submit" size="sm" pending={busy} disabled={text.trim() === ''}>
                <SendHorizontal aria-hidden="true" className="size-3.5" />
                {m.assistant_send()}
              </Button>
            </div>
            <p className="text-[11px] text-subtle">{m.assistant_footer()}</p>
          </form>
        ) : undefined
      }
    >
      {config.status === 'loading' ? (
        <PageState kind="loading" title={m.assistant_loading()} />
      ) : config.status === 'failed' ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-[13px] text-fg">
            {aiErrorMessage(config.code, locale)}
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setConfig({ status: 'loading' });
              void getAiSettings()
                .catch(() => null)
                .then(applySettings);
            }}
          >
            {m.assistant_retry()}
          </Button>
        </div>
      ) : !config.connected ? (
        <section className="flex flex-col gap-3" aria-label={m.assistant_not_connected_title()}>
          <span className="flex size-9 items-center justify-center rounded-[9px] bg-surface-3 text-fg">
            <Sparkles aria-hidden="true" className="size-[18px]" />
          </span>
          <h3 className="text-[15px] font-semibold text-fg">{m.assistant_not_connected_title()}</h3>
          <p className="text-[13px] text-muted-fg">{m.assistant_not_connected_body()}</p>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              goToSettings('ai');
            }}
          >
            {m.assistant_not_connected_action()}
          </Button>
          <p className="text-[11.5px] text-subtle">{m.assistant_not_connected_note()}</p>
        </section>
      ) : !config.readAllowed ? (
        <section className="flex flex-col gap-3" aria-label={m.assistant_permission_title()}>
          <h3 className="text-[15px] font-semibold text-fg">{m.assistant_permission_title()}</h3>
          <p className="text-[13px] text-muted-fg">{m.assistant_permission_body()}</p>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              goToSettings('ai');
            }}
          >
            {m.assistant_permission_action()}
          </Button>
        </section>
      ) : turns.length === 0 ? (
        <section className="flex flex-col gap-2" aria-label={m.assistant_title()}>
          <p className="text-[13px] text-muted-fg">{m.assistant_composer()}</p>
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                void send(example);
              }}
              className="rounded-[9px] border border-border px-3 py-2 text-left text-[12.5px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
            >
              {example}
            </button>
          ))}
        </section>
      ) : (
        <div className="flex flex-col gap-5" aria-live="polite">
          {turns.map((turn) => {
            const state = drafts[turn.id];
            const draftStatus: DraftStatus =
              state?.status === 'saving' || state?.status === 'saved' ? state.status : 'unsaved';
            return (
              <div key={turn.id} className="flex flex-col gap-2">
                <p className="self-end rounded-[9px] bg-surface-3 px-3 py-2 text-[13px] text-fg">{turn.question}</p>
                {turn.pending ? (
                  <p className="text-[12.5px] text-subtle">{m.assistant_loading()}</p>
                ) : turn.errorCode !== null ? (
                  <div className="flex flex-col items-start gap-2">
                    <p role="alert" className="text-[12.5px] text-fg">
                      {aiErrorMessage(turn.errorCode, locale)}
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void send(turn.question);
                      }}
                    >
                      {m.assistant_retry()}
                    </Button>
                  </div>
                ) : turn.answer === null ? null : (
                  <>
                    {turn.answer.text === '' ? (
                      <div className="flex flex-col items-start gap-2">
                        <p className="text-[12.5px] text-muted-fg">{m.assistant_answer_empty()}</p>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            void send(turn.question);
                          }}
                        >
                          {m.assistant_retry()}
                        </Button>
                      </div>
                    ) : (
                      <p className="text-[13px] whitespace-pre-wrap text-fg">
                        {assistantText(turn.answer.text, preferences.balancesHidden)}
                      </p>
                    )}
                    <AssistantCards cards={turn.answer.cards} />
                    {turn.answer.draft === null ? null : state?.status === 'cancelled' ? (
                      <p className="text-[12px] text-subtle">{m.assistant_draft_cancelled()}</p>
                    ) : (
                      <AssistantDraftCard
                        draft={turn.answer.draft}
                        status={draftStatus}
                        savedTransactionId={state?.savedId ?? null}
                        timeZone={timeZone}
                        onEdit={() => {
                          if (turn.answer?.draft != null) edit(turn.answer.draft);
                        }}
                        onCancel={() => {
                          setDraft(turn.id, { status: 'cancelled' });
                        }}
                        onSave={() => {
                          if (turn.answer?.draft != null) void save(turn.id, turn.answer.draft);
                        }}
                        onOpen={() => {
                          const savedId = state?.savedId ?? null;
                          if (savedId === null) return;
                          onClose();
                          void navigate({ to: '/transactions', search: { tx: savedId } });
                        }}
                      />
                    )}
                    <AssistantSources
                      cards={turn.answer.cards}
                      onNavigate={() => {
                        onClose();
                      }}
                    />
                  </>
                )}
              </div>
            );
          })}
          <div ref={end} />
        </div>
      )}
    </Sheet>
  );
}
