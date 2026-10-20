// SPDX-License-Identifier: AGPL-3.0-only
/** Input helpers shared by several server function modules. */
import { parseLocalDate } from '@wf/domain/period';
import * as z from 'zod';

/** A calendar date `YYYY-MM-DD`, parsed to the repositories' `LocalDate`. */
export const localDate = z.string().transform((value, context) => {
  try {
    return parseLocalDate(value);
  } catch {
    context.addIssue({ code: 'custom', message: 'Expected a date YYYY-MM-DD' });
    return z.NEVER;
  }
});

/** `value` without its `undefined` properties, as the repositories' exact optional properties require. */
export function defined<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}
