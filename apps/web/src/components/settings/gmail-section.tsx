// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Gmail settings split connection/filter editing from activity. Filter previews never persist or call AI.
 * The activity table contains matching mail only, with readable processing states, per-field suggestions,
 * and a link to the Review proposal. Only confirmation in Review records a transaction.
 */
import { Link, useRouter } from '@tanstack/react-router';
import type { EmailLogView } from '@wf/db/gmail';
import { emptyGmailFilters, type GmailFilterResult, type GmailFilters } from '@wf/domain/gmail';
import { formatDateTime } from '@wf/i18n/format';
import { m } from '@wf/i18n/messages';
import { ConfirmDialog } from '@wf/ui/confirm-dialog';
import { toast } from '@wf/ui/toast';
import { Fragment, useEffect, useRef, useState } from 'react';
import { History, Mail, Settings2, ShieldCheck } from 'lucide-react';
import { Select } from '@wf/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@wf/ui/tabs';
import { PageState } from '@wf/ui/page-state';
import { usePrivacy } from '@wf/ui/privacy';
import { Money } from '@wf/ui/money';
import { authErrorMessage, needsReauthentication } from '../../lib/auth-errors.ts';
import type { Viewer } from '../../server/gate.ts';
import { useReauthentication } from './reauth.tsx';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { aiErrorMessage } from '../../lib/ai-errors.ts';
import { categoryName } from '../../lib/ledger-labels.ts';
import type { GmailFilterTestRow, GmailSettings } from '../../server/fn/gmail.ts';
import { disconnectGmail, startGmailConnect, testFilters, updateFilters } from '../../server/fn/gmail.ts';
import { Button, Field, FormError, TextInput } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { Badge, SettingsGroup, SettingsRow } from './settings-ui.tsx';

/** The log column's verdict text ("lolos / diabaikan / tidak cocok", design). */
const FILTER_LABEL: Readonly<Record<GmailFilterResult, () => string>> = {
  passed: m.gmail_log_filter_passed,
  ignored_keyword: m.gmail_log_filter_ignored_keyword,
  filtered: m.gmail_log_filter_filtered,
};

type LogState = 'processing' | 'review' | 'failed' | 'confirmed' | 'ignored' | 'duplicate';
const LOG_LABEL: Readonly<Record<LogState, () => string>> = {
  processing: m.gmail_processing,
  review: m.gmail_stat_pending,
  failed: m.gmail_needs_attention,
  confirmed: m.gmail_stat_confirmed,
  ignored: m.gmail_stat_ignored,
  duplicate: m.gmail_status_duplicate,
};

function logState(row: EmailLogView): LogState {
  if (row.outcome === 'confirmed' || row.outcome === 'ignored' || row.outcome === 'duplicate') return row.outcome;
  if (row.errorCode !== null || row.processing === 'failed') return 'failed';
  return row.processing === 'done' ? 'review' : 'processing';
}

function logTone(state: LogState): string {
  if (state === 'failed') return 'bg-amber-tint-1 text-amber-fg';
  if (state === 'confirmed') return 'bg-green-tint-1 text-green-fg';
  if (state === 'review' || state === 'processing') return 'bg-blue-tint-1 text-blue-fg';
  return 'bg-surface-3 text-muted-fg';
}

/** The filter fields hold the typed text; lists are parsed only on save/test, so a trailing comma survives typing. */
type FilterDrafts = Record<keyof GmailFilters, string>;
const listValue = (values: readonly string[]): string => values.join('\n');
const listParse = (value: string): string[] =>
  value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
const draftsOf = ({ senders, keywords, ignoreKeywords }: GmailFilters): FilterDrafts => ({
  senders: listValue(senders),
  keywords: listValue(keywords),
  ignoreKeywords: listValue(ignoreKeywords),
});
const filtersOf = ({ senders, keywords, ignoreKeywords }: FilterDrafts) => ({
  senders: listParse(senders),
  keywords: listParse(keywords),
  ignoreKeywords: listParse(ignoreKeywords),
});

/** "Uji filter"'s verdict cell, with the ignore-keyword win spelled out ("kata kunci pengabaian menang"). */
function verdictText(verdict: GmailFilterResult): string {
  if (verdict === 'ignored_keyword') return m.gmail_test_ignored_keyword();
  return FILTER_LABEL[verdict]();
}

/** One stat tile of the month's counters (design `D6NOl8`). */
function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-[88px] flex-col gap-0.5 rounded-[10px] border border-border px-3 py-2">
      <span className="text-[11px] text-subtle">{label}</span>
      <span className="text-[16px] font-semibold text-fg">{String(value)}</span>
    </div>
  );
}

export interface GmailSectionProps {
  readonly settings: GmailSettings;
  /** IANA time zone of the viewer (log times in their clock). */
  readonly timeZone: string;
  readonly viewer: Pick<Viewer, 'email' | 'sessionId'>;
}

export function GmailSection({ settings, timeZone, viewer }: GmailSectionProps) {
  const router = useRouter();
  const { locale } = usePreferences().preferences;
  const { hidden, hiddenLabel } = usePrivacy();
  const [drafts, setDrafts] = useState<FilterDrafts>(() =>
    draftsOf(settings.connection?.filters ?? emptyGmailFilters()),
  );
  const [savedFilters, setSavedFilters] = useState(() => settings.connection?.filters ?? emptyGmailFilters());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<GmailFilterTestRow[] | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [mode, setMode] = useState('settings');
  const tabs = useRef<HTMLDivElement>(null);
  const { reauthenticate, dialog } = useReauthentication(viewer);
  const connection = settings.connection;
  const revoked = connection?.status === 'revoked';
  const dirty = JSON.stringify(filtersOf(drafts)) !== JSON.stringify(savedFilters);
  useEffect(() => {
    if (window.location.hash === '#gmail-failed') toast({ tone: 'error', title: m.gmail_action_failed() });
    if (window.location.hash === '#gmail-connected') toast({ tone: 'success', title: m.gmail_status_connected() });
  }, []);
  const refresh = () => {
    void router.invalidate().catch(() => {
      toast({ tone: 'error', title: m.gmail_action_failed() });
    });
  };

  const connect = async () => {
    setConnecting(false);
    let result = await startGmailConnect({ data: { consent: true } }).catch(() => null);
    if (result !== null && !result.ok && needsReauthentication(result.code) && (await reauthenticate()))
      result = await startGmailConnect({ data: { consent: true } }).catch(() => null);
    if (result?.ok !== true) {
      toast({
        tone: 'error',
        title: result === null ? m.gmail_action_failed() : authErrorMessage({ code: result.code }, locale),
      });
      return;
    }
    window.location.assign(result.value.url);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    const result = await updateFilters({ data: filtersOf(drafts) }).catch(() => null);
    setSaving(false);
    if (result?.ok !== true) {
      setSaveError(result === null ? m.gmail_action_failed() : ledgerErrorMessage(result.code, locale));
      return;
    }
    toast({ tone: 'success', title: m.gmail_filters_saved() });
    setSavedFilters(result.value.filters);
    refresh();
  };

  const runTest = async () => {
    setTesting(true);
    setTestError(null);
    const result = await testFilters({ data: filtersOf(drafts) }).catch(() => null);
    setTesting(false);
    if (result?.ok !== true) {
      setTestError(result === null ? m.gmail_test_failed() : ledgerErrorMessage(result.code, locale));
      return;
    }
    setTest(result.value);
  };

  const disconnect = async () => {
    const result = await disconnectGmail({ data: {} }).catch(() => null);
    setDisconnecting(false);
    if (result?.ok !== true) {
      toast({ tone: 'error', title: m.gmail_action_failed() });
      return;
    }
    toast({ tone: 'success', title: m.gmail_disconnected() });
    refresh();
  };

  return (
    <Tabs
      ref={tabs}
      value={mode}
      onValueChange={(value) => {
        setMode(value);
        const scroller = tabs.current?.closest<HTMLElement>('[data-settings-scroll]');
        if (scroller !== null && scroller !== undefined) scroller.scrollTop = 0;
      }}
      className="flex flex-col gap-5"
    >
      <div className="sticky -top-[22px] z-20 -mx-7 border-b border-border bg-dialog px-7 pt-3 pb-3">
        <TabsList label={m.gmail_settings_tabs()} fill>
          <TabsTrigger value="settings" icon={Settings2}>
            {m.gmail_tab_settings()}
          </TabsTrigger>
          <TabsTrigger value="activity" icon={History}>
            {m.settings_tab_activity()}
          </TabsTrigger>
        </TabsList>
        {dirty ? <p className="mt-2 text-[12px] text-amber-fg">{m.settings_unsaved()}</p> : null}
      </div>
      <TabsContent value="settings" forceMount className="flex flex-col gap-5 data-[state=inactive]:hidden">
        <SettingsGroup label={m.gmail_connection_title()}>
          <SettingsRow
            title={
              <span className="flex items-center gap-2">
                <Mail aria-hidden="true" className="size-4 text-subtle" />
                {connection === null ? m.gmail_connect_title() : hidden ? hiddenLabel : connection.email}
              </span>
            }
            description={
              connection === null
                ? settings.configured
                  ? m.gmail_connect_description()
                  : m.gmail_unavailable_hint()
                : revoked
                  ? m.gmail_revoked_description()
                  : m.gmail_connected_description()
            }
          >
            {connection === null || revoked ? (
              <Button
                size="sm"
                disabled={!settings.configured}
                onClick={() => {
                  setConnecting(true);
                }}
              >
                {revoked ? m.gmail_reconnect() : m.gmail_connect()}
              </Button>
            ) : (
              <Badge>{m.gmail_status_connected()}</Badge>
            )}
          </SettingsRow>
          <div className="flex items-start gap-2 px-3.5 py-3 text-[12px] text-subtle">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <div className="flex flex-col gap-1">
              <p>{m.gmail_readonly_note()}</p>
              <p>{m.ai_permission_confirm_hint()}</p>
            </div>
          </div>
          {connection === null ? null : (
            <SettingsRow title={m.gmail_disconnect_title()} description={m.gmail_disconnect_description()}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDisconnecting(true);
                }}
              >
                {m.gmail_disconnect()}
              </Button>
            </SettingsRow>
          )}
        </SettingsGroup>

        {connection === null ? null : (
          <>
            <SettingsGroup label={m.gmail_filters_title()}>
              <div className="flex flex-col gap-4 p-3.5">
                <p className="text-[12.5px] text-muted-fg">{m.gmail_filter_flow()}</p>
                <fieldset disabled={saving || testing} className="flex flex-col gap-4">
                  {(
                    [
                      {
                        key: 'senders',
                        label: m.gmail_senders_label(),
                        hint: m.gmail_senders_hint(),
                        placeholder: m.gmail_senders_example(),
                      },
                      {
                        key: 'keywords',
                        label: m.gmail_keywords_label(),
                        hint: m.gmail_keywords_hint(),
                        placeholder: m.gmail_keywords_example(),
                      },
                      {
                        key: 'ignoreKeywords',
                        label: m.gmail_ignore_keywords_label(),
                        hint: m.gmail_ignore_hint(),
                        placeholder: m.gmail_ignore_example(),
                      },
                    ] as const
                  ).map((field, index) => (
                    <div key={field.key} className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface-3 text-[11px] text-subtle"
                      >
                        {String(index + 1)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <Field label={field.label} hint={field.hint}>
                          {({ id, describedBy, invalid }) => (
                            <textarea
                              id={id}
                              aria-describedby={describedBy}
                              aria-invalid={invalid}
                              rows={3}
                              maxLength={10000}
                              autoComplete="off"
                              spellCheck={false}
                              className="w-full resize-y rounded-[9px] border border-border-input bg-input px-3 py-2 text-[13px] text-fg outline-none placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                              placeholder={field.placeholder}
                              value={drafts[field.key]}
                              onChange={(event) => {
                                setDrafts({ ...drafts, [field.key]: event.target.value });
                                setTest(null);
                              }}
                            />
                          )}
                        </Field>
                      </div>
                    </div>
                  ))}
                </fieldset>
                <p className="rounded-[7px] bg-surface-3 px-3 py-2 text-[12px] text-muted-fg">
                  {m.gmail_filter_not_stored()}
                </p>
                {saveError === null ? null : <FormError>{saveError}</FormError>}
              </div>
            </SettingsGroup>

            <SettingsGroup
              label={m.gmail_filter_test_title()}
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  pending={testing}
                  disabled={revoked || !settings.configured || saving}
                  onClick={() => {
                    void runTest();
                  }}
                >
                  {m.gmail_test_run()}
                </Button>
              }
            >
              <div className="flex flex-col gap-3 p-3.5">
                <p className="text-[12px] text-subtle">{m.gmail_filter_preview_hint()}</p>
                {testError === null ? null : <FormError>{testError}</FormError>}
                {test === null ? null : test.length === 0 ? (
                  <p className="text-[13px] text-muted-fg">{m.gmail_test_empty()}</p>
                ) : (
                  <ul className="divide-y divide-border rounded-[8px] border border-border">
                    {test.map((row, index) => (
                      <li key={index} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-medium text-fg">
                            {hidden ? hiddenLabel : row.subject}
                          </p>
                          <p className="truncate text-[11.5px] text-subtle">{hidden ? hiddenLabel : row.fromAddr}</p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] ${row.verdict === 'passed' ? 'bg-green-tint-1 text-green-fg' : 'bg-surface-3 text-muted-fg'}`}
                        >
                          {verdictText(row.verdict)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[12px] text-subtle">{m.gmail_test_note()}</p>
              </div>
            </SettingsGroup>

            <footer className="sticky -bottom-[22px] z-10 -mx-7 mt-auto -mb-[22px] flex flex-wrap items-center gap-2 border-t border-border bg-dialog px-7 py-3">
              <span role="status" className={`flex-1 text-[12px] ${dirty ? 'text-amber-fg' : 'text-subtle'}`}>
                {dirty ? m.settings_unsaved() : m.settings_synced()}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={!dirty || saving || testing}
                onClick={() => {
                  setDrafts(draftsOf(savedFilters));
                  setTest(null);
                  setSaveError(null);
                }}
              >
                {m.settings_cancel()}
              </Button>
              <Button
                size="sm"
                pending={saving}
                disabled={!dirty || testing}
                onClick={() => {
                  void save();
                }}
              >
                {m.gmail_filters_save()}
              </Button>
            </footer>
          </>
        )}
      </TabsContent>
      <TabsContent value="activity">
        <GmailActivity settings={settings} timeZone={timeZone} />
      </TabsContent>
      {dialog}
      {connecting ? (
        <ConfirmDialog
          open
          onOpenChange={() => {
            setConnecting(false);
          }}
          title={m.gmail_connect_title()}
          description={m.gmail_consent()}
          confirmLabel={m.gmail_connect()}
          cancelLabel={m.gmail_cancel()}
          onConfirm={() => {
            void connect();
          }}
        />
      ) : null}
      {disconnecting ? (
        <ConfirmDialog
          open
          onOpenChange={() => {
            setDisconnecting(false);
          }}
          title={m.gmail_disconnect_title()}
          description={m.gmail_disconnect_description()}
          confirmLabel={m.gmail_disconnect()}
          cancelLabel={m.gmail_cancel()}
          variant="destructive"
          onConfirm={() => {
            void disconnect();
          }}
        />
      ) : null}
    </Tabs>
  );
}

/** Only matching mail belongs here. Filter previews stay in the settings panel and are never persisted. */
function GmailActivity({ settings, timeZone }: { settings: GmailSettings; timeZone: string }) {
  const router = useRouter();
  const { locale } = usePreferences().preferences;
  const { hidden, hiddenLabel } = usePrivacy();
  const [status, setStatus] = useState<LogState | 'all'>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await router.invalidate();
    } catch {
      toast({ tone: 'error', title: m.gmail_action_failed() });
    } finally {
      setRefreshing(false);
    }
  };
  const needle = hidden ? '' : query.trim().toLocaleLowerCase(locale);
  const rows = settings.log.filter(
    (row) =>
      row.filterResult === 'passed' &&
      (status === 'all' || logState(row) === status) &&
      (needle === '' ||
        [row.subject, row.fromAddr, row.extraction?.merchant ?? ''].some((value) =>
          value.toLocaleLowerCase(locale).includes(needle),
        )),
  );
  const pageSize = 10;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  const visible = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  return (
    <div className="flex flex-col gap-5">
      <section aria-label={m.gmail_stats_title()} className="flex flex-col gap-2">
        <h4 className="text-[11px] font-medium text-subtle uppercase">{m.gmail_stats_title()}</h4>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label={m.gmail_stat_processed()} value={settings.stats.passed} />
          <StatTile label={m.gmail_stat_pending()} value={settings.stats.pending} />
          <StatTile label={m.gmail_stat_confirmed()} value={settings.stats.confirmed} />
          <StatTile label={m.gmail_status_duplicate()} value={settings.stats.duplicate} />
        </div>
      </section>
      <section aria-labelledby="gmail-log-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h4 id="gmail-log-title" className="text-[14px] font-semibold text-fg">
              {m.gmail_log_title()}
            </h4>
            <p className="text-[12px] text-subtle">{m.gmail_log_window()}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              pending={refreshing}
              onClick={() => {
                void refresh();
              }}
            >
              {m.settings_activity_refresh()}
            </Button>
            <a
              href="/api/gmail/log"
              className="rounded-[7px] border border-border px-3 py-1.5 text-[12px] font-medium text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              {m.gmail_log_export()}
            </a>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 rounded-[10px] border border-border bg-surface-sunken p-3 sm:grid-cols-[minmax(0,1fr)_190px]">
          <Field label={m.gmail_log_search()}>
            {({ id }) => (
              <TextInput
                id={id}
                size="sm"
                value={hidden ? '' : query}
                disabled={hidden}
                placeholder={m.gmail_log_search_hint()}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                  setExpanded(null);
                }}
              />
            )}
          </Field>
          <Field label={m.gmail_log_status()}>
            {({ id }) => (
              <Select<LogState | 'all'>
                id={id}
                size="sm"
                value={status}
                placeholder={m.ai_log_all_statuses()}
                options={[
                  { value: 'all', label: m.ai_log_all_statuses() },
                  ...(['review', 'processing', 'failed', 'confirmed', 'ignored', 'duplicate'] as const).map(
                    (value) => ({ value, label: LOG_LABEL[value]() }),
                  ),
                ]}
                onValueChange={(value) => {
                  setStatus(value);
                  setPage(0);
                  setExpanded(null);
                }}
              />
            )}
          </Field>
        </div>
        {rows.length === 0 ? (
          <PageState kind="empty" title={m.gmail_log_empty()} description={m.gmail_log_empty_hint()} />
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-border">
            <table className="w-full min-w-[550px] text-left text-[12px]">
              <thead className="border-b border-border bg-surface-sunken text-[11px] text-subtle">
                <tr>
                  <th className="px-3 py-2.5 font-medium">{m.gmail_log_email()}</th>
                  <th className="px-3 py-2.5 font-medium">{m.gmail_log_status()}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{m.review_amount_label()}</th>
                  <th className="px-3 py-2.5">
                    <span className="sr-only">{m.ai_log_detail()}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((row) => {
                  const state = logState(row);
                  const extraction = row.extraction;
                  return (
                    <Fragment key={row.id}>
                      <tr className="align-top text-fg">
                        <td className="max-w-[280px] px-3 py-3">
                          <p className="truncate font-medium">{hidden ? hiddenLabel : row.subject}</p>
                          <p className="mt-0.5 truncate text-[11px] text-subtle">
                            {hidden ? hiddenLabel : row.fromAddr}
                          </p>
                          <p className="mt-1 text-[11px] text-subtle">
                            {formatDateTime(row.receivedAt, locale, timeZone)}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${logTone(state)}`}
                          >
                            {LOG_LABEL[state]()}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          {extraction?.amountMinor == null || extraction.currency === null ? (
                            <span className="text-subtle">{m.ai_log_detail_none()}</span>
                          ) : (
                            <Money
                              minor={extraction.amountMinor}
                              currency={extraction.currency}
                              context="table"
                              locale={locale}
                            />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-expanded={expanded === row.id}
                            aria-controls={expanded === row.id ? `gmail-log-detail-${row.id}` : undefined}
                            aria-label={m.gmail_log_detail_label({ email: hidden ? hiddenLabel : row.subject })}
                            onClick={() => {
                              setExpanded((current) => (current === row.id ? null : row.id));
                            }}
                          >
                            {m.ai_log_detail()}
                          </Button>
                        </td>
                      </tr>
                      {expanded === row.id ? (
                        <tr>
                          <td colSpan={4} className="px-3 pb-3">
                            <GmailLogDetail row={row} timeZone={timeZone} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length === 0 ? null : (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-subtle">
              {m.ai_log_page({ shown: String(visible.length), total: String(rows.length) })}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={currentPage === 0}
                onClick={() => {
                  setPage(currentPage - 1);
                  setExpanded(null);
                }}
              >
                {m.ai_log_prev()}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={(currentPage + 1) * pageSize >= rows.length}
                onClick={() => {
                  setPage(currentPage + 1);
                  setExpanded(null);
                }}
              >
                {m.ai_log_next()}
              </Button>
            </div>
          </div>
        )}
        <p className="text-[12px] text-subtle">
          {m.gmail_filter_not_stored()} {m.gmail_retention()}
        </p>
      </section>
    </div>
  );
}

function GmailLogDetail({ row, timeZone }: { row: EmailLogView; timeZone: string }) {
  const { locale } = usePreferences().preferences;
  const { hidden, hiddenLabel } = usePrivacy();
  const state = logState(row);
  const extraction = row.extraction;
  const explanation: Readonly<Record<LogState, () => string>> = {
    processing: m.gmail_processing_hint,
    review: m.gmail_review_hint,
    failed: m.gmail_failure_hint,
    confirmed: m.gmail_confirmed_hint,
    ignored: m.gmail_ignored_hint,
    duplicate: m.gmail_duplicate_hint,
  };
  return (
    <section
      id={`gmail-log-detail-${row.id}`}
      aria-label={m.ai_log_detail()}
      className="flex flex-col gap-3 rounded-[8px] bg-surface-sunken p-3 text-[12px]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-muted-fg">{explanation[state]()}</p>
        {row.outcome === 'pending' && row.reviewItemId !== null ? (
          <Link
            to="/review"
            search={{ item: row.reviewItemId }}
            className="rounded-[7px] border border-border px-3 py-1.5 font-medium text-fg hover:bg-muted"
          >
            {m.gmail_open_review()}
          </Link>
        ) : null}
      </div>
      {row.errorCode === null ? null : (
        <p className="rounded-[7px] bg-amber-tint-1 px-3 py-2 text-amber-fg">
          {row.errorCode.startsWith('AI_') ? aiErrorMessage(row.errorCode, locale) : m.gmail_failure_hint()}
        </p>
      )}
      {extraction === null ? null : (
        <>
          <p className="text-[11px] text-subtle">{m.gmail_extraction_hint()}</p>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-subtle">{m.record_description()}</dt>
              <dd className="mt-1 font-medium text-fg">
                {hidden ? hiddenLabel : (extraction.merchant ?? m.review_ai_unknown())}
              </dd>
              <dd className="text-[11px] text-subtle">
                {m.gmail_field_confidence({ percent: extraction.confidence.merchant })}
              </dd>
            </div>
            <div>
              <dt className="text-subtle">{m.review_amount_label()}</dt>
              <dd className="mt-1 font-medium text-fg">
                {extraction.amountMinor === null || extraction.currency === null ? (
                  m.review_ai_unknown()
                ) : (
                  <Money
                    minor={extraction.amountMinor}
                    currency={extraction.currency}
                    context="table"
                    locale={locale}
                  />
                )}
              </dd>
              <dd className="text-[11px] text-subtle">
                {m.gmail_field_confidence({ percent: extraction.confidence.amount })}
              </dd>
            </div>
            <div>
              <dt className="text-subtle">{m.record_date()}</dt>
              <dd className="mt-1 text-fg">
                {hidden
                  ? hiddenLabel
                  : extraction.occurredAt === null
                    ? m.review_ai_unknown()
                    : formatDateTime(extraction.occurredAt, locale, timeZone)}
              </dd>
              <dd className="text-[11px] text-subtle">
                {m.gmail_field_confidence({ percent: extraction.confidence.date })}
              </dd>
            </div>
            <div>
              <dt className="text-subtle">{m.record_account()}</dt>
              <dd className="mt-1 text-fg">{hidden ? hiddenLabel : (row.accountName ?? m.review_ai_unknown())}</dd>
              <dd className="text-[11px] text-subtle">
                {m.gmail_field_confidence({ percent: extraction.confidence.account })}
              </dd>
            </div>
            <div>
              <dt className="text-subtle">{m.review_category_label()}</dt>
              <dd className="mt-1 text-fg">
                {hidden
                  ? hiddenLabel
                  : row.categoryName == null
                    ? m.review_ai_unknown()
                    : categoryName({ name: row.categoryName, builtInKey: row.categoryName })}
              </dd>
              <dd className="text-[11px] text-subtle">
                {m.gmail_field_confidence({ percent: extraction.confidence.category })}
              </dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
