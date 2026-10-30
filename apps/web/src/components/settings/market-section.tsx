// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › "API kurs & pasar" (FR-ST4, FR-I5, FR-I6; design `JtnsQ`, log `iCbPR`): the price source of every
 * asset class with its mode (Bawaan / BYOK / Manual / Estimasi) and status ("Aktif · 16.42", "Terhubung", "Atur key",
 * "Kuota habis s.d. …"); per BYOK provider the masked key, frequency within the free quota, quota meter, "Dapatkan key
 * gratis", "Tes koneksi" with per-symbol results, and the license notes. Saving a key requires 2FA; deleting it deletes
 * the provider's prices. "Sinkronkan harga" goes source by source ("Sinkron 2/4…"); "Buka log API" shows the request
 * log (30 days, keys never logged). Prices are delayed or closing prices — never "real-time".
 */
import { useNavigate, useRouter } from '@tanstack/react-router';
import type { MarketCredentialView } from '@wf/db/market-credentials';
import type { ApiLogView } from '@wf/db/market-data';
import type { ProviderStateView } from '@wf/db/market-jobs';
import { divideRound, parseDecimal } from '@wf/domain/decimal';
import {
  refreshPlan,
  type ByokProvider,
  type CredentialStatus,
  type QuoteLabel,
  type ServerProvider,
} from '@wf/domain/market';
import { currencyInfo } from '@wf/domain/money';
import { formatDate } from '@wf/i18n/format';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { ConfirmDialog } from '@wf/ui/confirm-dialog';
import { Money } from '@wf/ui/money';
import { Switch } from '@wf/ui/switch';
import { toast } from '@wf/ui/toast';
import { useState, type ReactNode } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import {
  byokProvidersOf,
  FREE_KEY_URLS,
  PROVIDER_MARKET,
  PROVIDER_NAMES,
  SYNC_MARKETS,
  type SyncMarket,
} from '../../lib/market-sources.ts';
import type { MarketSettings, MarketSyncResult, MarketTestResult } from '../../server/fn/market.ts';
import {
  getMarketApiLog,
  removeMarketKey,
  saveMarketKey,
  setFxDiffAsExpense as saveFxDiffAsExpense,
  setMarketKeyActive,
  syncMarketSource,
  testMarketKey,
} from '../../server/fn/market.ts';
import { Button, Field, FormError, TextInput } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { usePreferences } from '../preferences.tsx';
import { Badge, SettingsGroup, SettingsRow } from './settings-ui.tsx';
import { openSettings } from './settings-sections.ts';

/** `16.42` (id) / `16:42` (en) in `timeZone`, with the date when it is not today ("15 Okt 16.42"). */
function timeOf(date: Date, locale: Locale, timeZone: string, now = new Date()): string {
  const clock = new Intl.DateTimeFormat(locale === 'id' ? 'id-ID' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(date);
  const day = formatDate(date, locale, { year: false, timeZone });
  return day === formatDate(now, locale, { year: false, timeZone }) ? clock : `${day} ${clock}`;
}

/** A provider's price as minor units of its currency, for `<Money>`. */
function priceMinor(price: string, currency: string): bigint {
  return divideRound(parseDecimal(price), 10n ** BigInt(18 - currencyInfo(currency).minorDigits));
}

const CLASS_LABEL: Readonly<Record<SyncMarket | 'fx' | 'mutual_fund' | 'sbn', () => string>> = {
  fx: m.market_class_fx,
  us_equity: m.market_class_us_equity,
  idx_equity: m.market_class_idx_equity,
  crypto: m.market_class_crypto,
  gold_spot: m.market_class_gold_spot,
  mutual_fund: m.market_class_mutual_fund,
  sbn: m.market_class_sbn,
};

/** FR-ST4 status text of a key or built-in source. */
function statusText(status: CredentialStatus, until: Date | null, time: (date: Date) => string): string {
  if (status === 'quota_exhausted')
    return m.market_status_quota_exhausted({ time: until === null ? '—' : time(until) });
  if (status === 'rate_limited') return m.market_status_rate_limited({ time: until === null ? '—' : time(until) });
  const texts: Record<Exclude<CredentialStatus, 'quota_exhausted' | 'rate_limited'>, () => string> = {
    untested: m.market_status_untested,
    connected: m.market_status_connected,
    unverified: m.market_status_unverified,
    invalid_key: m.market_status_invalid_key,
    error: m.market_status_error,
  };
  return texts[status]();
}

const LABEL_TEXT: Readonly<Record<QuoteLabel, () => string>> = {
  delayed: m.market_label_delayed,
  close: m.market_label_close,
  manual: m.market_label_manual,
  estimate: m.market_label_estimate,
  last: m.market_label_last,
};

function ModeBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 items-center rounded-full bg-surface-3 px-2 text-[11px] font-medium text-muted-fg">
      {children}
    </span>
  );
}

/** "Sinkronkan harga" outcome of one source. */
export function syncText(result: MarketSyncResult, time: (date: Date) => string): string {
  if (result.status === 'synced') {
    return m.market_sync_synced({ count: result.synced, provider: PROVIDER_NAMES[result.provider as ByokProvider] });
  }
  if (result.status === 'partial') return m.market_sync_partial({ count: result.synced, missing: result.missing });
  if (result.status === 'paused') return m.market_sync_paused({ time: time(result.pausedUntil as Date) });
  if (result.status === 'no_key') return m.market_sync_no_key();
  if (result.status === 'cached') return m.market_sync_cached();
  return m.market_sync_failed();
}

interface KeyDialogProps {
  readonly provider: ByokProvider;
  readonly twoFactorEnabled: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

/** "Atur key": the key field (2FA required), the license notes. */
function KeyDialog({ provider, twoFactorEnabled, onClose, onSaved }: KeyDialogProps) {
  const navigate = useNavigate();
  const { locale } = usePreferences().preferences;
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const name = PROVIDER_NAMES[provider];
  const save = async () => {
    setSaving(true);
    const result = await saveMarketKey({ data: { provider, apiKey } }).catch(() => null);
    setSaving(false);
    if (result?.ok !== true) {
      setError(result === null ? m.market_action_failed() : ledgerErrorMessage(result.code, locale));
      return;
    }
    toast({ tone: 'success', title: m.market_key_saved({ provider: name }) });
    onSaved();
  };
  return (
    <Modal
      open
      onOpenChange={() => {
        onClose();
      }}
      title={twoFactorEnabled ? m.market_key_dialog_title({ provider: name }) : m.market_two_factor_title()}
    >
      {twoFactorEnabled ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field label={m.market_key_label()} hint={m.market_key_hint()} error={error}>
            {(control) => (
              <TextInput
                id={control.id}
                aria-describedby={control.describedBy}
                aria-invalid={control.invalid}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                }}
              />
            )}
          </Field>
          <ul className="flex flex-col gap-1 text-[12px] text-subtle">
            <li>{m.market_license_personal()}</li>
            <li>{m.market_license_delayed()}</li>
            {provider === 'coingecko' ? <li>{m.market_license_coingecko()}</li> : null}
          </ul>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {m.market_cancel()}
            </Button>
            <Button type="submit" disabled={saving || apiKey.trim().length < 4}>
              {m.market_key_save()}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-muted-fg">{m.market_two_factor_body()}</p>
          <div className="flex justify-end">
            <Button type="button" onClick={() => void navigate(openSettings('security'))}>
              {m.market_two_factor_action()}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

interface ProviderRowProps {
  readonly provider: ByokProvider;
  readonly credential: MarketCredentialView | undefined;
  readonly saved: number;
  readonly symbols: number;
  readonly time: (date: Date) => string;
  readonly onSetKey: (provider: ByokProvider) => void;
  readonly onDelete: (provider: ByokProvider) => void;
  readonly onChanged: () => void;
}

/** One BYOK provider: key, status, frequency, quota, test, switch, delete. */
function ProviderRow({ provider, credential, saved, symbols, time, onSetKey, onDelete, onChanged }: ProviderRowProps) {
  const { locale } = usePreferences().preferences;
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<MarketTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = PROVIDER_NAMES[provider];
  const plan = refreshPlan(provider, PROVIDER_MARKET[provider], Math.max(symbols, 1));
  const frequency =
    plan === null
      ? m.market_frequency_none()
      : plan.intervalMinutes === null
        ? m.market_frequency_daily({ count: plan.refreshesPerDay })
        : m.market_frequency_interval({ minutes: plan.intervalMinutes });
  const runTest = async () => {
    setTesting(true);
    setError(null);
    const result = await testMarketKey({ data: { provider } }).catch(() => null);
    setTesting(false);
    if (result?.ok !== true) {
      setError(result?.code === 'MARKET_TEST_LIMIT' ? m.market_test_limit() : m.market_action_failed());
      return;
    }
    setTest(result.value);
    onChanged();
  };
  const toggle = async (active: boolean) => {
    const result = await setMarketKeyActive({ data: { provider, active } }).catch(() => null);
    if (result?.ok !== true) toast({ tone: 'error', title: m.market_action_failed() });
    else onChanged();
  };
  const description =
    credential === undefined
      ? m.market_no_key()
      : [
          m.market_key_masked({ last4: credential.last4 }),
          credential.active ? statusText(credential.status, credential.retryAfter, time) : m.market_status_inactive(),
          frequency,
          m.market_saved_quotes({ count: saved }),
        ].join(' · ');
  return (
    <div className="flex flex-col" data-provider={provider}>
      <SettingsRow
        title={
          <span className="flex items-center gap-2">
            {name}
            <ModeBadge>{m.market_mode_byok()}</ModeBadge>
            {credential?.active === true &&
            (credential.status === 'connected' || credential.status === 'unverified') ? (
              <Badge>{m.market_status_connected()}</Badge>
            ) : null}
          </span>
        }
        description={description}
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          {credential === undefined ? (
            <>
              <a
                href={FREE_KEY_URLS[provider]}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[12px] text-muted-fg underline hover:text-fg"
              >
                {m.market_free_key()}
              </a>
              <Button
                size="sm"
                variant="secondary"
                aria-label={`${m.market_set_key()} ${name}`}
                onClick={() => {
                  onSetKey(provider);
                }}
              >
                {m.market_set_key()}
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={testing}
                aria-label={`${m.market_test()} ${name}`}
                onClick={() => void runTest()}
              >
                {testing ? m.market_testing() : m.market_test()}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`${m.market_change_key()} ${name}`}
                onClick={() => {
                  onSetKey(provider);
                }}
              >
                {m.market_change_key()}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void toggle(!credential.active)}>
                {credential.active ? m.market_deactivate() : m.market_activate()}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`${m.market_delete()} ${name}`}
                onClick={() => {
                  onDelete(provider);
                }}
              >
                {m.market_delete()}
              </Button>
            </>
          )}
        </div>
      </SettingsRow>
      {credential?.quotaLimit != null ? (
        <div className="flex items-center gap-3 px-3.5 pb-[11px] text-[12px] text-subtle">
          <progress
            aria-label={m.market_quota_label({ provider: name })}
            className="h-1.5 w-40 accent-fg"
            value={Math.min(credential.quotaUsed, credential.quotaLimit)}
            max={credential.quotaLimit}
          />
          {m.market_quota({ used: credential.quotaUsed, limit: credential.quotaLimit })}
        </div>
      ) : null}
      {error === null ? null : (
        <div className="px-3.5 pb-[11px]">
          <FormError>{error}</FormError>
        </div>
      )}
      {test === null ? null : (
        <section aria-label={m.market_test_results({ provider: name })} className="px-3.5 pb-[11px]">
          <p className="text-[12px] font-medium text-fg">
            {m.market_test_results({ provider: name })} · {statusText(test.status, test.pausedUntil, time)}
          </p>
          <ul className="flex flex-col gap-0.5 text-[12px] text-muted-fg">
            {test.results.map((result) => (
              <li key={`${result.symbol}:${result.currency}`} className="flex gap-2">
                <span className="font-medium text-fg">{result.symbol}</span>
                {result.price === null || result.asOf === null ? (
                  <span>{m.market_test_missing()}</span>
                ) : (
                  <>
                    <Money
                      minor={priceMinor(result.price, result.currency)}
                      currency={result.currency}
                      context="amount"
                      locale={locale}
                    />
                    <span>{time(result.asOf)}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** A built-in source's status: "Aktif · 16.42", paused, not set up, or waiting for its first run. */
function builtInStatus(state: ProviderStateView | undefined, time: (date: Date) => string): string {
  if (state === undefined) return m.market_status_waiting();
  if (state.status === 'unconfigured') return m.market_status_unconfigured();
  if (state.status === 'quota_exhausted' || state.status === 'rate_limited' || state.status === 'error') {
    return statusText(state.status, state.pausedUntil, time);
  }
  return m.market_status_active_at({ time: time(state.updatedAt) });
}

/** "Buka log API" (design `iCbPR`). */
export function ApiLog({ entries, time }: { entries: ApiLogView[]; time: (date: Date) => string }) {
  const today = new Date().toDateString();
  const ofToday = entries.filter((entry) => entry.at.toDateString() === today);
  return (
    <section aria-labelledby="market-log-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h4 id="market-log-title" className="text-[14px] font-semibold text-fg">
          {m.market_log_title()}
        </h4>
        <p className="text-[12px] text-subtle">{m.market_log_subtitle()}</p>
        <p className="text-[12px] text-muted-fg">
          {m.market_log_today({ count: ofToday.length, failed: ofToday.filter((entry) => !entry.ok).length })}
        </p>
      </div>
      {entries.length === 0 ? (
        <p className="text-[13px] text-muted-fg">{m.market_log_empty()}</p>
      ) : (
        <table className="w-full text-left text-[12px]">
          <thead className="text-[11px] text-subtle uppercase">
            <tr>
              <th className="py-1 font-medium">{m.market_log_time()}</th>
              <th className="py-1 font-medium">{m.market_log_source()}</th>
              <th className="py-1 font-medium">{m.market_log_request()}</th>
              <th className="py-1 font-medium">{m.market_log_status()}</th>
              <th className="py-1 text-right font-medium">{m.market_log_duration()}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.map((entry) => {
              const test = entry.endpoint.startsWith('TEST ');
              return (
                <tr key={entry.id} className={entry.ok ? 'text-fg' : 'text-red-fg'}>
                  <td className="py-1.5 whitespace-nowrap">{time(entry.at)}</td>
                  <td className="py-1.5">
                    {PROVIDER_NAMES[entry.provider]}
                    {entry.own ? null : <span className="text-subtle"> · {m.market_log_builtin()}</span>}
                  </td>
                  <td className="py-1.5 font-mono">
                    {test ? <ModeBadge>{m.market_log_test()}</ModeBadge> : null}{' '}
                    {test ? entry.endpoint.slice(5) : entry.endpoint}
                  </td>
                  <td className="py-1.5">
                    {entry.httpStatus === null ? m.market_log_no_response() : String(entry.httpStatus)}
                    {entry.errorCode === null ? null : ` · ${entry.errorCode}`}
                  </td>
                  <td className="py-1.5 text-right font-mono">{`${String(entry.durationMs)} ms`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

export interface MarketSectionProps {
  readonly settings: MarketSettings;
  /** IANA time zone of the viewer (times in their clock). */
  readonly timeZone: string;
}

export function MarketSection({ settings, timeZone }: MarketSectionProps) {
  const router = useRouter();
  const { locale } = usePreferences().preferences;
  const time = (date: Date) => timeOf(date, locale, timeZone);
  const [keyFor, setKeyFor] = useState<ByokProvider | null>(null);
  const [deleting, setDeleting] = useState<ByokProvider | null>(null);
  const [log, setLog] = useState<ApiLogView[] | null>(null);
  const [logError, setLogError] = useState(false);
  const [sync, setSync] = useState<{ done: number; results: MarketSyncResult[] } | null>(null);
  const [fxDiffAsExpense, setFxDiffAsExpense] = useState(settings.fxDiffAsExpense);
  const refresh = () => {
    void router.invalidate();
  };
  const keyOf = (provider: ByokProvider) => settings.keys.find((key) => key.provider === provider);
  const stateOf = (provider: ServerProvider) => settings.serverSources.find((state) => state.provider === provider);

  const openLog = async () => {
    setLogError(false);
    const result = await getMarketApiLog({ data: {} }).catch(() => null);
    if (result?.ok !== true) setLogError(true);
    else setLog(result.value);
  };

  const runSync = async () => {
    const results: MarketSyncResult[] = [];
    setSync({ done: 0, results });
    for (const market of SYNC_MARKETS) {
      const result = await syncMarketSource({ data: { market } }).catch(() => null);
      results.push(
        result?.ok === true
          ? result.value
          : { market, status: 'failed', synced: 0, missing: 0, provider: null, pausedUntil: null },
      );
      setSync({ done: results.length, results: [...results] });
    }
    toast({ tone: 'success', title: m.market_sync_done() });
    refresh();
  };

  const remove = async (provider: ByokProvider) => {
    const result = await removeMarketKey({ data: { provider } }).catch(() => null);
    if (result?.ok !== true) {
      toast({ tone: 'error', title: m.market_action_failed() });
      return;
    }
    toast({ tone: 'success', title: m.market_deleted({ provider: PROVIDER_NAMES[provider] }) });
    refresh();
  };

  const syncing = sync !== null && sync.done < SYNC_MARKETS.length;
  const byokRows = (market: SyncMarket) =>
    byokProvidersOf(market).map((provider) => (
      <ProviderRow
        key={provider}
        provider={provider}
        credential={keyOf(provider)}
        saved={settings.quoteCounts[provider] ?? 0}
        symbols={settings.symbolCounts[market] ?? 0}
        time={time}
        onSetKey={setKeyFor}
        onDelete={setDeleting}
        onChanged={refresh}
      />
    ));
  const countFxDiff = async (enabled: boolean) => {
    setFxDiffAsExpense(enabled);
    const result = await saveFxDiffAsExpense({ data: { enabled } }).catch(() => null);
    if (result?.ok !== true) {
      setFxDiffAsExpense(!enabled);
      toast({ tone: 'error', title: m.market_action_failed() });
      return;
    }
    toast({ tone: 'success', title: enabled ? m.market_fx_diff_counted() : m.market_fx_diff_not_counted() });
    refresh();
  };
  const builtIn = (provider: ServerProvider, label: string, extra?: string) => (
    <SettingsRow
      title={
        <span className="flex items-center gap-2">
          {label}
          <ModeBadge>{m.market_mode_builtin()}</ModeBadge>
        </span>
      }
      description={[builtInStatus(stateOf(provider), time), ...(extra === undefined ? [] : [extra])].join(' · ')}
    />
  );
  const cmc = stateOf('coinmarketcap');

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {log === null ? (
          <Button size="sm" variant="secondary" onClick={() => void openLog()}>
            {m.market_open_log()}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setLog(null);
            }}
          >
            {m.market_back()}
          </Button>
        )}
        <Button size="sm" disabled={syncing} onClick={() => void runSync()}>
          {syncing ? m.market_sync_progress({ done: sync.done + 1, total: SYNC_MARKETS.length }) : m.market_sync()}
        </Button>
      </div>
      {logError ? <FormError>{m.market_log_failed()}</FormError> : null}
      <section aria-label={m.market_prices_title()} className="flex flex-col gap-0.5 text-[12px]">
        <h4 className="font-medium text-fg">{m.market_prices_title()}</h4>
        {settings.prices.length === 0 ? (
          <p className="text-muted-fg">{m.market_prices_none()}</p>
        ) : (
          settings.prices.map((entry) => (
            <p key={`${entry.label}:${entry.provider}`} className="text-muted-fg">
              {entry.provider === null ? null : `${PROVIDER_NAMES[entry.provider]} · `}
              {m.market_prices_entry({ count: entry.count, label: LABEL_TEXT[entry.label](), time: time(entry.asOf) })}
            </p>
          ))
        )}
      </section>
      {sync === null ? null : (
        <ul
          aria-live="polite"
          className="flex flex-col gap-1 rounded-[10px] border border-border px-3.5 py-2.5 text-[12px]"
        >
          {sync.results.map((result) => (
            <li key={result.market} className="flex justify-between gap-3">
              <span className="font-medium text-fg">{CLASS_LABEL[result.market]()}</span>
              <span className={result.status === 'failed' ? 'text-red-fg' : 'text-muted-fg'}>
                {syncText(result, time)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {log !== null ? (
        <ApiLog entries={log} time={time} />
      ) : (
        <>
          <SettingsGroup label={CLASS_LABEL.fx()}>
            <SettingsRow
              title={
                <span className="flex items-center gap-2">
                  {m.market_fx_source()}
                  <ModeBadge>{m.market_mode_builtin()}</ModeBadge>
                </span>
              }
              description={m.market_fx_status()}
            />
            <SettingsRow title={m.market_fx_diff_expense()} description={m.market_fx_diff_expense_hint()}>
              <Switch
                label={<span className="sr-only">{m.market_fx_diff_expense()}</span>}
                checked={fxDiffAsExpense}
                onChange={(event) => {
                  void countFxDiff(event.currentTarget.checked);
                }}
              />
            </SettingsRow>
          </SettingsGroup>
          <SettingsGroup label={CLASS_LABEL.us_equity()}>{byokRows('us_equity')}</SettingsGroup>
          <SettingsGroup label={CLASS_LABEL.idx_equity()}>{byokRows('idx_equity')}</SettingsGroup>
          <SettingsGroup label={CLASS_LABEL.crypto()}>
            {builtIn(
              'coinmarketcap',
              PROVIDER_NAMES.coinmarketcap,
              settings.cmcConfigured && cmc?.quotaLimit != null
                ? m.market_credits({ used: cmc.quotaUsed, limit: cmc.quotaLimit })
                : undefined,
            )}
            {byokRows('crypto')}
          </SettingsGroup>
          <SettingsGroup label={CLASS_LABEL.gold_spot()}>
            {builtIn('fawazahmed0', `${PROVIDER_NAMES.fawazahmed0} · XAU`)}
            {byokRows('gold_spot')}
            <SettingsRow
              title={
                <span className="flex items-center gap-2">
                  {m.market_antam_title()}
                  <ModeBadge>{m.market_mode_estimate()}</ModeBadge>
                </span>
              }
              description={m.market_antam()}
            />
          </SettingsGroup>
          <SettingsGroup label={CLASS_LABEL.mutual_fund()}>
            <SettingsRow
              title={<ModeBadge>{m.market_mode_manual()}</ModeBadge>}
              description={m.market_mutual_fund_note()}
            />
          </SettingsGroup>
          <SettingsGroup label={CLASS_LABEL.sbn()}>
            <SettingsRow title={<ModeBadge>{m.market_mode_estimate()}</ModeBadge>} description={m.market_sbn_note()} />
          </SettingsGroup>
          <p className="text-[12px] text-subtle">
            {m.market_license_personal()} · {m.market_license_delayed()}
          </p>
        </>
      )}
      {keyFor === null ? null : (
        <KeyDialog
          provider={keyFor}
          twoFactorEnabled={settings.twoFactorEnabled}
          onClose={() => {
            setKeyFor(null);
          }}
          onSaved={() => {
            setKeyFor(null);
            refresh();
          }}
        />
      )}
      {deleting === null ? null : (
        <ConfirmDialog
          open
          onOpenChange={() => {
            setDeleting(null);
          }}
          title={m.market_delete_title({ provider: PROVIDER_NAMES[deleting] })}
          description={m.market_delete_description()}
          impact={m.market_delete_impact({
            count: settings.quoteCounts[deleting] ?? 0,
            provider: PROVIDER_NAMES[deleting],
          })}
          confirmLabel={m.market_delete()}
          cancelLabel={m.market_cancel()}
          variant="destructive"
          onConfirm={() => {
            void remove(deleting);
            setDeleting(null);
          }}
        />
      )}
    </>
  );
}
