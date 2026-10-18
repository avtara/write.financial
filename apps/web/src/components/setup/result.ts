// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Calling the setup and instance server functions from a form: an expected refusal arrives as a failed `Result`;
 * anything thrown on the way (network, an input the server's validator refused) becomes one too, so the form shows
 * an error instead of leaving an unhandled rejection.
 */
import { m } from '@wf/i18n/messages';
import type { Locale } from '@wf/i18n/locale';
import { authErrorMessage } from '../../lib/auth-errors.ts';
import type { Result } from '../../server/access.ts';

export type Failure = Extract<Result<unknown>, { ok: false }>;

export async function settle<T>(call: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await call();
  } catch {
    return { ok: false, code: 'UNKNOWN' };
  }
}

/** The words for a failed server function, including the instance-only codes the auth messages do not cover. */
export function resultMessage({ code, detail }: Failure, locale: Locale): string {
  if (code === 'MAIL_FAILED') {
    return detail === undefined ? m.instance_mail_failed() : m.instance_smtp_test_failed({ detail });
  }
  if (code === 'INVITATIONS_DISABLED') return m.invite_disabled();
  return authErrorMessage({ code }, locale);
}
