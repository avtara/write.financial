// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words for a failed AI server function (`AiErrorCode` from `@wf/domain/ai`, or the generic Result codes such as
 * `TWO_FACTOR_REQUIRED`). Messages never include prompts, provider response bodies, or credentials — only what the
 * user has to change.
 */
import type { AiErrorCode } from '@wf/domain/ai';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { authErrorMessage } from './auth-errors.ts';

type AiMessage = (inputs: Record<string, never>, options: { locale: Locale }) => string;

const MESSAGES: Readonly<Record<AiErrorCode, AiMessage>> = {
  AI_INVALID_CONFIG: m.ai_error_invalid_config,
  AI_NOT_CONFIGURED: m.ai_error_not_configured,
  AI_CONFIG_CHANGED: m.ai_error_config_changed,
  AI_PERMISSION_REQUIRED: m.ai_error_permission_required,
  AI_COST_LIMIT: m.ai_error_cost_limit,
  AI_PRICING_REQUIRED: m.ai_error_pricing_required,
  AI_EGRESS_DENIED: m.ai_error_egress_denied,
  AI_PROVIDER_FAILED: m.ai_error_provider_failed,
  AI_REQUEST_EXISTS: m.ai_error_request_exists,
  AI_TIMEOUT: m.ai_error_timeout,
  AI_ASSISTANT_FAILED: m.ai_error_assistant_failed,
};

/** The sentence for `code` in `locale`; other expected refusals fall through to the auth messages. */
export function aiErrorMessage(code: string, locale: Locale): string {
  const message = Object.hasOwn(MESSAGES, code) ? MESSAGES[code as AiErrorCode] : undefined;
  return message === undefined ? authErrorMessage({ code }, locale) : message({}, { locale });
}
