// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The E2E server's clock: preloaded into the production server (`node --import ./e2e/clock.ts`, see
 * `playwright.config.ts`), it shifts `Date` by `WF_E2E_CLOCK_OFFSET_MS`, so "now" is {@link E2E_NOW} plus the real
 * time elapsed since the Playwright run started — the same instant the test workers' `e2eNow()` and the browser see.
 * Only argument-less `new Date()`, `Date()`, and `Date.now()` move; explicit dates, timers, and `performance.now()`
 * stay real.
 */
import { clockOffsetMs } from './env.ts';

const RealDate = Date;
const offset = clockOffsetMs();
if (offset === 0) throw new Error('WF_E2E_CLOCK_OFFSET_MS is missing: start the server through playwright.config.ts');

const now = (): number => RealDate.now() + offset;

const ShiftedDate = new Proxy(RealDate, {
  // `new Date()` (also through subclasses: `newTarget` is kept); with arguments, the real constructor.
  construct: (target, args, newTarget): Date =>
    Reflect.construct(target, args.length === 0 ? [now()] : args, newTarget) as Date,
  // `Date()` called as a function returns the current time as a string.
  apply: () => new RealDate(now()).toString(),
  get: (target, property): unknown => (property === 'now' ? now : Reflect.get(target, property, target)),
});
// Serializers recognise dates by `value.constructor === Date` (seroval, TanStack Start's), so every date, including
// those made before this module ran, must point at the shifted constructor.
RealDate.prototype.constructor = ShiftedDate;
globalThis.Date = ShiftedDate;
