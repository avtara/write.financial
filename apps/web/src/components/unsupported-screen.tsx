// SPDX-License-Identifier: AGPL-3.0-only
import { m } from '@wf/i18n/messages';
import { LogoTile } from './logo-mark.tsx';

/** Below 768 px (PRD §2 non-goals, FR-TB1): phones are not supported in v1, so the app asks for a bigger screen. */
export function UnsupportedScreen() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center md:hidden">
      <LogoTile variant="rail" />
      <h1 className="text-[20px] font-semibold text-fg">{m.unsupported_title()}</h1>
      <p className="max-w-[360px] text-[13.5px] text-muted-fg">{m.unsupported_description()}</p>
    </div>
  );
}
