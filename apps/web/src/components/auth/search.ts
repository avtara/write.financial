// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Query parameters of the signed-out pages. The router parses `?a=b` values as JSON where it can, so `?reauth=1`
 * arrives as the number 1 when written by the server (`/sign-in?reauth=1`) and as the string "1" when written by
 * the router; both mean the same.
 */

/** A non-empty string parameter, else absent. */
export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** `?reauth=1`: the signed-in viewer is asked for their password again (FR-A9). */
export function reauthFlag(value: unknown): '1' | undefined {
  return value === 1 || value === '1' ? '1' : undefined;
}
