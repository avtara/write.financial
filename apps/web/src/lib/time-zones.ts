// SPDX-License-Identifier: AGPL-3.0-only
/** Time zone names for the zone pickers (Settings › Profil, onboarding step 1). */
import type { Locale } from '@wf/i18n/locale';

/**
 * `Asia/Jakarta (WIB)` where the locale has a short name for the zone; just `Europe/Berlin` where it only has an
 * offset (`GMT+2`).
 */
export function timeZoneLabel(zone: string, locale: Locale, at: Date): string {
  const text = new Intl.DateTimeFormat(locale === 'id' ? 'id-ID' : 'en-US', {
    timeZone: zone,
    timeZoneName: 'short',
  }).format(at);
  const short = text.slice(text.lastIndexOf(' ') + 1);
  return /^(GMT|UTC)/.test(short) ? zone : `${zone} (${short})`;
}
