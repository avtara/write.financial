// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The instance settings (FR-OP1): name, public URL, default language and time zone, registration mode, and the
 * optional SMTP server with a test email. Used by the setup wizard's last step and Settings › Instans. The stored
 * SMTP password never comes back: the field starts empty and only replaces it when something is typed.
 */
import { m } from '@wf/i18n/messages';
import { LOCALES, type Locale } from '@wf/i18n/locale';
import { SecretInput } from '@wf/ui/secret-input';
import { useState } from 'react';
import type { Result } from '../server/access.ts';
import type { InstanceDraft, InstanceInput, SmtpInput } from '../server/setup.ts';
import { Button, Checkbox, Field, FormError, FormNotice, Select, TextInput } from './form.tsx';
import { usePreferences } from './preferences.tsx';
import { resultMessage, type Failure } from './setup/result.ts';

type RegistrationMode = InstanceInput['registrationMode'];

const LOCALE_LABEL: Readonly<Record<Locale, () => string>> = {
  id: m.language_name_id,
  en: m.language_name_en,
};

/** A language choice (instance default, invitation email). */
export function LocaleSelect({
  id,
  name,
  value,
  onChange,
}: {
  id: string;
  name: string;
  value: Locale;
  onChange: (locale: Locale) => void;
}) {
  return (
    <Select
      id={id}
      name={name}
      value={value}
      onChange={(event) => {
        onChange(LOCALES.find((locale) => locale === event.target.value) ?? value);
      }}
    >
      {LOCALES.map((locale) => (
        <option key={locale} value={locale}>
          {LOCALE_LABEL[locale]()}
        </option>
      ))}
    </Select>
  );
}

const REGISTRATION: readonly { mode: RegistrationMode; label: () => string; hint: () => string }[] = [
  { mode: 'closed', label: m.instance_registration_closed, hint: m.instance_registration_closed_hint },
  { mode: 'invite', label: m.instance_registration_invite, hint: m.instance_registration_invite_hint },
  { mode: 'open', label: m.instance_registration_open, hint: m.instance_registration_open_hint },
];

/** The server's checks (`smtpInput`, `instanceInput`), so a typo is marked at its field instead of failing the call. */
const HOST = /^[A-Za-z0-9.:-]+$/;
const MAILBOX = /^(?:[^<>]*<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/;

interface Values {
  instanceName: string;
  publicUrl: string;
  defaultLocale: Locale;
  defaultTimezone: string;
  registrationMode: RegistrationMode;
  smtpEnabled: boolean;
  host: string;
  port: string;
  secure: boolean;
  username: string;
  password: string;
  from: string;
}

type Errors = Partial<Record<'instanceName' | 'publicUrl' | 'host' | 'port' | 'from', string>>;

function smtpErrors(values: Values): Errors {
  const errors: Errors = {};
  if (!HOST.test(values.host.trim())) errors.host = m.instance_smtp_host_invalid();
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) errors.port = m.instance_smtp_port_invalid();
  if (!MAILBOX.test(values.from.trim())) errors.from = m.instance_smtp_from_invalid();
  return errors;
}

function formErrors(values: Values): Errors {
  const errors: Errors = values.smtpEnabled ? smtpErrors(values) : {};
  if (values.instanceName.trim() === '') errors.instanceName = m.instance_name_required();
  const url = URL.parse(values.publicUrl.trim());
  if (url === null || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    errors.publicUrl = m.instance_public_url_invalid();
  }
  return errors;
}

/** Without a username there is no login, so a stored password is removed; a typed one replaces it. */
function toSmtp(values: Values): SmtpInput {
  const username = values.username.trim();
  const smtp = {
    host: values.host.trim(),
    port: Number(values.port),
    secure: values.secure,
    username: username === '' ? null : username,
    from: values.from.trim(),
  };
  if (values.password !== '') return { ...smtp, password: values.password };
  return username === '' ? { ...smtp, password: null } : smtp;
}

type Outcome = { ok: true } | Failure | null;

function OutcomeNote({ outcome, success }: { outcome: Outcome; success: string }) {
  const { preferences } = usePreferences();
  if (outcome === null) return null;
  return outcome.ok ? (
    <FormNotice>{success}</FormNotice>
  ) : (
    <FormError>{resultMessage(outcome, preferences.locale)}</FormError>
  );
}

export interface InstanceFormProps {
  draft: InstanceDraft;
  onSave: (input: InstanceInput) => Promise<Result<null>>;
  onTestEmail: (smtp: SmtpInput) => Promise<Result<null>>;
  submitLabel: string;
}

export function InstanceForm({ draft, onSave, onTestEmail, submitLabel }: InstanceFormProps) {
  const [values, setValues] = useState<Values>(() => ({
    instanceName: draft.instanceName,
    publicUrl: draft.publicUrl,
    defaultLocale: draft.defaultLocale,
    defaultTimezone: draft.defaultTimezone,
    registrationMode: draft.registrationMode,
    smtpEnabled: draft.smtp !== null,
    host: draft.smtp?.host ?? '',
    port: String(draft.smtp?.port ?? 587),
    secure: draft.smtp?.secure ?? false,
    username: draft.smtp?.username ?? '',
    password: '',
    from: draft.smtp?.from ?? '',
  }));
  const [timeZones] = useState(() =>
    [...new Set([...Intl.supportedValuesOf('timeZone'), draft.defaultTimezone])].sort(),
  );
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Outcome>(null);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<Outcome>(null);
  const update = (change: Partial<Values>) => {
    setValues({ ...values, ...change });
  };

  const save = async () => {
    const found = formErrors(values);
    setErrors(found);
    setSaved(null);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    const result = await onSave({
      instanceName: values.instanceName.trim(),
      publicUrl: values.publicUrl.trim(),
      defaultLocale: values.defaultLocale,
      defaultTimezone: values.defaultTimezone,
      registrationMode: values.registrationMode,
      smtp: values.smtpEnabled ? toSmtp(values) : null,
    });
    setSaving(false);
    setSaved(result.ok ? { ok: true } : result);
  };

  const testEmail = async () => {
    const found = smtpErrors(values);
    setErrors(found);
    setTested(null);
    if (Object.keys(found).length > 0) return;
    setTesting(true);
    const result = await onTestEmail(toSmtp(values));
    setTesting(false);
    setTested(result.ok ? { ok: true } : result);
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="flex flex-col gap-3.5"
    >
      <Field label={m.instance_name()} hint={m.instance_name_hint()} error={errors.instanceName ?? null}>
        {({ id, describedBy, invalid }) => (
          <TextInput
            id={id}
            name="instanceName"
            maxLength={100}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            value={values.instanceName}
            onChange={(event) => {
              update({ instanceName: event.target.value });
            }}
          />
        )}
      </Field>
      <Field label={m.instance_public_url()} hint={m.instance_public_url_hint()} error={errors.publicUrl ?? null}>
        {({ id, describedBy, invalid }) => (
          <TextInput
            id={id}
            name="publicUrl"
            type="url"
            inputMode="url"
            maxLength={2048}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            value={values.publicUrl}
            onChange={(event) => {
              update({ publicUrl: event.target.value });
            }}
          />
        )}
      </Field>
      <Field label={m.instance_default_locale()}>
        {({ id }) => (
          <LocaleSelect
            id={id}
            name="defaultLocale"
            value={values.defaultLocale}
            onChange={(defaultLocale) => {
              update({ defaultLocale });
            }}
          />
        )}
      </Field>
      <Field label={m.instance_default_timezone()}>
        {({ id }) => (
          <Select
            id={id}
            name="defaultTimezone"
            value={values.defaultTimezone}
            onChange={(event) => {
              update({ defaultTimezone: event.target.value });
            }}
          >
            {timeZones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[12.5px] font-medium text-muted-fg">{m.instance_registration()}</legend>
        {REGISTRATION.map(({ mode, label, hint }) => (
          <label
            key={mode}
            className="flex cursor-pointer items-start gap-2.5 rounded-[9px] border border-border px-3 py-2.5 has-checked:border-border-strong has-checked:bg-muted"
          >
            <input
              type="radio"
              name="registrationMode"
              value={mode}
              checked={values.registrationMode === mode}
              onChange={() => {
                update({ registrationMode: mode });
              }}
              className="mt-0.5 size-4 shrink-0 accent-fg"
            />
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                {label()}
                {mode === 'closed' ? (
                  <span className="rounded-[5px] bg-green-tint-2 px-1.5 py-px text-[11px] font-medium text-green-fg">
                    {m.instance_recommended()}
                  </span>
                ) : null}
              </span>
              <span className="text-[12px] text-subtle">{hint()}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Checkbox
        label={m.instance_smtp_toggle()}
        description={m.instance_smtp_toggle_hint()}
        checked={values.smtpEnabled}
        onChange={(event) => {
          update({ smtpEnabled: event.target.checked, password: '' });
          setTested(null);
        }}
      />
      {values.smtpEnabled ? (
        <div className="flex flex-col gap-3.5 rounded-[10px] border border-border bg-surface-sunken p-3.5">
          <div className="grid grid-cols-[1fr_96px] items-start gap-3">
            <Field label={m.instance_smtp_host()} error={errors.host ?? null}>
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  name="smtpHost"
                  autoComplete="off"
                  maxLength={253}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  value={values.host}
                  onChange={(event) => {
                    update({ host: event.target.value });
                  }}
                />
              )}
            </Field>
            <Field label={m.instance_smtp_port()} error={errors.port ?? null}>
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  name="smtpPort"
                  inputMode="numeric"
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  value={values.port}
                  onChange={(event) => {
                    update({ port: event.target.value });
                  }}
                />
              )}
            </Field>
          </div>
          <Checkbox
            label={m.instance_smtp_secure()}
            description={m.instance_smtp_secure_hint()}
            checked={values.secure}
            onChange={(event) => {
              update({ secure: event.target.checked });
            }}
          />
          <Field label={m.instance_smtp_username()} hint={m.instance_smtp_username_hint()}>
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                name="smtpUsername"
                autoComplete="off"
                maxLength={256}
                aria-describedby={describedBy}
                value={values.username}
                onChange={(event) => {
                  update({ username: event.target.value });
                }}
              />
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <SecretInput
              label={m.instance_smtp_password()}
              name="smtpPassword"
              {...(draft.smtp?.hasPassword === true ? { last4: '' } : {})}
              showLabel={m.password_show()}
              hideLabel={m.password_hide()}
              onChange={(password) => {
                update({ password });
              }}
            />
            {draft.smtp?.hasPassword === true ? (
              <p className="text-[12px] text-subtle">{m.instance_smtp_password_saved()}</p>
            ) : null}
          </div>
          <Field label={m.instance_smtp_from()} hint={m.instance_smtp_from_hint()} error={errors.from ?? null}>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                name="smtpFrom"
                maxLength={320}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                value={values.from}
                onChange={(event) => {
                  update({ from: event.target.value });
                }}
              />
            )}
          </Field>
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              pending={testing}
              onClick={() => void testEmail()}
            >
              {m.instance_smtp_test()}
            </Button>
            <OutcomeNote outcome={tested} success={m.instance_smtp_test_sent()} />
          </div>
        </div>
      ) : null}
      <OutcomeNote outcome={saved} success={m.instance_saved()} />
      <Button type="submit" pending={saving} className="mt-1 w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
