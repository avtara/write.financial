// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, pgError, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createOnboarding, type OnboardingRepository } from './onboarding.ts';

const NOW = new Date('2026-10-15T02:42:00Z');

let test: TestDatabase;
let repo: OnboardingRepository;
let alice: string;
let bob: string;

beforeAll(async () => {
  test = await startMigrated();
  repo = createOnboarding(test.db, { now: () => NOW });
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
});

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);

describe('onboarding progress', () => {
  it('starts at the profile step, not completed, in IDR', async () => {
    expect(await asApp(() => repo.progress(alice))).toEqual({
      step: 'profile',
      completedAt: null,
      baseCurrency: 'IDR',
    });
  });

  it('moves past each completed step and never back', async () => {
    expect(await asApp(() => repo.completeStep(alice, 'profile'))).toMatchObject({ step: 'period' });
    expect(await asApp(() => repo.completeStep(alice, 'period'))).toMatchObject({ step: 'accounts' });
    // "Kembali" to step 1 and on again keeps the furthest step.
    expect(await asApp(() => repo.completeStep(alice, 'profile'))).toMatchObject({ step: 'accounts' });
    expect(await asApp(() => repo.completeStep(alice, 'accounts'))).toMatchObject({ step: 'goal' });
    expect(await asApp(() => repo.completeStep(alice, 'goal'))).toMatchObject({ step: 'done' });
    expect(await asApp(() => repo.progress(bob))).toMatchObject({ step: 'profile' });
  });

  it('completes once: the first time stays', async () => {
    expect(await asApp(() => repo.finish(alice))).toMatchObject({ completedAt: NOW });
    const later = createOnboarding(test.db, { now: () => new Date('2026-10-16T00:00:00Z') });
    expect(await asApp(() => later.finish(alice))).toMatchObject({ completedAt: NOW });
    expect(await asApp(() => repo.progress(bob))).toMatchObject({ completedAt: null });
  });

  it('defaults to the real clock', async () => {
    const before = Date.now();
    const { completedAt } = await asApp(() => createOnboarding(test.db).finish(alice));
    expect(completedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('changes the base currency only while the user has no account', async () => {
    expect(await asApp(() => repo.setBaseCurrency(alice, 'SGD'))).toMatchObject({ baseCurrency: 'SGD' });
    await test.query(
      `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_date, color)
       VALUES ($1, 'bank', 'DBS', 'DBS', 'SGD', '2026-10-15', 'blue')`,
      [alice],
    );
    // The same currency again is fine; another one is refused.
    expect(await asApp(() => repo.setBaseCurrency(alice, 'SGD'))).toMatchObject({ baseCurrency: 'SGD' });
    await expect(asApp(() => repo.setBaseCurrency(alice, 'IDR'))).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
    // Alice's account does not lock Bob's currency (RLS).
    expect(await asApp(() => repo.setBaseCurrency(bob, 'USD'))).toMatchObject({ baseCurrency: 'USD' });
  });

  it('cannot be written by the worker, and the step stays 1–5', async () => {
    await expect(test.as('wf_worker', () => repo.completeStep(alice, 'profile'))).rejects.toMatchObject(
      pgError(/permission denied/),
    );
    await expect(test.query('UPDATE users SET onboarding_step = 6 WHERE id = $1', [alice])).rejects.toMatchObject({
      message: expect.stringMatching(/users_onboarding_step_check/) as string,
    });
  });
});
