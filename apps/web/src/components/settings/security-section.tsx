// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Keamanan (design `kKAEZ`/`pdmek`): two-step verification, the password, signed-in devices, and the
 * security history. Actions Better Auth refuses for an old session open the re-authentication dialog first.
 */
import { m } from '@wf/i18n/messages';
import { TriangleAlert } from 'lucide-react';
import type { SecurityOverview } from '../../server/account.ts';
import type { Viewer } from '../../server/gate.ts';
import { DevicesCard } from './devices-card.tsx';
import { HistoryCard } from './history-card.tsx';
import { PasswordControl } from './password-control.tsx';
import { useReauthentication } from './reauth.tsx';
import { SettingsGroup, SettingsRow } from './settings-ui.tsx';
import { TwoFactorCard } from './two-factor-card.tsx';

export function SecuritySection({
  viewer,
  overview,
}: {
  viewer: Pick<Viewer, 'email' | 'sessionId' | 'role' | 'timezone'>;
  overview: SecurityOverview;
}) {
  const { reauthenticate, dialog } = useReauthentication(viewer);
  return (
    <div className="flex flex-col gap-5">
      {overview.twoFactorEnabled ? null : (
        <div
          role="note"
          className="flex items-start gap-2.5 rounded-[9px] border border-amber-tint-3 bg-amber-tint-1 px-3.5 py-3"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-fg" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-fg">{m.security_banner_title()}</span>
            <span className="text-[12px] text-muted-fg">{m.security_banner_description()}</span>
          </div>
        </div>
      )}
      <TwoFactorCard
        twoFactorEnabled={overview.twoFactorEnabled}
        hasPassword={overview.hasPassword}
        isAdmin={viewer.role === 'admin'}
        passkeys={overview.passkeys}
        reauthenticate={reauthenticate}
      />
      <SettingsGroup label={m.security_group_access()}>
        <SettingsRow
          title={m.security_password_title()}
          description={overview.hasPassword ? m.profile_password_set() : m.profile_password_unset()}
        >
          <PasswordControl hasPassword={overview.hasPassword} email={viewer.email} reauthenticate={reauthenticate} />
        </SettingsRow>
      </SettingsGroup>
      <DevicesCard devices={overview.devices} timeZone={viewer.timezone} />
      <HistoryCard history={overview.history} timeZone={viewer.timezone} />
      {dialog}
    </div>
  );
}
