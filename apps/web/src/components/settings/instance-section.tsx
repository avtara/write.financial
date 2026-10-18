// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Instans (admins only, FR-OP1 "or later edits"): the instance settings the wizard saved, and invitations
 * for registration mode "Dengan undangan". Every change is an admin action, so it needs a sign-in from the last
 * 15 minutes (FR-A9); an older session gets a link to sign in again and come back here.
 */
import type { Invitation } from '@wf/auth/invitations';
import { m } from '@wf/i18n/messages';
import { formatDateTime } from '@wf/i18n/format';
import type { Locale } from '@wf/i18n/locale';
import { PageState } from '@wf/ui/page-state';
import { useEffect, useState } from 'react';
import { needsReauthentication } from '../../lib/auth-errors.ts';
import type { Result } from '../../server/access.ts';
import { getInstance, inviteUser, saveInstance, sendInstanceTestEmail } from '../../server/fn/admin.ts';
import type { InstanceDraft } from '../../server/setup.ts';
import { Button, Field, FormError, FormNotice, TextInput } from '../form.tsx';
import { InstanceForm, LocaleSelect } from '../instance-form.tsx';
import { usePreferences } from '../preferences.tsx';
import { CopyButton } from '../setup/copy-button.tsx';
import { resultMessage, settle } from '../setup/result.ts';

const REAUTH_HREF = '/sign-in?reauth=1&redirect=/settings/instance';

type Invited = { ok: true; email: string; invitation: Invitation } | Extract<Result<Invitation>, { ok: false }>;

function InviteForm({
  defaultLocale,
  call,
}: {
  defaultLocale: Locale;
  call: <T>(run: () => Promise<Result<T>>) => Promise<Result<T>>;
}) {
  const { preferences } = usePreferences();
  const [email, setEmail] = useState('');
  const [locale, setLocale] = useState(defaultLocale);
  const [pending, setPending] = useState(false);
  const [invited, setInvited] = useState<Invited | null>(null);

  const submit = async () => {
    setPending(true);
    setInvited(null);
    const address = email.trim();
    const result = await call(() => inviteUser({ data: { email: address, locale } }));
    setPending(false);
    if (!result.ok) {
      setInvited(result);
      return;
    }
    setInvited({ ok: true, email: address, invitation: result.value });
    setEmail('');
  };

  return (
    <section aria-labelledby="invite-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 id="invite-title" className="text-[14px] font-semibold text-fg">
          {m.invite_title()}
        </h3>
        <p className="text-[12.5px] text-muted-fg">{m.invite_description()}</p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-3.5"
      >
        <div className="grid grid-cols-[1fr_160px] items-end gap-3">
          <Field label={m.invite_email()}>
            {({ id }) => (
              <TextInput
                id={id}
                name="inviteEmail"
                type="email"
                autoComplete="off"
                required
                maxLength={320}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
              />
            )}
          </Field>
          <Field label={m.invite_locale()}>
            {({ id }) => <LocaleSelect id={id} name="inviteLocale" value={locale} onChange={setLocale} />}
          </Field>
        </div>
        <Button type="submit" variant="secondary" pending={pending} className="self-start">
          {m.invite_submit()}
        </Button>
      </form>
      {invited === null ? null : invited.ok ? (
        <div className="flex flex-col gap-2">
          <FormNotice>
            {invited.invitation.emailed ? m.invite_emailed({ email: invited.email }) : m.invite_not_emailed()}
          </FormNotice>
          <Field
            label={m.invite_link()}
            hint={m.invite_link_once({
              date: formatDateTime(
                invited.invitation.expiresAt,
                preferences.locale,
                Intl.DateTimeFormat().resolvedOptions().timeZone,
              ),
            })}
          >
            {({ id, describedBy }) => (
              <div className="flex items-center gap-2">
                <TextInput
                  id={id}
                  readOnly
                  aria-describedby={describedBy}
                  value={invited.invitation.url}
                  className="font-mono text-[12.5px]"
                  onFocus={(event) => {
                    event.target.select();
                  }}
                />
                <CopyButton value={invited.invitation.url} label={m.invite_copy()} />
              </div>
            )}
          </Field>
        </div>
      ) : (
        <FormError>{resultMessage(invited, preferences.locale)}</FormError>
      )}
    </section>
  );
}

export function InstanceSection() {
  const { preferences } = usePreferences();
  const [loaded, setLoaded] = useState<Result<InstanceDraft> | null>(null);
  const [reauth, setReauth] = useState(false);

  useEffect(() => {
    void settle(() => getInstance()).then(setLoaded);
  }, []);

  /** Every admin call: a stale session shows the "sign in again" note. */
  const call = async <T,>(run: () => Promise<Result<T>>): Promise<Result<T>> => {
    const result = await settle(run);
    if (!result.ok && needsReauthentication(result.code)) setReauth(true);
    return result;
  };

  let body;
  if (loaded === null) {
    body = <PageState kind="loading" title={m.instance_loading()} />;
  } else if (!loaded.ok) {
    body = (
      <PageState
        kind="error"
        title={m.instance_load_failed()}
        description={resultMessage(loaded, preferences.locale)}
      />
    );
  } else {
    const draft = loaded.value;
    body = (
      <>
        <InstanceForm
          draft={draft}
          submitLabel={m.instance_save()}
          onSave={(input) => call(() => saveInstance({ data: input }))}
          onTestEmail={(smtp) => call(() => sendInstanceTestEmail({ data: smtp }))}
        />
        <hr className="border-border" />
        <InviteForm defaultLocale={draft.defaultLocale} call={call} />
      </>
    );
  }

  return (
    <section aria-labelledby="instance-title" className="flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h2 id="instance-title" className="text-[17px] font-semibold text-fg">
          {m.instance_section_title()}
        </h2>
        <p className="text-[12.5px] text-muted-fg">{m.instance_section_description()}</p>
      </div>
      {reauth ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-[9px] border border-amber-tint-3 bg-amber-tint-1 px-3.5 py-2.5 text-[12.5px] text-fg"
        >
          <span>{m.instance_reauth()}</span>
          <a href={REAUTH_HREF} className="shrink-0 font-medium text-blue-fg hover:underline">
            {m.instance_reauth_action()}
          </a>
        </div>
      ) : null}
      {body}
    </section>
  );
}
