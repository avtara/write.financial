// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Notifikasi (FR-ST3, design `HNPLN`, `gK5Rk`): per kind of notification whether it shows in the app and
 * whether it is emailed, the time bill reminders are sent, and the email opt-in. Amounts in emails follow privacy
 * mode (Sembunyikan saldo). Saved with "Simpan perubahan"; a new reminder time moves the reminders not sent yet.
 */
import { NOTIFICATION_GROUPS, type NotificationGroup, type NotificationSettings } from '@wf/db/notification-settings';
import { m } from '@wf/i18n/messages';
import { Switch } from '@wf/ui/switch';
import { toast } from '@wf/ui/toast';
import { CircleAlert, Cloud } from 'lucide-react';
import { useId, useState } from 'react';
import { updateNotificationSettings } from '../../server/fn/notifications.ts';
import { Button, Select } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { SettingsGroup, SettingsRow } from './settings-ui.tsx';

const GROUPS: Readonly<Record<NotificationGroup, { title: () => string; description: (time: string) => string }>> = {
  bills: {
    title: m.settings_notifications_bills,
    description: (time) => m.settings_notifications_bills_description({ time }),
  },
  due: { title: m.settings_notifications_due, description: m.settings_notifications_due_description },
  budget: { title: m.settings_notifications_budget, description: m.settings_notifications_budget_description },
  balance: { title: m.settings_notifications_balance, description: m.settings_notifications_balance_description },
  period: { title: m.settings_notifications_period, description: m.settings_notifications_period_description },
  detected: { title: m.settings_notifications_detected, description: m.settings_notifications_detected_description },
  system: { title: m.settings_notifications_system, description: m.settings_notifications_system_description },
};

/** Reminder times offered: every hour from 06.00 to 21.00, plus a saved time between them. */
function reminderTimes(saved: string): string[] {
  const hours = Array.from({ length: 16 }, (_, index) => `${String(index + 6).padStart(2, '0')}:00`);
  return hours.includes(saved) ? hours : [...hours, saved].sort();
}

export interface NotificationsSectionProps {
  readonly settings: NotificationSettings;
  /** The address emails go to. */
  readonly email: string;
}

export function NotificationsSection({ settings: saved, email }: NotificationsSectionProps) {
  const { preferences } = usePreferences();
  const timeId = useId();
  const [stored, setStored] = useState(saved);
  const [settings, setSettings] = useState(saved);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(settings) !== JSON.stringify(stored);
  const time = settings.reminderTime.replace(':', preferences.locale === 'id' ? '.' : ':');

  const setGroup = (group: NotificationGroup, patch: Partial<NotificationSettings['groups'][NotificationGroup]>) => {
    setSettings((current) => ({
      ...current,
      groups: { ...current.groups, [group]: { ...current.groups[group], ...patch } },
    }));
  };

  const save = async () => {
    setSaving(true);
    const result = await updateNotificationSettings({ data: settings }).catch(() => null);
    setSaving(false);
    if (result?.ok !== true) {
      toast({ tone: 'error', title: m.settings_notifications_save_failed() });
      return;
    }
    setStored(result.value.settings);
    setSettings(result.value.settings);
    toast({
      tone: 'success',
      title: m.settings_notifications_saved(),
      ...(result.value.movedReminders === 0
        ? {}
        : { description: m.settings_notifications_moved({ count: result.value.movedReminders, time }) }),
    });
  };

  return (
    <>
      <p className="text-[13px] text-muted-fg">{m.settings_notifications_intro()}</p>
      <SettingsGroup label={m.settings_notifications_reminders()}>
        <div className="flex items-center gap-4 px-3.5 py-2 text-[11px] font-medium text-subtle uppercase">
          <span className="flex-1">{m.settings_notifications_kind()}</span>
          <span className="w-16 text-center">{m.settings_notifications_in_app()}</span>
          <span className="w-16 text-center">{m.settings_notifications_email()}</span>
        </div>
        {NOTIFICATION_GROUPS.map((group) => {
          const info = GROUPS[group];
          return (
            <SettingsRow key={group} title={info.title()} description={info.description(time)}>
              <span className="flex w-16 justify-center">
                <Switch
                  label={<span className="sr-only">{m.settings_notifications_in_app_for({ kind: info.title() })}</span>}
                  checked={settings.groups[group].inApp}
                  onChange={(event) => {
                    setGroup(group, { inApp: event.currentTarget.checked });
                  }}
                />
              </span>
              <span className="flex w-16 justify-center">
                <Switch
                  label={<span className="sr-only">{m.settings_notifications_email_for({ kind: info.title() })}</span>}
                  checked={settings.email && settings.groups[group].email}
                  disabled={!settings.email}
                  onChange={(event) => {
                    setGroup(group, { email: event.currentTarget.checked });
                  }}
                />
              </span>
            </SettingsRow>
          );
        })}
      </SettingsGroup>

      <SettingsGroup label={m.settings_notifications_delivery()}>
        <SettingsRow
          title={<label htmlFor={timeId}>{m.settings_notifications_time()}</label>}
          description={m.settings_notifications_time_description()}
        >
          <div className="w-28 shrink-0">
            <Select
              id={timeId}
              size="sm"
              value={settings.reminderTime}
              onChange={(event) => {
                const reminderTime = event.currentTarget.value;
                setSettings((current) => ({ ...current, reminderTime }));
              }}
            >
              {reminderTimes(settings.reminderTime).map((option) => (
                <option key={option} value={option}>
                  {option.replace(':', preferences.locale === 'id' ? '.' : ':')}
                </option>
              ))}
            </Select>
          </div>
        </SettingsRow>
        <SettingsRow
          title={m.settings_notifications_email_optin({ email })}
          description={
            preferences.balancesHidden
              ? m.settings_notifications_email_private()
              : m.settings_notifications_email_description()
          }
        >
          <Switch
            label={<span className="sr-only">{m.settings_notifications_email_optin({ email })}</span>}
            checked={settings.email}
            onChange={(event) => {
              const on = event.currentTarget.checked;
              setSettings((current) => ({ ...current, email: on }));
            }}
          />
        </SettingsRow>
      </SettingsGroup>

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
          {dirty ? m.settings_unsaved() : m.settings_synced()}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={!dirty || saving}
          onClick={() => {
            setSettings(stored);
          }}
        >
          {m.settings_cancel()}
        </Button>
        <Button size="sm" disabled={!dirty} pending={saving} onClick={() => void save()}>
          {m.settings_save()}
        </Button>
      </footer>
    </>
  );
}
