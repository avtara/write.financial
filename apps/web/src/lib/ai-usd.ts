// SPDX-License-Identifier: AGPL-3.0-only
/**
 * USD amounts of the AI screens: provider bills are decimal strings with 18 places, and a request can cost less than
 * a cent, so the sub-cent digits are kept instead of rounding to `$0,00` (FR-AI2's usage meter).
 */
import { parseDecimal } from '@wf/domain/decimal';
import { m } from '@wf/i18n/messages';
import type { Locale } from '@wf/i18n/locale';

const INTL_LOCALE: Readonly<Record<Locale, string>> = { id: 'id-ID', en: 'en-US' };

/** `$1,24` (id) / `$1.24` (en); `••••••` in privacy mode, and an em dash for a value that is not a USD amount. */
export function formatUsd(value: string, locale: Locale, hidden = false): string {
  if (hidden) return '••••••';
  let scaled: bigint;
  try {
    scaled = parseDecimal(value);
  } catch {
    return m.ai_log_detail_none();
  }
  if (scaled < 0n) return m.ai_log_detail_none();
  const scale = 10n ** 18n;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(18, '0').replace(/0+$/, '');
  const digits = fraction.length > 2 ? fraction : fraction.padEnd(2, '0');
  const wholeText = new Intl.NumberFormat(INTL_LOCALE[locale]).format(whole);
  return `$${wholeText}${locale === 'id' ? ',' : '.'}${digits}`;
}
