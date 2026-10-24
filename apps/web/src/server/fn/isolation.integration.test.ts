// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tenant isolation at the API (M0 exit criterion, PRD §9.2): every web server function, called with the real
 * services (`createServices`) against PostgreSQL 18.6 and Valkey 9.2 and with real Better Auth sessions, as user B
 * sees and changes only B's data, refuses admin and setup actions, and never answers with an `_enc` field or a
 * secret. Admin A is created through the setup wizard (first admin, TOTP, instance settings with an SMTP password)
 * and invites B, who signs up with the invitation. A completeness guard fails for any server function without a
 * case in {@link MATRIX}, so new server functions cannot skip this test.
 *
 * The shared harness is `test/isolation/harness.ts`; the cases live in `test/isolation/cases/<module>.ts`, one file
 * per server-function module. A new module adds its functions to the harness's `FUNCTIONS`, its case file, and one
 * line in {@link MATRIX}.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cases as accountCases } from '../../../test/isolation/cases/account.ts';
import { cases as accountsCases } from '../../../test/isolation/cases/accounts.ts';
import { cases as adminCases } from '../../../test/isolation/cases/admin.ts';
import { cases as budgetCases } from '../../../test/isolation/cases/budget.ts';
import { cases as budgetWriteCases } from '../../../test/isolation/cases/budget-write.ts';
import { cases as calendarCases } from '../../../test/isolation/cases/calendar.ts';
import { cases as categoriesCases } from '../../../test/isolation/cases/categories.ts';
import { cases as debtsCases } from '../../../test/isolation/cases/debts.ts';
import { cases as gateCases } from '../../../test/isolation/cases/gate.ts';
import { cases as getPreferencesCases } from '../../../test/isolation/cases/get-preferences.ts';
import { cases as goalsCases } from '../../../test/isolation/cases/goals.ts';
import { cases as importCases } from '../../../test/isolation/cases/import.ts';
import { cases as investmentsCases } from '../../../test/isolation/cases/investments.ts';
import { cases as ledgerCases } from '../../../test/isolation/cases/ledger.ts';
import { cases as marketCases } from '../../../test/isolation/cases/market.ts';
import { cases as notificationsCases } from '../../../test/isolation/cases/notifications.ts';
import { cases as onboardingCases } from '../../../test/isolation/cases/onboarding.ts';
import { cases as receivablesCases } from '../../../test/isolation/cases/receivables.ts';
import { cases as reportsCases } from '../../../test/isolation/cases/reports.ts';
import { cases as reviewCases } from '../../../test/isolation/cases/review.ts';
import { cases as schedulesCases } from '../../../test/isolation/cases/schedules.ts';
import { cases as searchCases } from '../../../test/isolation/cases/search.ts';
import { cases as setupCases } from '../../../test/isolation/cases/setup.ts';
import { cases as tagsCases } from '../../../test/isolation/cases/tags.ts';
import { cases as transactionsCases } from '../../../test/isolation/cases/transactions.ts';
import { cases as transactionsWriteCases } from '../../../test/isolation/cases/transactions-write.ts';
import {
  aIdentifiers,
  as,
  type Case,
  FUNCTIONS,
  type Name,
  responses,
  secrets,
  setUp,
  storedSecrets,
  tearDown,
  toJson,
} from '../../../test/isolation/harness.ts';
import type * as RuntimeModule from '../runtime.ts';
import type { Services } from '../runtime.ts';

const running = vi.hoisted(() => ({ services: null as Promise<Services> | null }));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
// The server functions get the services this test built with the real `createServices`.
vi.mock('../runtime.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeModule>()),
  services: () => running.services ?? Promise.reject(new Error('services not started')),
}));

beforeAll(() => setUp(running));
afterAll(tearDown);

const SRC = fileURLToPath(new URL('../../', import.meta.url));

/**
 * One case per server function; the type and the guard below make a missing case fail. Cases run in this order, so
 * later ones see B's profile as `updateProfile` and `saveLocale` left it.
 */
const MATRIX: Record<Name, Case> = {
  ...accountCases,
  ...adminCases,
  ...setupCases,
  ...gateCases,
  ...ledgerCases,
  ...searchCases,
  ...categoriesCases,
  ...tagsCases,
  ...budgetCases,
  ...transactionsWriteCases,
  ...accountsCases,
  ...notificationsCases,
  ...marketCases,
  ...reviewCases,
  ...schedulesCases,
  ...calendarCases,
  ...budgetWriteCases,
  ...getPreferencesCases,
  ...transactionsCases,
  ...onboardingCases,
  ...debtsCases,
  ...goalsCases,
  ...receivablesCases,
  ...investmentsCases,
  ...reportsCases,
  ...importCases,
};

/**
 * Every server function the app defines: the exports of each source file that calls `createServerFn(`. Under
 * `serverFnModule()` a server function is its handler with an own `validator` property.
 */
async function serverFunctions(): Promise<{ id: string; fn: unknown }[]> {
  const found: { id: string; fn: unknown }[] = [];
  const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.endsWith('.d.ts'))
    .sort();
  for (const file of files) {
    const calls = readFileSync(path.join(SRC, file), 'utf8').match(/\bcreateServerFn\(/g)?.length ?? 0;
    if (calls === 0) continue;
    // The module path is discovered at run time, so it cannot be a static import.
    const module = (await import(path.join(SRC, file))) as Record<string, unknown>;
    const exported = Object.entries(module).filter(
      ([, value]) => typeof value === 'function' && Object.hasOwn(value, 'validator'),
    );
    // A server function that is not exported cannot be found here; make it visible instead of skipping it.
    if (exported.length !== calls) found.push({ id: `${file}: ${String(calls)} createServerFn calls`, fn: null });
    for (const [name, fn] of exported) found.push({ id: `${file}#${name}`, fn });
  }
  return found;
}

describe('tenant isolation at the API', () => {
  it('has a case for every server function', async () => {
    const all = await serverFunctions();
    expect(all.map(({ id }) => id)).toContain('server/fn/account.ts#getProfile');
    expect(all.map(({ id }) => id)).toContain('server/get-preferences.ts#getPreferences');
    const covered = new Set<unknown>((Object.keys(MATRIX) as Name[]).map((name) => FUNCTIONS[name]));
    const missing = all.filter(({ fn }) => !covered.has(fn)).map(({ id }) => id);
    expect(missing, 'server functions without an isolation case').toEqual([]);
    expect(all).toHaveLength(covered.size);
  });

  for (const [name, entry] of Object.entries(MATRIX) as [Name, Case][]) {
    it(`${name}: B sees and changes only B's data; signed out is refused`, async () => {
      const input = entry.input?.();
      expect(await as('anonymous', name, input)).toEqual(entry.anonymous());
      await entry.asB(input);
    });
  }

  it('never answers with an `_enc` field, a secret, or (to B and signed-out visitors) any of A’s data', async () => {
    const forbidden = [...secrets, ...(await storedSecrets())];
    const ofA = await aIdentifiers();
    expect(new Set(responses.map(({ caller }) => caller))).toEqual(new Set(['A', 'B', 'anonymous']));

    const encKeys = (value: unknown, at: string): string[] => {
      if (typeof value !== 'object' || value === null) return [];
      return Object.entries(value).flatMap(([key, child]) => [
        ...(/(?:_enc|Enc)$/.test(key) ? [`${at}.${key}`] : []),
        ...encKeys(child, `${at}.${key}`),
      ]);
    };
    for (const { caller, fn, value } of responses) {
      const json = toJson(value);
      expect(encKeys(value, `${caller} ${fn}`)).toEqual([]);
      expect(forbidden.filter((text) => json.includes(text)).length, `${caller} ${fn} leaks a secret`).toBe(0);
      if (caller !== 'A')
        expect(
          ofA.filter((text) => json.includes(text)),
          `${caller} ${fn}`,
        ).toEqual([]);
    }
  });
});
