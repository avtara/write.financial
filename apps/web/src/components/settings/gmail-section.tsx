// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Gmail (FR-AI4; design `bCdNA`, `D6NOl8`, `DS1LC`, `ukKey`): the connect state (a disabled button with the
 * flag copy when the instance has no Gmail config, "Lanjutkan dengan Google" while unconnected, "Hubungkan lagi" and
 * "Putuskan" once it is), the three filter lists, "Uji filter" over the last five emails (dry run: sender · subject ·
 * verdict), the month's stat tiles, the ingest log table (waktu · pengirim · subjek · filter · AI + confidence ·
 * status) with its CSV export, and the 30-day retention note. Emails are proposed, never recorded: the Review queue
 * decides (D14).
 */
import { useRouter } from '@tanstack/react-router';
import type { EmailLogView } from '@wf/db/gmail';
import { emptyGmailFilters, type GmailFilterResult, type GmailFilters } from '@wf/domain/gmail';
import { formatDateTime } from '@wf/i18n/format';
import { m } from '@wf/i18n/messages';
import { ConfirmDialog } from '@wf/ui/confirm-dialog';
import { toast } from '@wf/ui/toast';
import { useEffect, useState } from 'react';
import { usePrivacy } from '@wf/ui/privacy';
import { Money } from '@wf/ui/money';
import { authErrorMessage, needsReauthentication } from '../../lib/auth-errors.ts';
import type { Viewer } from '../../server/gate.ts';
import { useReauthentication } from './reauth.tsx';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
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

/** The log column's outcome text. */
const OUTCOME_LABEL: Readonly<Record<EmailLogView['outcome'], () => string>> = {
  pending: m.gmail_stat_pending,
  confirmed: m.gmail_stat_confirmed,
  ignored: m.gmail_stat_ignored,
  duplicate: m.gmail_status_duplicate,
  filtered: m.gmail_log_filter_filtered,
};

const listValue = (values: readonly string[]): string => values.join(', ');
const listParse = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

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
  const [filters, setFilters] = useState<GmailFilters>(settings.connection?.filters ?? emptyGmailFilters());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<GmailFilterTestRow[] | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const { reauthenticate, dialog } = useReauthentication(viewer);
  const connection = settings.connection;
  const revoked = connection?.status === 'revoked';
  useEffect(() => {
    if (window.location.hash === '#gmail-failed') toast({ tone: 'error', title: m.gmail_action_failed() });
    if (window.location.hash === '#gmail-connected') toast({ tone: 'success', title: m.gmail_status_connected() });
  }, []);
  const refresh = () => {
    void router.invalidate();
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
    const result = await updateFilters({
      data: {
        senders: [...filters.senders],
        keywords: [...filters.keywords],
        ignoreKeywords: [...filters.ignoreKeywords],
      },
    }).catch(() => null);
    setSaving(false);
    if (result?.ok !== true) {
      setSaveError(result === null ? m.gmail_action_failed() : ledgerErrorMessage(result.code, locale));
      return;
    }
    toast({ tone: 'success', title: m.gmail_filters_saved() });
    refresh();
  };

  const runTest = async () => {
    setTesting(true);
    setTestError(null);
    const result = await testFilters({
      data: {
        senders: [...filters.senders],
        keywords: [...filters.keywords],
        ignoreKeywords: [...filters.ignoreKeywords],
      },
    }).catch(() => null);
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
    <>
      <SettingsGroup label={m.gmail_connection_title()}>
        {connection === null ? (
          <SettingsRow
            title={m.gmail_connect_title()}
            description={settings.configured ? m.gmail_connect_description() : m.gmail_flag_disabled()}
          >
            <Button
              size="sm"
              disabled={!settings.configured}
              aria-label={m.gmail_connect()}
              onClick={() => {
                setConnecting(true);
              }}
            >
              {m.gmail_connect()}
            </Button>
          </SettingsRow>
        ) : (
          <>
            <SettingsRow
              title={
                <span className="flex items-center gap-2">
                  {hidden ? hiddenLabel : connection.email}
                  {revoked ? <Badge>{m.gmail_status_revoked()}</Badge> : <Badge>{m.gmail_status_connected()}</Badge>}
                </span>
              }
              description={revoked ? m.gmail_revoked_description() : m.gmail_connected_description()}
            >
              <div className="flex items-center gap-2">
                {revoked ? (
                  <Button
                    size="sm"
                    disabled={!settings.configured}
                    aria-label={m.gmail_reconnect()}
                    onClick={() => {
                      setConnecting(true);
                    }}
                  >
                    {m.gmail_reconnect()}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={m.gmail_disconnect()}
                  onClick={() => {
                    setDisconnecting(true);
                  }}
                >
                  {m.gmail_disconnect()}
                </Button>
              </div>
            </SettingsRow>
            <p className="px-3.5 text-[12px] text-subtle">{m.gmail_readonly_note()}</p>
          </>
        )}
      </SettingsGroup>
      <SettingsGroup label={m.ai_permissions()}>
        <SettingsRow title={m.ai_permission_confirm()} description={m.ai_permission_confirm_hint()}>
          <label className="flex items-center gap-2 text-[12px] text-muted-fg">
            <input type="checkbox" checked disabled aria-label={m.ai_permission_confirm()} />
            {m.gmail_required()}
          </label>
        </SettingsRow>
      </SettingsGroup>

      {connection === null ? null : (
        <>
          <SettingsGroup
            label={m.gmail_filters_title()}
            action={
              <Button size="sm" pending={saving} aria-label={m.gmail_filters_save()} onClick={() => void save()}>
                {m.gmail_filters_save()}
              </Button>
            }
          >
            <div className="flex flex-col gap-3 px-3.5 py-[11px]">
              <Field label={m.gmail_senders_label()} hint={m.gmail_list_hint()}>
                {(control) => (
                  <TextInput
                    id={control.id}
                    aria-describedby={control.describedBy}
                    aria-invalid={control.invalid}
                    autoComplete="off"
                    spellCheck={false}
                    value={listValue(filters.senders)}
                    onChange={(event) => {
                      setFilters({ ...filters, senders: listParse(event.target.value) });
                    }}
                  />
                )}
              </Field>
              <Field label={m.gmail_keywords_label()} hint={m.gmail_list_hint()}>
                {(control) => (
                  <TextInput
                    id={control.id}
                    aria-describedby={control.describedBy}
                    aria-invalid={control.invalid}
                    autoComplete="off"
                    value={listValue(filters.keywords)}
                    onChange={(event) => {
                      setFilters({ ...filters, keywords: listParse(event.target.value) });
                    }}
                  />
                )}
              </Field>
              <Field label={m.gmail_ignore_keywords_label()} hint={m.gmail_list_hint()}>
                {(control) => (
                  <TextInput
                    id={control.id}
                    aria-describedby={control.describedBy}
                    aria-invalid={control.invalid}
                    autoComplete="off"
                    value={listValue(filters.ignoreKeywords)}
                    onChange={(event) => {
                      setFilters({ ...filters, ignoreKeywords: listParse(event.target.value) });
                    }}
                  />
                )}
              </Field>
              <p className="text-[12px] text-subtle">{m.gmail_filters_hint()}</p>
              {saveError === null ? null : <FormError>{saveError}</FormError>}
            </div>
          </SettingsGroup>

          <section aria-label={m.gmail_filter_test_title()} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-[14px] font-semibold text-fg">{m.gmail_filter_test_title()}</h4>
              <Button
                size="sm"
                variant="secondary"
                pending={testing}
                aria-label={m.gmail_test_run()}
                onClick={() => void runTest()}
              >
                {m.gmail_test_run()}
              </Button>
            </div>
            {testError === null ? null : <FormError>{testError}</FormError>}
            {test === null ? null : (
              <div className="flex flex-col gap-1 rounded-[10px] border border-border px-3.5 py-2.5 text-[12px]">
                {test.length === 0 ? (
                  <p className="text-muted-fg">{m.gmail_test_empty()}</p>
                ) : (
                  test.map((row) => (
                    <p key={`${row.fromAddr}:${row.subject}`} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate text-fg">
                        {hidden ? hiddenLabel : `${row.fromAddr} · ${row.subject}`}
                      </span>
                      <span className="shrink-0 text-muted-fg">{verdictText(row.verdict)}</span>
                    </p>
                  ))
                )}
                <p className="text-subtle">{m.gmail_test_note()}</p>
              </div>
            )}
          </section>

          <section aria-label={m.gmail_stats_title()} className="flex flex-col gap-2">
            <h4 className="text-[14px] font-semibold text-fg">{m.gmail_stats_title()}</h4>
            <div className="flex flex-wrap gap-2">
              <StatTile label={m.gmail_stat_received()} value={settings.stats.received} />
              <StatTile label={m.gmail_stat_passed()} value={settings.stats.passed} />
              <StatTile label={m.gmail_stat_pending()} value={settings.stats.pending} />
              <StatTile label={m.gmail_stat_confirmed()} value={settings.stats.confirmed} />
              <StatTile label={m.gmail_stat_ignored()} value={settings.stats.ignored} />
              <StatTile label={m.gmail_status_duplicate()} value={settings.stats.duplicate} />
            </div>
          </section>

          <section aria-labelledby="gmail-log-title" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 id="gmail-log-title" className="text-[14px] font-semibold text-fg">
                {m.gmail_log_title()}
              </h4>
              <a href="/api/gmail/log" className="text-[12px] text-muted-fg underline hover:text-fg">
                {m.gmail_log_export()}
              </a>
            </div>
            {settings.log.length === 0 ? (
              <p className="text-[13px] text-muted-fg">{m.gmail_log_empty()}</p>
            ) : (
              <table className="w-full text-left text-[12px]">
                <thead className="text-[11px] text-subtle uppercase">
                  <tr>
                    <th className="py-1 font-medium">{m.gmail_log_time()}</th>
                    <th className="py-1 font-medium">{m.gmail_log_sender()}</th>
                    <th className="py-1 font-medium">{m.gmail_log_filter()}</th>
                    <th className="py-1 font-medium">{m.gmail_log_ai()}</th>
                    <th className="py-1 font-medium">{m.gmail_log_status()}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {settings.log.map((row) => (
                    <tr key={row.id} className={row.outcome === 'filtered' ? 'text-muted-fg' : 'text-fg'}>
                      <td className="py-1.5 whitespace-nowrap">{formatDateTime(row.receivedAt, locale, timeZone)}</td>
                      <td className="max-w-[280px] truncate py-1.5">
                        {hidden ? hiddenLabel : `${row.fromAddr} · ${row.subject}`}
                      </td>
                      <td className="py-1.5">{FILTER_LABEL[row.filterResult]()}</td>
                      <td className="py-1.5">
                        {row.confidence === null ? '—' : m.gmail_confidence({ percent: row.confidence })}
                        {row.extraction === null ? null : (
                          <details>
                            <summary className="cursor-pointer">{m.gmail_source()}</summary>
                            <p>{hidden ? hiddenLabel : (row.extraction.merchant ?? m.review_ai_unknown())}</p>
                            {row.extraction.amountMinor === null || row.extraction.currency === null ? (
                              // An amount without its currency is not a sum anyone can read; never assume rupiah.
                              <span>{m.review_ai_unknown()}</span>
                            ) : (
                              <Money
                                minor={row.extraction.amountMinor}
                                currency={row.extraction.currency}
                                context="table"
                                locale={locale}
                              />
                            )}
                            <p>
                              {m.review_amount_label()} ·{' '}
                              {m.gmail_confidence({ percent: row.extraction.confidence.amount })}
                            </p>
                            <p>
                              {m.record_date()} ·{' '}
                              {row.extraction.occurredAt === null
                                ? m.review_ai_unknown()
                                : formatDateTime(row.extraction.occurredAt, locale, timeZone)}{' '}
                              · {m.gmail_confidence({ percent: row.extraction.confidence.date })}
                            </p>
                            <p>
                              {m.review_ai_merchant()} ·{' '}
                              {m.gmail_confidence({ percent: row.extraction.confidence.merchant })}
                            </p>
                            <p>
                              {m.record_account()} ·{' '}
                              {hidden ? hiddenLabel : (row.extraction.accountId ?? m.review_ai_unknown())} ·{' '}
                              {m.gmail_confidence({ percent: row.extraction.confidence.account })}
                            </p>
                            <p>
                              {m.review_category_label()} ·{' '}
                              {hidden ? hiddenLabel : (row.extraction.categoryId ?? m.review_ai_unknown())} ·{' '}
                              {m.gmail_confidence({ percent: row.extraction.confidence.category })}
                            </p>
                          </details>
                        )}
                      </td>
                      <td className="py-1.5">
                        {OUTCOME_LABEL[row.outcome]()}{' '}
                        {row.errorCode === null ? null : (
                          <span className="text-amber-fg">{m.gmail_missing_fields()}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-[12px] text-subtle">{m.gmail_retention()}</p>
          </section>
        </>
      )}

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
    </>
  );
}
