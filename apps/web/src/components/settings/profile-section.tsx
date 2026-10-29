// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Profil & akun (design `bcBrM`, FR-A7, FR-S8): how the app greets the user (name, preferred name,
 * language, time zone) and how they sign in (email, Google, password). The language applies at once and is saved to
 * the account right away; everything else waits for "Simpan perubahan".
 */
import { useRouter } from '@tanstack/react-router';
import type { Profile } from '@wf/db/profiles';
import { m } from '@wf/i18n/messages';
import { LOCALES, type Locale } from '@wf/i18n/locale';
import { CircleAlert, Cloud } from 'lucide-react';
import { useMemo, useState } from 'react';
import { authErrorMessage } from '../../lib/auth-errors.ts';
import { timeZoneLabel } from '../../lib/time-zones.ts';
import { updateProfile } from '../../server/fn/account.ts';
import type { Viewer } from '../../server/gate.ts';
import { Button, FormError, Select, TextInput } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { PasswordControl } from './password-control.tsx';
import { useReauthentication } from './reauth.tsx';
import { SettingsGroup, SettingsRow } from './settings-ui.tsx';

const LOCALE_NAME: Readonly<Record<Locale, () => string>> = { id: m.language_name_id, en: m.language_name_en };

export interface SignInMethods {
  readonly hasPassword: boolean;
  readonly googleLinked: boolean;
}

export function ProfileSection({
  viewer,
  profile,
  methods,
}: {
  viewer: Pick<Viewer, 'email' | 'sessionId'>;
  profile: Profile;
  methods: SignInMethods;
}) {
  const { preferences, setLocale } = usePreferences();
  const router = useRouter();
  const { reauthenticate, dialog } = useReauthentication(viewer);
  const [saved, setSaved] = useState(profile);
  const [form, setForm] = useState(profile);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => {
    const all = Intl.supportedValuesOf('timeZone');
    const list = all.includes(profile.timezone) ? all : [profile.timezone, ...all];
    const now = new Date();
    return list.map((zone) => ({ zone, label: timeZoneLabel(zone, preferences.locale, now) }));
  }, [profile.timezone, preferences.locale]);

  const dirty = form.name !== saved.name || form.nickname !== saved.nickname || form.timezone !== saved.timezone;
  const change = (patch: Partial<Profile>) => {
    setForm((current) => ({ ...current, ...patch }));
    setStatus('idle');
  };
  // The greeting falls back to the first word of the full name (as the dashboard does).
  const greeting = form.nickname ?? form.name.trim().replace(/\s.*$/s, '');

  const save = async (): Promise<void> => {
    setStatus('saving');
    setError(null);
    const nickname = form.nickname?.trim() ?? '';
    const result = await updateProfile({
      data: { ...form, name: form.name.trim(), nickname: nickname === '' ? null : nickname },
    });
    if (!result.ok) {
      setStatus('idle');
      setError(authErrorMessage({ code: result.code }, preferences.locale));
      return;
    }
    setSaved(result.value);
    setForm(result.value);
    setStatus('saved');
    // The user menu shows the name from the session.
    void router.invalidate();
  };

  let footer = m.settings_synced();
  if (dirty) footer = m.settings_unsaved();
  else if (status === 'saved') footer = m.settings_saved();

  return (
    // Not a <form>: the password dialog's form is a React child, and its submit would bubble up to this one. A fragment,
    // so the save bar sticks to the bottom of the settings dialog's scroll container.
    <>
      <SettingsGroup label={m.profile_group_profile()}>
        <SettingsRow title={m.profile_name()} description={m.profile_name_hint()}>
          <TextInput
            aria-label={m.profile_name()}
            size="sm"
            autoComplete="name"
            maxLength={100}
            required
            value={form.name}
            onChange={(event) => {
              change({ name: event.target.value });
            }}
            className="max-w-[240px]"
          />
        </SettingsRow>
        <SettingsRow title={m.profile_nickname()} description={m.profile_nickname_hint({ name: greeting })}>
          <TextInput
            aria-label={m.profile_nickname()}
            size="sm"
            autoComplete="nickname"
            maxLength={100}
            value={form.nickname ?? ''}
            onChange={(event) => {
              change({ nickname: event.target.value === '' ? null : event.target.value });
            }}
            className="max-w-[240px]"
          />
        </SettingsRow>
        <SettingsRow title={m.profile_language()}>
          <Select
            aria-label={m.profile_language()}
            size="sm"
            value={preferences.locale}
            onChange={(event) => {
              const locale = event.target.value as Locale;
              // Applied and saved at once (the root's `onLocaleChange`), so it is not an unsaved change.
              setLocale(locale);
              setForm((current) => ({ ...current, locale }));
              setSaved((current) => ({ ...current, locale }));
            }}
            className="max-w-[240px]"
          >
            {LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {LOCALE_NAME[locale]()}
              </option>
            ))}
          </Select>
        </SettingsRow>
        <SettingsRow title={m.profile_timezone()}>
          <Select
            aria-label={m.profile_timezone()}
            size="sm"
            value={form.timezone}
            onChange={(event) => {
              change({ timezone: event.target.value });
            }}
            className="max-w-[240px]"
          >
            {zones.map(({ zone, label }) => (
              <option key={zone} value={zone}>
                {label}
              </option>
            ))}
          </Select>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup label={m.profile_group_account()}>
        <SettingsRow title={m.profile_email()} description={m.profile_email_hint()}>
          <span className="text-[13px] text-text-secondary">{viewer.email}</span>
        </SettingsRow>
        <h4 className="px-3.5 pt-2.5 pb-1 text-[11.5px] font-medium text-subtle">{m.profile_sign_in_methods()}</h4>
        {methods.googleLinked ? (
          <SettingsRow
            title={m.profile_method_google()}
            description={m.profile_google_linked({ email: viewer.email })}
          />
        ) : null}
        <SettingsRow
          title={m.profile_method_password()}
          description={methods.hasPassword ? m.profile_password_set() : m.profile_password_unset()}
        >
          <PasswordControl hasPassword={methods.hasPassword} email={viewer.email} reauthenticate={reauthenticate} />
        </SettingsRow>
      </SettingsGroup>
      {error === null ? null : <FormError>{error}</FormError>}
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
          {footer}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={!dirty}
          onClick={() => {
            setForm(saved);
          }}
        >
          {m.settings_cancel()}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            void save();
          }}
          pending={status === 'saving'}
          disabled={!dirty || form.name.trim() === ''}
        >
          {m.settings_save()}
        </Button>
      </footer>
      {dialog}
    </>
  );
}
