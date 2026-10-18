// SPDX-License-Identifier: AGPL-3.0-only
/** "Perangkat aktif" (design `pdmek`, FR-A5): every signed-in device; sign one or all others out. */
import { useRouter } from '@tanstack/react-router';
import { formatDateTime } from '@wf/i18n/format';
import { m } from '@wf/i18n/messages';
import { ConfirmDialog } from '@wf/ui/confirm-dialog';
import { useState } from 'react';
import { authErrorMessage } from '../../lib/auth-errors.ts';
import type { DeviceView } from '../../server/account.ts';
import { revokeDevice, revokeOtherDevices } from '../../server/fn/account.ts';
import { Button, FormError, FormNotice } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { Badge, SettingsGroup, SettingsRow } from './settings-ui.tsx';

type Confirm = { readonly kind: 'one'; readonly device: DeviceView } | { readonly kind: 'others' } | null;

export function DevicesCard({ devices, timeZone }: { devices: readonly DeviceView[]; timeZone: string }) {
  const { preferences } = usePreferences();
  const router = useRouter();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const others = devices.filter((device) => !device.current);
  const label = (device: DeviceView) => device.label ?? m.device_unknown();

  const run = async (target: NonNullable<Confirm>): Promise<void> => {
    setError(null);
    setNotice(null);
    const result =
      target.kind === 'one' ? await revokeDevice({ data: { id: target.device.id } }) : await revokeOtherDevices();
    if (result.ok) {
      setNotice(
        target.kind === 'one'
          ? m.device_revoked({ device: label(target.device) })
          : m.device_revoked_others({ count: others.length }),
      );
      void router.invalidate();
    } else {
      setError(authErrorMessage({ code: result.code }, preferences.locale));
    }
  };

  return (
    <SettingsGroup
      label={m.device_group()}
      action={
        others.length === 0 ? null : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setConfirm({ kind: 'others' });
            }}
          >
            {m.device_revoke_others()}
          </Button>
        )
      }
    >
      {devices.map((device) => (
        <SettingsRow
          key={device.id}
          title={label(device)}
          description={m.device_signed_in({ time: formatDateTime(device.createdAt, preferences.locale, timeZone) })}
        >
          {device.current ? (
            <Badge>{m.device_this()}</Badge>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              aria-label={m.device_revoke_label({ device: label(device) })}
              onClick={() => {
                setConfirm({ kind: 'one', device });
              }}
            >
              {m.device_revoke()}
            </Button>
          )}
        </SettingsRow>
      ))}
      {notice === null && error === null ? null : (
        <div className="p-3">
          {notice === null ? null : <FormNotice>{notice}</FormNotice>}
          {error === null ? null : <FormError>{error}</FormError>}
        </div>
      )}
      {confirm === null ? null : (
        <ConfirmDialog
          open
          onOpenChange={() => {
            setConfirm(null);
          }}
          title={
            confirm.kind === 'one'
              ? m.device_revoke_title({ device: label(confirm.device) })
              : m.device_revoke_others_title()
          }
          description={confirm.kind === 'one' ? m.device_revoke_description() : m.device_revoke_others_description()}
          {...(confirm.kind === 'others'
            ? { impact: m.device_revoke_others_impact({ count: others.length, devices: others.map(label).join(', ') }) }
            : {})}
          confirmLabel={confirm.kind === 'one' ? m.device_revoke() : m.device_revoke_others_confirm()}
          cancelLabel={m.settings_cancel()}
          variant="destructive"
          onConfirm={() => {
            void run(confirm);
          }}
        />
      )}
    </SettingsGroup>
  );
}
