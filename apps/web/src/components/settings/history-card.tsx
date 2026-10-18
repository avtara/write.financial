// SPDX-License-Identifier: AGPL-3.0-only
/** "Riwayat keamanan" (FR-A10): the append-only security events, newest first, 20 at a time. */
import type { SecurityEventType } from '@wf/db/security-events';
import { formatDateTime } from '@wf/i18n/format';
import { m } from '@wf/i18n/messages';
import { useState } from 'react';
import { authErrorMessage } from '../../lib/auth-errors.ts';
import type { SecurityEventDetail, SecurityEventView, SecurityHistory } from '../../server/account.ts';
import { getSecurityHistory } from '../../server/fn/account.ts';
import { Button, FormError } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { SettingsGroup } from './settings-ui.tsx';

export const EVENT_LABEL: Readonly<Record<SecurityEventType, () => string>> = {
  sign_in: m.history_event_sign_in,
  sign_in_failed: m.history_event_sign_in_failed,
  account_locked: m.history_event_account_locked,
  sign_out: m.history_event_sign_out,
  session_revoked: m.history_event_session_revoked,
  password_changed: m.history_event_password_changed,
  password_reset: m.history_event_password_reset,
  two_factor_enabled: m.history_event_two_factor_enabled,
  two_factor_disabled: m.history_event_two_factor_disabled,
  backup_codes_regenerated: m.history_event_backup_codes_regenerated,
  passkey_added: m.history_event_passkey_added,
  passkey_removed: m.history_event_passkey_removed,
  api_key_added: m.history_event_api_key_added,
  api_key_removed: m.history_event_api_key_removed,
  gmail_connected: m.history_event_gmail_connected,
  gmail_disconnected: m.history_event_gmail_disconnected,
  data_exported: m.history_event_data_exported,
  account_deletion_requested: m.history_event_account_deletion_requested,
  account_deletion_cancelled: m.history_event_account_deletion_cancelled,
};

/** Sign-in methods (`sign_in`) and wrong factors (`sign_in_failed`). */
const METHOD_LABEL: Readonly<Record<string, () => string>> = {
  password: m.history_method_password,
  totp: m.history_method_totp,
  backup_code: m.history_method_backup_code,
  passkey: m.history_method_passkey,
  google: m.history_method_google,
  sign_up: m.history_method_sign_up,
};

/** The event's details in words, e.g. `Kata sandi · perangkat baru`. */
export function describeDetail(detail: SecurityEventDetail): string[] {
  const parts: string[] = [];
  for (const method of [detail.method, detail.factor]) {
    if (method !== undefined) parts.push(METHOD_LABEL[method]?.() ?? method);
  }
  if (detail.name !== undefined) parts.push(detail.name);
  if (detail.newDevice === true) parts.push(m.history_new_device());
  if (detail.remainingAttempts !== undefined)
    parts.push(m.history_remaining_attempts({ count: detail.remainingAttempts }));
  if (detail.count !== undefined) parts.push(m.history_device_count({ count: detail.count }));
  return parts;
}

function EventRow({ event, timeZone }: { event: SecurityEventView; timeZone: string }) {
  const { preferences } = usePreferences();
  const details = describeDetail(event.detail);
  return (
    <li className="flex items-start gap-4 px-3.5 py-[11px]">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] font-medium text-fg">{EVENT_LABEL[event.type]()}</span>
        <span className="text-[12px] text-subtle">{[event.device ?? m.device_unknown(), ...details].join(' · ')}</span>
      </div>
      <time dateTime={event.at.toISOString()} className="shrink-0 text-[12px] text-subtle">
        {formatDateTime(event.at, preferences.locale, timeZone)}
      </time>
    </li>
  );
}

export function HistoryCard({ history, timeZone }: { history: SecurityHistory; timeZone: string }) {
  const { preferences } = usePreferences();
  // Older pages appended by "Muat lagi"; a reloaded first page (after any change) starts the list over.
  const [first, setFirst] = useState(history);
  const [older, setOlder] = useState<readonly SecurityEventView[]>([]);
  const [next, setNext] = useState(history.nextBefore);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (first !== history) {
    setFirst(history);
    setOlder([]);
    setNext(history.nextBefore);
  }

  const loadMore = async (before: string): Promise<void> => {
    setPending(true);
    setError(null);
    const result = await getSecurityHistory({ data: { before } });
    setPending(false);
    if (!result.ok) {
      setError(authErrorMessage({ code: result.code }, preferences.locale));
      return;
    }
    setOlder((current) => [...current, ...result.value.events]);
    setNext(result.value.nextBefore);
  };

  const events = [...history.events, ...older];
  return (
    <SettingsGroup label={m.history_group()}>
      {events.length === 0 ? (
        <p className="px-3.5 py-[11px] text-[12.5px] text-subtle">{m.history_empty()}</p>
      ) : (
        <ul aria-label={m.history_group()} className="flex flex-col divide-y divide-border">
          {events.map((event) => (
            <EventRow key={event.id} event={event} timeZone={timeZone} />
          ))}
        </ul>
      )}
      {next === null ? null : (
        <div className="flex flex-col items-start gap-2 p-3">
          {error === null ? null : <FormError>{error}</FormError>}
          <Button
            variant="secondary"
            size="sm"
            pending={pending}
            onClick={() => {
              void loadMore(next);
            }}
          >
            {m.history_load_more()}
          </Button>
        </div>
      )}
    </SettingsGroup>
  );
}
