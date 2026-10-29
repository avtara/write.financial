// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › "AI agent (BYOK)" (FR-AI2, FR-A9, D14; design `MXnjE`, `l1nyC`, `GpdeI`, `OJaxo`): the provider and its
 * own API key (masked to the last four characters, never returned), the model from the public catalog or typed by
 * hand, the prices, the permissions (including the locked "always confirm"), the monthly USD cap with its usage, and
 * the deliberate connection test that may cost a tiny request. "Lihat log" shows the 30-day metadata log with
 * feature/status filters, pages, details, and CSV export — no prompts, responses, or full tool arguments.
 */
import { useNavigate, useRouter } from '@tanstack/react-router';
import type {
  AiConnectionTestInput,
  AiConnectionStatus,
  AiConnectionView,
  AiCostSource,
  AiFeature,
  AiLogStatus,
  AiLogView,
  AiLogsPage,
  AiModelCatalog,
  AiPricing,
  AiProvider,
  AiSettingsInput,
  AiSettingsView,
  AiUsageSummary,
} from '@wf/domain/ai';
import { AI_FEATURES, AI_LOG_STATUSES, AI_PROVIDERS, normalizeAiPricing, parseAiUsd } from '@wf/domain/ai';
import { formatUsd } from '../../lib/ai-usd.ts';
import { formatDate, formatPercent } from '@wf/i18n/format';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { ConfirmDialog } from '@wf/ui/confirm-dialog';
import { PageState } from '@wf/ui/page-state';
import { usePrivacy } from '@wf/ui/privacy';
import { Switch } from '@wf/ui/switch';
import { toast } from '@wf/ui/toast';
import { CircleAlert, Cloud, Lock } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { needsReauthentication } from '../../lib/auth-errors.ts';
import { aiErrorMessage } from '../../lib/ai-errors.ts';
import type { Result } from '../../server/access.ts';
import type { Viewer } from '../../server/gate.ts';
import {
  exportAiLogs,
  listAiLogs,
  listAiModels,
  removeAiKey,
  saveAiSettings,
  testAiConnection,
} from '../../server/fn/ai.ts';
import { Button, Field, FormError, Select, TextInput } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { useReauthentication } from './reauth.tsx';
import { SettingsGroup, SettingsRow } from './settings-ui.tsx';

const PAGE_SIZE = 20;
const INTL_LOCALE: Readonly<Record<Locale, string>> = { id: 'id-ID', en: 'en-US' };

const PROVIDER_LABEL: Readonly<Record<AiProvider, () => string>> = {
  openrouter: m.ai_provider_openrouter,
  zenmux: m.ai_provider_zenmux,
  custom: m.ai_provider_custom,
};

const PROVIDER_NOTE: Readonly<Record<AiProvider, () => string>> = {
  openrouter: m.ai_provider_openrouter_note,
  zenmux: m.ai_provider_zenmux_note,
  custom: m.ai_provider_custom_note,
};

const CONNECTION_STATUS: Readonly<Record<AiConnectionStatus, () => string>> = {
  not_connected: m.ai_status_not_connected,
  untested: m.ai_status_untested,
  connected: m.ai_status_connected,
  invalid_key: m.ai_status_invalid_key,
  error: m.ai_status_error,
};

const FEATURE_LABEL: Readonly<Record<AiFeature, () => string>> = {
  test: m.ai_feature_test,
  chat: m.ai_feature_chat,
  receipt: m.ai_feature_receipt,
  categorize: m.ai_feature_categorize,
  gmail: m.ai_feature_gmail,
};

const LOG_STATUS_LABEL: Readonly<Record<AiLogStatus, () => string>> = {
  pending: m.ai_log_status_pending,
  ok: m.ai_log_status_ok,
  error: m.ai_log_status_error,
  timeout: m.ai_log_status_timeout,
  blocked: m.ai_log_status_blocked,
};

const LOG_STATUS_TONE: Readonly<Record<AiLogStatus, string>> = {
  pending: 'text-muted-fg',
  ok: 'text-green-fg',
  error: 'text-red-fg',
  timeout: 'text-amber-fg',
  blocked: 'text-amber-fg',
};

const COST_SOURCE_LABEL: Readonly<Record<AiCostSource, () => string>> = {
  reported: m.ai_cost_source_reported,
  estimated: m.ai_cost_source_estimated,
  free: m.ai_cost_source_free,
  unknown: m.ai_cost_source_unknown,
};

const EMPTY_PRICING: AiPricing = {
  inputUsdPerMillion: '',
  outputUsdPerMillion: '',
  requestUsd: '',
  imageUsd: '',
};

const PRICING_FIELDS: readonly (readonly [keyof AiPricing, () => string])[] = [
  ['inputUsdPerMillion', m.ai_price_input],
  ['outputUsdPerMillion', m.ai_price_output],
  ['requestUsd', m.ai_price_request],
  ['imageUsd', m.ai_price_image],
];

interface Draft {
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  allowReadFinancial: boolean;
  allowCreateDrafts: boolean;
  monthlyLimitUsd: string;
  pricingMode: 'catalog' | 'manual';
  manual: AiPricing;
}

/** `0.0004` (subcent) must not become `$0.00`; whole dollars are grouped per locale. */
function formatCount(value: number, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale]).format(value);
}

function formatMonth(month: string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}

function timeOf(date: Date, locale: Locale, timeZone: string): string {
  const clock = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(date);
  const day = formatDate(date, locale, { year: false, timeZone });
  return day === formatDate(new Date(), locale, { year: false, timeZone }) ? clock : `${day} ${clock}`;
}

const MODEL_ID_PATTERN = /^[\w./:@+-]{1,200}$/;

function isValidUsd(value: string): boolean {
  try {
    parseAiUsd(value.trim());
    return true;
  } catch {
    return false;
  }
}

function sameBaseUrl(left: string, right: string): boolean {
  return left.replace(/\/+$/, '') === right.replace(/\/+$/, '');
}

/** The server's key rules: 4–512 characters, no whitespace, not the model ID. */
function newApiKeyError(apiKey: string, modelId: string): string | null {
  const key = apiKey.trim();
  if (key === '') return null;
  if (key.length < 4 || key.length > 512 || /\s/.test(key) || key === modelId.trim()) {
    return m.ai_api_key_invalid();
  }
  return null;
}

function draftFromView(view: AiSettingsView): Draft {
  const connection = view.connections.find((entry) => entry.provider === view.provider);
  return {
    provider: view.provider,
    baseUrl: connection?.baseUrl ?? '',
    apiKey: '',
    modelId: connection?.modelId ?? '',
    allowReadFinancial: view.allowReadFinancial,
    allowCreateDrafts: view.allowCreateDrafts,
    monthlyLimitUsd: view.monthlyLimitUsd,
    pricingMode: connection?.pricingSource === 'manual' ? 'manual' : 'catalog',
    manual: connection?.pricing ?? EMPTY_PRICING,
  };
}

/** The fields that make a draft dirty (the typed key is compared separately; irrelevant ones are left out). */
function comparable(draft: Draft): string {
  return JSON.stringify({
    provider: draft.provider,
    baseUrl: draft.provider === 'custom' ? draft.baseUrl : '',
    modelId: draft.modelId.trim(),
    allowReadFinancial: draft.allowReadFinancial,
    allowCreateDrafts: draft.allowCreateDrafts,
    monthlyLimitUsd: draft.monthlyLimitUsd.trim(),
    pricingMode: draft.pricingMode,
    pricing: draft.pricingMode === 'manual' ? draft.manual : null,
  });
}

function connectionText(connection: AiConnectionView): string {
  const http =
    connection.httpStatus === null ? '' : ` · ${m.ai_status_http({ status: String(connection.httpStatus) })}`;
  const code = connection.errorCode === null ? '' : ` · ${connection.errorCode}`;
  return `${CONNECTION_STATUS[connection.status]()}${http}${code}`;
}

function pricingText(pricing: AiPricing, locale: Locale, hidden: boolean, source: 'catalog' | 'manual'): string {
  return m.ai_price_summary({
    source: source === 'catalog' ? m.ai_pricing_catalog() : m.ai_pricing_manual(),
    input: formatUsd(pricing.inputUsdPerMillion, locale, hidden),
    output: formatUsd(pricing.outputUsdPerMillion, locale, hidden),
    request: formatUsd(pricing.requestUsd, locale, hidden),
    image: formatUsd(pricing.imageUsd, locale, hidden),
  });
}

interface AiFieldErrors {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  limit?: string;
  pricing?: string;
}

export interface AiSectionProps {
  readonly settings: AiSettingsView;
  /** For the re-authentication dialog a fresh session needs (FR-A9). */
  readonly viewer: Pick<Viewer, 'email' | 'sessionId'>;
  /** IANA time zone of the viewer (log times in their clock). */
  readonly timeZone: string;
}

export function AiSection({ settings, viewer, timeZone }: AiSectionProps) {
  const router = useRouter();
  const navigate = useNavigate();
  const { locale } = usePreferences().preferences;
  const { hidden, hiddenLabel } = usePrivacy();
  const { reauthenticate, dialog } = useReauthentication(viewer);
  const limitId = useId();
  const [view, setView] = useState(settings);
  const [draft, setDraft] = useState<Draft>(() => draftFromView(settings));
  const [mode, setMode] = useState<'settings' | 'logs'>('settings');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [twoFactorNotice, setTwoFactorNotice] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<AiFieldErrors>({});
  const [catalog, setCatalog] = useState<AiModelCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const catalogFor = useRef<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [lastTest, setLastTest] = useState<AiConnectionView | null>(null);
  /** The revision the "Hapus key" confirmation removes from; `null` while it is closed. */
  const [deleting, setDeleting] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const clearFieldError = (field: keyof AiFieldErrors) => {
    setFieldErrors((current) => {
      const { [field]: error, ...remaining } = current;
      return error === undefined ? current : remaining;
    });
  };

  const connectionOf = (provider: AiProvider) => view.connections.find((entry) => entry.provider === provider);
  const connection = connectionOf(draft.provider);
  const baseline = draftFromView(view);
  const dirty = draft.apiKey.trim() !== '' || comparable(draft) !== comparable(baseline);
  const limitInvalid = fieldErrors.limit ?? null;
  const pricingInvalid = fieldErrors.pricing ?? null;
  const apiKeyInvalid = fieldErrors.apiKey ?? newApiKeyError(draft.apiKey, draft.modelId);
  const modelInvalid =
    fieldErrors.model ??
    (draft.modelId.trim() !== '' && !MODEL_ID_PATTERN.test(draft.modelId.trim()) ? m.ai_model_invalid() : null);
  const customCatalogReady =
    draft.provider !== 'custom' ||
    (connection !== undefined &&
      connection.last4 !== null &&
      connection.modelId !== null &&
      sameBaseUrl(connection.baseUrl, draft.baseUrl));
  const busy = saving || testing || removing;
  const canSave = dirty && !busy && settings.twoFactorEnabled;

  const hasSavedKeyAndModel =
    connection !== undefined && connection.last4 !== null && connection.modelId !== null && connection.modelId !== '';
  const testDisabledReason = dirty
    ? m.ai_test_disabled_dirty()
    : view.revision === null
      ? m.ai_test_disabled_no_revision()
      : !hasSavedKeyAndModel
        ? m.ai_test_disabled_no_key()
        : null;
  /** The saved revision a test runs against; `null` while there is nothing saved to test. */
  const testRevision = !dirty && hasSavedKeyAndModel ? view.revision : null;
  const canTest = testRevision !== null && !busy && settings.twoFactorEnabled;

  const chooseProvider = (provider: AiProvider) => {
    const saved = connectionOf(provider);
    setDraft((current) => ({
      ...current,
      provider,
      baseUrl: provider === 'custom' ? (saved?.baseUrl ?? '') : '',
      apiKey: '',
      modelId: saved?.modelId ?? '',
      pricingMode: saved?.pricingSource === 'manual' ? 'manual' : 'catalog',
      manual: saved?.pricing ?? EMPTY_PRICING,
    }));
    catalogFor.current = null;
    setCatalog(null);
    setCatalogLoading(false);
    setCatalogError(null);
    setLastTest(null);
    setTestError(null);
    setSaveError(null);
    setFieldErrors({});
  };

  const resetDraft = () => {
    setDraft(draftFromView(view));
    setSaveError(null);
    setDeleteError(null);
    setFieldErrors({});
    setTestError(null);
    setLastTest(null);
  };

  const saveOnce = async (input: AiSettingsInput): Promise<Result<AiSettingsView> | null> => {
    const first = await saveAiSettings({ data: input }).catch(() => null);
    if (first === null || first.ok || !needsReauthentication(first.code)) return first;
    if (!(await reauthenticate())) return first;
    return saveAiSettings({ data: input }).catch(() => null);
  };

  const save = async () => {
    const errors: typeof fieldErrors = {};
    const modelId = draft.modelId.trim();
    if (modelId === '') errors.model = m.ai_model_required();
    else if (!MODEL_ID_PATTERN.test(modelId)) errors.model = m.ai_model_invalid();
    if (draft.provider === 'custom' && draft.baseUrl === '') {
      errors.baseUrl = m.ai_custom_base_url_required();
    } else if (
      draft.provider === 'custom' &&
      connection?.last4 != null &&
      draft.apiKey.trim() === '' &&
      !sameBaseUrl(connection.baseUrl, draft.baseUrl)
    ) {
      errors.baseUrl = m.ai_custom_base_url_key_required();
    }
    const apiKeyError = newApiKeyError(draft.apiKey, draft.modelId);
    if (apiKeyError !== null) errors.apiKey = apiKeyError;
    if (!isValidUsd(draft.monthlyLimitUsd)) errors.limit = m.ai_monthly_limit_invalid();
    if (draft.pricingMode === 'manual' && !PRICING_FIELDS.every(([field]) => isValidUsd(draft.manual[field]))) {
      errors.pricing = m.ai_price_invalid();
    }
    setFieldErrors(errors);
    setSaveError(null);
    if (Object.keys(errors).length > 0) return;
    const input: AiSettingsInput = {
      expectedRevision: view.revision,
      provider: draft.provider,
      modelId: draft.modelId.trim(),
      allowReadFinancial: draft.allowReadFinancial,
      allowCreateDrafts: draft.allowCreateDrafts,
      requireConfirmation: true,
      monthlyLimitUsd: draft.monthlyLimitUsd.trim(),
      pricing: draft.pricingMode === 'manual' ? normalizeAiPricing(draft.manual) : null,
    };
    if (draft.provider === 'custom') input.baseUrl = draft.baseUrl;
    if (draft.apiKey.trim() !== '') input.apiKey = draft.apiKey.trim();
    setSaving(true);
    const result = await saveOnce(input);
    setSaving(false);
    if (result === null) {
      setTwoFactorNotice(false);
      setSaveError(m.error_network());
      return;
    }
    if (!result.ok) {
      setSaveError(aiErrorMessage(result.code, locale));
      setTwoFactorNotice(result.code === 'TWO_FACTOR_REQUIRED');
      return;
    }
    setTwoFactorNotice(false);
    setFieldErrors({});
    setLastTest(null);
    setView(result.value);
    setDraft(draftFromView(result.value));
    toast({ tone: 'success', title: m.ai_saved() });
    void router.invalidate();
  };

  const remove = async (expectedRevision: string) => {
    setRemoving(true);
    setDeleting(null);
    setDeleteError(null);
    const first = await removeAiKey({
      data: { provider: draft.provider, expectedRevision },
    }).catch(() => null);
    let result = first;
    if (result !== null && !result.ok && needsReauthentication(result.code) && (await reauthenticate())) {
      result = await removeAiKey({
        data: { provider: draft.provider, expectedRevision },
      }).catch(() => null);
    }
    setRemoving(false);
    if (result === null) {
      setDeleteError(m.error_network());
      return;
    }
    if (!result.ok) {
      setDeleteError(aiErrorMessage(result.code, locale));
      return;
    }
    setView(result.value);
    setDraft(draftFromView(result.value));
    setLastTest(null);
    toast({ tone: 'success', title: m.ai_deleted({ provider: PROVIDER_LABEL[draft.provider]() }) });
    void router.invalidate();
  };

  const runTest = async (expectedRevision: string) => {
    setTesting(true);
    setTestError(null);
    setLastTest(null);
    const data: AiConnectionTestInput = {
      provider: draft.provider,
      expectedRevision,
      requestId: crypto.randomUUID(),
    };
    let result = await testAiConnection({ data }).catch(() => null);
    // Reauthentication is a pre-egress refusal, not a provider retry. Reuse the same request id.
    if (result !== null && !result.ok && needsReauthentication(result.code) && (await reauthenticate())) {
      result = await testAiConnection({ data }).catch(() => null);
    }
    setTesting(false);
    if (result === null) {
      setTestError(m.error_network());
      return;
    }
    if (!result.ok) {
      setTestError(aiErrorMessage(result.code, locale));
      return;
    }
    const { connection: tested, usage } = result.value;
    setView((current) => ({
      ...current,
      connections: [...current.connections.filter((entry) => entry.provider !== tested.provider), tested],
      usage,
    }));
    setLastTest(tested);
  };

  const loadModels = async () => {
    const key = `${draft.provider}:${draft.provider === 'custom' ? draft.baseUrl : ''}`;
    catalogFor.current = key;
    setCatalogLoading(true);
    setCatalogError(null);
    const data = {
      provider: draft.provider,
      ...(draft.provider === 'custom' ? { baseUrl: draft.baseUrl } : {}),
    };
    let result = await listAiModels({ data }).catch(() => null);
    if (catalogFor.current !== key) return;
    if (result !== null && !result.ok && needsReauthentication(result.code) && (await reauthenticate())) {
      if (catalogFor.current !== key) return;
      result = await listAiModels({ data }).catch(() => null);
    }
    if (catalogFor.current !== key) return;
    setCatalogLoading(false);
    if (result === null) {
      setCatalogError('NETWORK');
      return;
    }
    if (!result.ok) {
      setCatalogError(result.code);
      setTwoFactorNotice(result.code === 'TWO_FACTOR_REQUIRED');
      return;
    }
    setTwoFactorNotice(false);
    setCatalog(result.value);
  };

  const selectModel = (modelId: string) => {
    const model = catalog?.models.find((entry) => entry.id === modelId);
    setDraft((current) => ({
      ...current,
      modelId,
      ...(model?.pricing === null && current.pricingMode === 'catalog' ? { pricingMode: 'manual' as const } : {}),
    }));
  };

  const testNotice =
    dirty || lastTest === null
      ? null
      : lastTest.status === 'connected'
        ? m.ai_test_connected()
        : connectionText(lastTest);
  const month = formatMonth(view.usage.month, locale);
  const selectedModel = catalog?.models.find((entry) => entry.id === draft.modelId) ?? null;

  if (mode === 'logs') {
    return (
      <AiLogPanel
        timeZone={timeZone}
        usage={view.usage}
        onBack={() => {
          setMode('settings');
        }}
      />
    );
  }

  return (
    <>
      <fieldset disabled={busy} className="contents">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              catalogFor.current = null;
              setCatalogLoading(false);
              setMode('logs');
            }}
          >
            {m.ai_open_log()}
          </Button>
        </div>
        {!settings.twoFactorEnabled || twoFactorNotice ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-[9px] border border-amber-tint-3 bg-amber-tint-1 px-3.5 py-2.5 text-[12.5px] text-fg"
          >
            <span>{m.ai_two_factor_required()}</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void navigate({
                  to: '.',
                  search: (previous: object) => ({ ...previous, settings: 'security' as const }),
                  state: true,
                  replace: true,
                })
              }
            >
              {m.ai_two_factor_action()}
            </Button>
          </div>
        ) : null}
        {saveError === null ? null : <FormError>{saveError}</FormError>}
        {deleteError === null ? null : <FormError>{deleteError}</FormError>}

        <section aria-labelledby="ai-providers-title" className="flex flex-col gap-2">
          <div className="flex min-h-[26px] items-center">
            <h3 id="ai-providers-title" className="text-[11px] font-medium text-subtle uppercase">
              {m.ai_provider_group()}
            </h3>
          </div>
          <div role="group" aria-labelledby="ai-providers-title" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {AI_PROVIDERS.map((provider) => {
              const saved = connectionOf(provider);
              const disabled = provider === 'custom' && view.allowedCustomBaseUrls.length === 0;
              return (
                <button
                  key={provider}
                  type="button"
                  disabled={disabled}
                  aria-pressed={draft.provider === provider}
                  data-provider-chip={provider}
                  title={disabled ? m.ai_custom_no_origins() : undefined}
                  onClick={() => {
                    chooseProvider(provider);
                  }}
                  className="flex min-w-0 flex-col items-start gap-0.5 rounded-[9px] border border-border px-3 py-2 text-left text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:border-fg aria-pressed:bg-muted disabled:opacity-50"
                >
                  <span className="text-[13px] font-medium">{PROVIDER_LABEL[provider]()}</span>
                  <span className="text-[11.5px] text-subtle">{PROVIDER_NOTE[provider]()}</span>
                  <span className="text-[11.5px] text-muted-fg">
                    {saved === undefined ? m.ai_not_connected() : CONNECTION_STATUS[saved.status]()}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <div className="contents" data-provider={draft.provider}>
          <SettingsGroup label={m.ai_connection_label({ provider: PROVIDER_LABEL[draft.provider]() })}>
            {connection === undefined ? (
              <SettingsRow title={m.ai_not_connected()} description={m.ai_no_key()} />
            ) : (
              <SettingsRow
                title={connection.last4 === null ? m.ai_no_key() : m.ai_key_masked({ last4: connection.last4 })}
                description={[
                  connectionText(connection),
                  ...(connection.addedAt === null
                    ? []
                    : [m.ai_added_at({ date: formatDate(connection.addedAt, locale, { timeZone }) })]),
                  ...(connection.testedAt === null
                    ? []
                    : [m.ai_tested_at({ date: formatDate(connection.testedAt, locale, { timeZone }) })]),
                ].join(' · ')}
              >
                {connection.last4 === null ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={view.revision === null}
                    onClick={() => {
                      setDeleting(view.revision);
                    }}
                  >
                    {m.ai_delete_key()}
                  </Button>
                )}
              </SettingsRow>
            )}
            <div className="flex flex-col gap-3 px-3.5 py-3">
              <Field label={m.ai_api_key()} hint={m.ai_api_key_hint()} error={apiKeyInvalid}>
                {({ id, describedBy, invalid }) => (
                  <TextInput
                    id={id}
                    size="sm"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    placeholder={m.ai_api_key_placeholder()}
                    value={draft.apiKey}
                    onChange={(event) => {
                      const apiKey = event.currentTarget.value;
                      setDraft((current) => ({ ...current, apiKey }));
                      clearFieldError('apiKey');
                    }}
                  />
                )}
              </Field>
              {draft.provider === 'custom' ? (
                <Field
                  label={m.ai_custom_base_url()}
                  hint={m.ai_custom_base_url_hint()}
                  error={fieldErrors.baseUrl ?? null}
                >
                  {({ id, describedBy }) =>
                    view.allowedCustomBaseUrls.length === 0 ? (
                      <Select id={id} size="sm" defaultValue="" disabled>
                        <option value="">{m.ai_custom_no_origins()}</option>
                      </Select>
                    ) : (
                      <Select
                        id={id}
                        size="sm"
                        aria-describedby={describedBy}
                        value={draft.baseUrl}
                        onChange={(event) => {
                          const baseUrl = event.currentTarget.value;
                          setDraft((current) => ({ ...current, baseUrl }));
                          clearFieldError('baseUrl');
                          catalogFor.current = null;
                          setCatalog(null);
                          setCatalogLoading(false);
                        }}
                      >
                        <option value="">{m.ai_custom_base_url_placeholder()}</option>
                        {view.allowedCustomBaseUrls.map((origin) => (
                          <option key={origin} value={origin}>
                            {origin}
                          </option>
                        ))}
                      </Select>
                    )
                  }
                </Field>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <Field label={m.ai_model()}>
                    {({ id, describedBy }) => (
                      <Select
                        id={id}
                        size="sm"
                        aria-describedby={describedBy}
                        value={
                          catalog?.models.some((entry) => entry.id === draft.modelId) === true ? draft.modelId : ''
                        }
                        onChange={(event) => {
                          selectModel(event.currentTarget.value);
                        }}
                      >
                        <option value="">{m.ai_model_placeholder()}</option>
                        {(catalog?.models ?? []).map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  pending={catalogLoading}
                  disabled={!customCatalogReady}
                  onClick={() => void loadModels()}
                >
                  {catalogLoading ? m.ai_loading_models() : m.ai_load_models()}
                </Button>
              </div>
              <Field label={m.ai_model_manual()} hint={m.ai_catalog_public()} error={modelInvalid}>
                {({ id, describedBy, invalid }) => (
                  <TextInput
                    id={id}
                    size="sm"
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    value={draft.modelId}
                    onChange={(event) => {
                      const modelId = event.currentTarget.value;
                      setDraft((current) => ({ ...current, modelId }));
                      clearFieldError('model');
                    }}
                  />
                )}
              </Field>
              {draft.provider === 'custom' && !customCatalogReady ? (
                <p className="text-[12px] text-subtle">{m.ai_custom_models_need_save()}</p>
              ) : null}
              {catalogError === null ? null : (
                <div className="flex flex-wrap items-center gap-2">
                  <FormError>
                    {m.ai_models_failed()}{' '}
                    {catalogError === 'NETWORK' ? m.error_network() : aiErrorMessage(catalogError, locale)}
                  </FormError>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!customCatalogReady}
                    onClick={() => void loadModels()}
                  >
                    {m.ai_log_retry()}
                  </Button>
                </div>
              )}
              {catalog === null ? null : catalog.models.length === 0 ? (
                <p className="text-[12px] text-subtle">{m.ai_models_empty()}</p>
              ) : (
                <p className="text-[12px] text-subtle">
                  {m.ai_models_loaded({ count: formatCount(catalog.models.length, locale) })}
                </p>
              )}
              {selectedModel === null ? null : selectedModel.pricing === null ? (
                <p className="text-[12px] text-amber-fg">{m.ai_model_no_pricing()}</p>
              ) : (
                <>
                  <p className="text-[12px] text-subtle">
                    {pricingText(selectedModel.pricing, locale, hidden, 'catalog')}
                  </p>
                  {selectedModel.contextLength === null ? null : (
                    <p className="text-[12px] text-subtle">
                      {m.ai_model_context({ count: formatCount(selectedModel.contextLength, locale) })}
                    </p>
                  )}
                </>
              )}
            </div>
            <fieldset className="flex flex-col gap-2 px-3.5 py-3">
              <legend className="text-[12.5px] font-medium text-muted-fg">{m.ai_pricing_mode()}</legend>
              <div className="flex flex-wrap gap-4">
                {(
                  [
                    ['catalog', m.ai_pricing_catalog],
                    ['manual', m.ai_pricing_manual],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-1.5 text-[12.5px] text-fg">
                    <input
                      type="radio"
                      name="ai-pricing-mode"
                      value={value}
                      checked={draft.pricingMode === value}
                      onChange={() => {
                        setDraft((current) => ({ ...current, pricingMode: value }));
                        clearFieldError('pricing');
                      }}
                    />
                    {label()}
                  </label>
                ))}
              </div>
              <p className="text-[12px] text-subtle">
                {draft.pricingMode === 'catalog' ? m.ai_pricing_catalog_note() : m.ai_pricing_note()}
              </p>
              {connection?.pricing != null && connection.pricingSource !== null ? (
                <p className="text-[12px] text-muted-fg">
                  {pricingText(connection.pricing, locale, hidden, connection.pricingSource)}
                </p>
              ) : null}
              {draft.pricingMode === 'manual' ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {PRICING_FIELDS.map(([field, label]) => (
                    <Field
                      key={field}
                      label={label()}
                      error={
                        draft.manual[field].trim() !== '' && !isValidUsd(draft.manual[field])
                          ? m.ai_price_invalid()
                          : null
                      }
                    >
                      {({ id, describedBy, invalid }) => (
                        <TextInput
                          id={id}
                          size="sm"
                          inputMode="decimal"
                          autoComplete="off"
                          aria-describedby={describedBy}
                          aria-invalid={invalid}
                          value={draft.manual[field]}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setDraft((current) => ({
                              ...current,
                              manual: { ...current.manual, [field]: value },
                            }));
                            clearFieldError('pricing');
                          }}
                        />
                      )}
                    </Field>
                  ))}
                </div>
              ) : null}
              {pricingInvalid === null ? null : <FormError>{pricingInvalid}</FormError>}
            </fieldset>
          </SettingsGroup>

          <SettingsGroup label={m.ai_permissions()}>
            <div className="px-3.5 py-2.5">
              <Switch
                label={m.ai_permission_read()}
                description={m.ai_permission_read_hint()}
                checked={draft.allowReadFinancial}
                onChange={(event) => {
                  const allowReadFinancial = event.currentTarget.checked;
                  setDraft((current) => ({ ...current, allowReadFinancial }));
                }}
              />
            </div>
            <div className="px-3.5 py-2.5">
              <Switch
                label={m.ai_permission_drafts()}
                description={m.ai_permission_drafts_hint()}
                checked={draft.allowCreateDrafts}
                onChange={(event) => {
                  const allowCreateDrafts = event.currentTarget.checked;
                  setDraft((current) => ({ ...current, allowCreateDrafts }));
                }}
              />
            </div>
            <div className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <Switch
                  label={
                    <span className="flex items-center gap-1.5">
                      {m.ai_permission_confirm()}
                      <Lock aria-hidden="true" className="size-3 text-subtle" />
                    </span>
                  }
                  description={m.ai_permission_confirm_hint()}
                  checked
                  readOnly
                  disabled
                />
              </div>
            </div>
          </SettingsGroup>

          <SettingsGroup label={m.ai_cost_title()}>
            <SettingsRow
              title={<label htmlFor={limitId}>{m.ai_monthly_limit()}</label>}
              description={m.ai_monthly_limit_hint()}
            >
              <div className="w-32 shrink-0">
                <TextInput
                  id={limitId}
                  size="sm"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-invalid={limitInvalid !== null}
                  value={draft.monthlyLimitUsd}
                  onChange={(event) => {
                    const monthlyLimitUsd = event.currentTarget.value;
                    setDraft((current) => ({ ...current, monthlyLimitUsd }));
                    clearFieldError('limit');
                  }}
                />
              </div>
            </SettingsRow>
            {limitInvalid === null ? null : (
              <div className="px-3.5 pb-2">
                <FormError>{limitInvalid}</FormError>
              </div>
            )}
            <div className="flex flex-col gap-1 px-3.5 py-3 text-[12.5px] text-fg">
              <p className="font-medium">{m.ai_usage_month({ month })}</p>
              <p className="text-muted-fg">
                {m.ai_usage_requests({ count: formatCount(view.usage.requests, locale) })}
              </p>
              <p className="text-muted-fg">
                {m.ai_usage_spent({
                  spent: formatUsd(view.usage.spentUsd, locale, hidden),
                  limit: formatUsd(view.usage.limitUsd, locale, hidden),
                })}
              </p>
              <p className="text-subtle">
                {m.ai_usage_estimated({ amount: formatUsd(view.usage.estimatedUsd, locale, hidden) })}
              </p>
              <p className="text-subtle">
                {m.ai_usage_reserved({ amount: formatUsd(view.usage.reservedUsd, locale, hidden) })}
              </p>
              <p className="text-subtle">{m.ai_cost_warning()}</p>
              <p className="text-subtle">{m.ai_cost_unknown_warning()}</p>
              {hidden ? <span className="sr-only">{hiddenLabel}</span> : null}
            </div>
          </SettingsGroup>

          <SettingsGroup label={m.ai_test()}>
            <div className="flex flex-col gap-2 px-3.5 py-3">
              <p className="text-[12.5px] text-muted-fg">{m.ai_test_description()}</p>
              {testDisabledReason === null ? null : <p className="text-[12px] text-subtle">{testDisabledReason}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  pending={testing}
                  disabled={!canTest}
                  onClick={testRevision === null ? undefined : () => void runTest(testRevision)}
                >
                  {testing ? m.ai_testing() : m.ai_test()}
                </Button>
                <span role="status" className="min-h-[18px] text-[12px] text-muted-fg">
                  {testNotice}
                </span>
              </div>
              {testError === null ? null : (
                <FormError>
                  {m.ai_test_failed()} {testError}
                </FormError>
              )}
            </div>
          </SettingsGroup>
        </div>

        {/* Sticky edges sit inside the scroller's 22px padding, so `-bottom-[22px]` puts the bar on the dialog's edge;
            `mt-auto` keeps it there when the section is shorter than the dialog. */}
        <footer className="sticky -bottom-[22px] z-10 -mx-7 mt-auto -mb-[22px] flex flex-wrap items-center gap-2 border-t border-border bg-dialog px-7 py-3">
          <span
            role="status"
            className={`flex flex-1 items-center gap-1.5 text-[12px] ${dirty ? 'text-amber-fg' : 'text-subtle'}`}
          >
            {dirty ? (
              <CircleAlert aria-hidden="true" className="size-3.5" />
            ) : (
              <Cloud aria-hidden="true" className="size-3.5" />
            )}
            <span className="min-h-[18px]">{dirty ? m.settings_unsaved() : m.settings_synced()}</span>
          </span>
          <Button variant="secondary" size="sm" disabled={!dirty || saving} onClick={resetDraft}>
            {m.settings_cancel()}
          </Button>
          <Button size="sm" disabled={!canSave} pending={saving} onClick={() => void save()}>
            {m.settings_save()}
          </Button>
        </footer>
      </fieldset>

      {deleting === null ? null : (
        <ConfirmDialog
          open
          onOpenChange={() => {
            setDeleting(null);
          }}
          title={m.ai_delete_title({ provider: PROVIDER_LABEL[draft.provider]() })}
          description={m.ai_delete_description()}
          impact={m.ai_delete_impact()}
          confirmLabel={m.ai_delete_key()}
          cancelLabel={m.settings_cancel()}
          variant="destructive"
          onConfirm={() => {
            void remove(deleting);
          }}
        />
      )}
      {dialog}
    </>
  );
}

function AiLogPanel({
  usage,
  timeZone,
  onBack,
}: {
  readonly usage: AiUsageSummary;
  readonly timeZone: string;
  readonly onBack: () => void;
}) {
  const { locale } = usePreferences().preferences;
  const { hidden, hiddenLabel } = usePrivacy();
  const [feature, setFeature] = useState<AiFeature | ''>('');
  const [status, setStatus] = useState<AiLogStatus | ''>('');
  const [page, setPage] = useState(0);
  const [logs, setLogs] = useState<Result<AiLogsPage> | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const month = formatMonth(usage.month, locale);

  useEffect(() => {
    let cancelled = false;
    const data = {
      ...(feature === '' ? {} : { feature }),
      ...(status === '' ? {} : { status }),
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE,
    };
    void listAiLogs({ data })
      .then((result) => {
        if (cancelled) return;
        setLogs(result);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLogs({ ok: false, code: 'NETWORK' });
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [feature, status, page, reload]);

  const exportCsv = async () => {
    setExporting(true);
    setExportError(false);
    const result = await exportAiLogs({
      data: {
        ...(feature === '' ? {} : { feature }),
        ...(status === '' ? {} : { status }),
      },
    }).catch(() => null);
    setExporting(false);
    if (result?.ok !== true) {
      setExportError(true);
      return;
    }
    const url = URL.createObjectURL(new Blob([result.value.csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = result.value.fileName;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const pageData = logs !== null && logs.ok ? logs.value : null;
  const items = pageData?.items ?? [];
  const total = pageData?.total ?? 0;
  const lastPage = (page + 1) * PAGE_SIZE >= total;
  const failedRatio = pageData !== null && total > 0 ? pageData.failed / total : null;

  return (
    <section aria-labelledby="ai-log-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}>
          {m.ai_back()}
        </Button>
        <Button size="sm" variant="secondary" pending={exporting} onClick={() => void exportCsv()}>
          {exporting ? m.ai_log_exporting() : m.ai_log_export()}
        </Button>
      </div>
      <div className="flex flex-col gap-0.5">
        <h3 id="ai-log-title" className="text-[14px] font-semibold text-fg">
          {m.ai_log_title()}
        </h3>
        <p className="text-[12px] text-subtle">{m.ai_log_subtitle()}</p>
        <p className="text-[12px] text-muted-fg">{m.ai_log_privacy()}</p>
      </div>
      <section
        aria-label={m.ai_usage_month({ month })}
        className="flex flex-col gap-1 rounded-[10px] border border-border bg-surface-sunken px-3.5 py-3 text-[12.5px]"
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <p>
            <span className="block text-[11px] font-medium text-subtle uppercase">{m.ai_log_requests({ month })}</span>
            <span className="font-mono text-fg">{formatCount(usage.requests, locale)}</span>
          </p>
          <p>
            <span className="block text-[11px] font-medium text-subtle uppercase">{m.ai_log_cost({ month })}</span>
            <span className="font-mono text-fg">
              {formatUsd(usage.spentUsd, locale, hidden)} / {formatUsd(usage.limitUsd, locale, hidden)}
            </span>
          </p>
        </div>
        <p className="text-subtle">{m.ai_usage_estimated({ amount: formatUsd(usage.estimatedUsd, locale, hidden) })}</p>
        <p className="text-subtle">{m.ai_usage_reserved({ amount: formatUsd(usage.reservedUsd, locale, hidden) })}</p>
        <p className="min-h-[18px] text-subtle">
          {failedRatio === null ? null : m.ai_log_failed_summary({ percent: formatPercent(failedRatio, locale) })}
        </p>
        <p className="text-subtle">{m.ai_cost_warning()}</p>
        {hidden ? <span className="sr-only">{hiddenLabel}</span> : null}
      </section>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-[12px] text-subtle">
          {m.ai_log_feature_filter()}
          <Select
            size="sm"
            value={feature}
            onChange={(event) => {
              setLoading(true);
              setFeature(event.currentTarget.value as AiFeature | '');
              setPage(0);
              setExpanded(null);
            }}
          >
            <option value="">{m.ai_log_all_features()}</option>
            {AI_FEATURES.map((value) => (
              <option key={value} value={value}>
                {FEATURE_LABEL[value]()}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-subtle">
          {m.ai_log_status_filter()}
          <Select
            size="sm"
            value={status}
            onChange={(event) => {
              setLoading(true);
              setStatus(event.currentTarget.value as AiLogStatus | '');
              setPage(0);
              setExpanded(null);
            }}
          >
            <option value="">{m.ai_log_all_statuses()}</option>
            {AI_LOG_STATUSES.map((value) => (
              <option key={value} value={value}>
                {LOG_STATUS_LABEL[value]()}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div className="h-5">
        {loading && logs !== null ? <PageState kind="refreshing" title={m.ai_log_loading()} /> : null}
      </div>
      {exportError ? <FormError>{m.ai_log_export_failed()}</FormError> : null}
      <div className="flex min-h-[260px] flex-col gap-2">
        {logs === null ? (
          <PageState kind="loading" title={m.ai_log_loading()} />
        ) : !logs.ok ? (
          <div className="flex flex-col items-start gap-2">
            <FormError>{m.ai_log_failed()}</FormError>
            <p className="text-[12.5px] text-muted-fg">{aiErrorMessage(logs.code, locale)}</p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setLoading(true);
                setReload((current) => current + 1);
              }}
            >
              {m.ai_log_retry()}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <PageState kind="empty" title={m.ai_log_empty()} />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-[10px] border border-border">
            {items.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 px-3.5 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-[86px] shrink-0 font-mono text-[11.5px] text-subtle">
                    {timeOf(entry.createdAt, locale, timeZone)}
                  </span>
                  <span className="text-[12.5px] font-medium text-fg">{FEATURE_LABEL[entry.feature]()}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-muted-fg">
                    {entry.modelId === null ? m.ai_log_detail_none() : entry.modelId}
                  </span>
                  <span className={`text-[12px] font-medium ${LOG_STATUS_TONE[entry.status]}`}>
                    {LOG_STATUS_LABEL[entry.status]()}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-subtle">
                  <span className="font-mono">
                    {entry.inputTokens === null ? m.ai_log_detail_none() : formatCount(entry.inputTokens, locale)}
                    {' → '}
                    {entry.outputTokens === null ? m.ai_log_detail_none() : formatCount(entry.outputTokens, locale)}
                  </span>
                  <span className="font-mono">
                    {entry.costUsd === null ? m.ai_log_detail_none() : formatUsd(entry.costUsd, locale, hidden)}
                  </span>
                  <span className="font-mono">
                    {m.ai_duration_ms({ value: formatCount(entry.durationMs, locale) })}
                  </span>
                  <button
                    type="button"
                    aria-expanded={expanded === entry.id}
                    aria-controls={`ai-log-detail-${entry.id}`}
                    aria-label={
                      expanded === entry.id
                        ? m.ai_log_hide_detail({ feature: FEATURE_LABEL[entry.feature]() })
                        : m.ai_log_show_detail({ feature: FEATURE_LABEL[entry.feature]() })
                    }
                    className="font-medium text-blue-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    onClick={() => {
                      setExpanded((current) => (current === entry.id ? null : entry.id));
                    }}
                  >
                    {m.ai_log_detail()}
                  </button>
                </div>
                {expanded === entry.id ? <AiLogDetail entry={entry} locale={locale} hidden={hidden} /> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      {logs?.ok !== true || (items.length === 0 && page === 0) ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={page === 0 || loading}
            onClick={() => {
              setLoading(true);
              setPage((current) => Math.max(0, current - 1));
            }}
          >
            {m.ai_log_prev()}
          </Button>
          <span className="text-[12px] text-subtle">
            {m.ai_log_page({ shown: formatCount(items.length, locale), total: formatCount(total, locale) })}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={lastPage || loading}
            onClick={() => {
              setLoading(true);
              setPage((current) => current + 1);
            }}
          >
            {m.ai_log_next()}
          </Button>
        </div>
      )}
    </section>
  );
}

function AiLogDetail({
  entry,
  locale,
  hidden,
}: {
  readonly entry: AiLogView;
  readonly locale: Locale;
  readonly hidden: boolean;
}) {
  const dataSent =
    entry.dataSent.images + entry.dataSent.categories + entry.dataSent.accounts + entry.dataSent.transactions;
  return (
    <dl
      id={`ai-log-detail-${entry.id}`}
      className="mt-1 grid grid-cols-[minmax(0,9rem)_1fr] gap-x-3 gap-y-1 rounded-[6px] bg-surface-3 px-3 py-2 text-[12px]"
    >
      <dt className="text-subtle">{m.ai_log_detail_provider()}</dt>
      <dd className="min-w-0 break-words text-fg">{PROVIDER_LABEL[entry.provider]()}</dd>
      <dt className="text-subtle">{m.ai_log_detail_model()}</dt>
      <dd className="min-w-0 break-words font-mono text-fg">
        {entry.modelId === null ? m.ai_log_detail_none() : entry.modelId}
      </dd>
      <dt className="text-subtle">{m.ai_log_detail_tokens()}</dt>
      <dd className="font-mono text-fg">
        {entry.inputTokens === null ? m.ai_log_detail_none() : formatCount(entry.inputTokens, locale)}
        {' → '}
        {entry.outputTokens === null ? m.ai_log_detail_none() : formatCount(entry.outputTokens, locale)}
      </dd>
      <dt className="text-subtle">{m.ai_log_cost_col()}</dt>
      <dd className="font-mono text-fg">
        {entry.costUsd === null ? m.ai_log_detail_none() : formatUsd(entry.costUsd, locale, hidden)}
      </dd>
      <dt className="text-subtle">{m.ai_log_detail_cost_source()}</dt>
      <dd className="text-fg">{COST_SOURCE_LABEL[entry.costSource]()}</dd>
      <dt className="text-subtle">{m.ai_log_detail_duration()}</dt>
      <dd className="font-mono text-fg">{m.ai_duration_ms({ value: formatCount(entry.durationMs, locale) })}</dd>
      <dt className="text-subtle">{m.ai_log_status()}</dt>
      <dd className="text-fg">{LOG_STATUS_LABEL[entry.status]()}</dd>
      <dt className="text-subtle">{m.ai_log_detail_http()}</dt>
      <dd className="font-mono text-fg">
        {entry.httpStatus === null ? m.ai_log_detail_none() : m.ai_status_http({ status: String(entry.httpStatus) })}
      </dd>
      <dt className="text-subtle">{m.ai_log_detail_data()}</dt>
      <dd className="break-words text-fg">
        {dataSent === 0
          ? m.ai_log_data_none()
          : m.ai_log_data_counts({
              images: formatCount(entry.dataSent.images, locale),
              categories: formatCount(entry.dataSent.categories, locale),
              accounts: formatCount(entry.dataSent.accounts, locale),
              transactions: formatCount(entry.dataSent.transactions, locale),
            })}
      </dd>
      <dt className="text-subtle">{m.ai_log_detail_tools()}</dt>
      <dd className="break-words text-fg">
        {entry.toolCalls.length === 0 ? m.ai_log_detail_none() : entry.toolCalls.join(', ')}
      </dd>
      <dt className="text-subtle">{m.ai_log_detail_error()}</dt>
      <dd className="break-words font-mono text-fg">
        {entry.errorCode === null ? m.ai_log_detail_none() : entry.errorCode}
      </dd>
    </dl>
  );
}
