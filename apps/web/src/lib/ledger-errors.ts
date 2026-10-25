// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words for a failed ledger server function (`LedgerError` codes from `@wf/db/ledger-errors`). Ledger forms use
 * this instead of `authErrorMessage`: `ACCOUNT_LOCKED` here means the account's currency and opening balance are
 * locked (FR-R3), not a locked sign-in. Other codes (signed out, re-authentication, …) fall through to the auth
 * messages.
 */
import type { LedgerErrorCode } from '@wf/db/ledger-errors';
import { m } from '@wf/i18n/messages';
import type { Locale } from '@wf/i18n/locale';
import { authErrorMessage } from './auth-errors.ts';

const MESSAGES: Readonly<Record<LedgerErrorCode, () => string>> = {
  NOT_FOUND: m.ledger_error_not_found,
  ACCOUNT_LOCKED: m.ledger_error_account_locked,
  TOO_MANY_CARDS: m.ledger_error_too_many_cards,
  INVALID_ACCOUNT: m.ledger_error_invalid_account,
  ACCOUNT_ARCHIVED: m.ledger_error_account_archived,
  ACCOUNT_NOT_ARCHIVED: m.ledger_error_account_not_archived,
  CATEGORY_NAME_TAKEN: m.ledger_error_category_name_taken,
  INVALID_CATEGORY: m.ledger_error_invalid_category,
  CATEGORY_SYSTEM: m.ledger_error_category_system,
  CATEGORY_KIND_MISMATCH: m.ledger_error_category_kind_mismatch,
  INVALID_TAG: m.ledger_error_invalid_tag,
  TOO_MANY_TAGS: m.ledger_error_too_many_tags,
  INVALID_TRANSACTION: m.ledger_error_invalid_transaction,
  SPLIT_MISMATCH: m.ledger_error_split_mismatch,
  FX_RATE_MISSING: m.ledger_error_fx_rate_missing,
  INVALID_RATE: m.ledger_error_invalid_rate,
  INVALID_GOAL: m.ledger_error_invalid_goal,
  PERIOD_CLOSED: m.ledger_error_period_closed,
  INVALID_PERIOD: m.ledger_error_invalid_period,
  INVALID_BUDGET: m.ledger_error_invalid_budget,
  INVALID_RECURRENCE: m.ledger_error_invalid_recurrence,
  INVALID_SUBSCRIPTION: m.ledger_error_invalid_subscription,
  REVIEW_RESOLVED: m.ledger_error_review_resolved,
  INVALID_DEBT: m.ledger_error_invalid_debt,
  INVALID_RECEIVABLE: m.ledger_error_invalid_receivable,
  INVALID_ASSET: m.ledger_error_invalid_asset,
  INVALID_TRADE: m.ledger_error_invalid_trade,
  INVALID_MARKET_CREDENTIAL: m.ledger_error_invalid_market_credential,
  INVALID_REPORT: m.ledger_error_invalid_report,
  INVALID_RULE: m.ledger_error_invalid_rule,
  TWO_FACTOR_REQUIRED: m.auth_error_two_factor_required,
};

export function ledgerErrorMessage(code: string, locale: Locale): string {
  const message = Object.hasOwn(MESSAGES, code) ? MESSAGES[code as LedgerErrorCode] : undefined;
  return message === undefined ? authErrorMessage({ code }, locale) : message();
}
