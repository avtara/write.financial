// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The worker's `reports` job for one user (`node e2e/report-jobs.ts <email>` with the E2E environment): every closed
 * period that has no monthly report yet gets one, exactly as `apps/worker` does after a period close. Prints the
 * generated count as JSON. The goal positions come from the seed's dated `goal_snapshots`.
 */
import { createDb } from '@wf/db/db';
import { createReports } from '@wf/db/reports';
import postgres from 'postgres';

const email = process.argv[2];
if (email === undefined) throw new Error('Usage: report-jobs.ts <email>');
const env = (key: string): string => {
  const value = process.env[key];
  if (value === undefined) throw new Error(`${key} is missing`);
  return value;
};

const superuser = postgres(env('DATABASE_URL_SUPERUSER'), { max: 1, onnotice: () => undefined });
const worker = createDb(env('DATABASE_URL_WORKER'), { max: 1 });
try {
  const [user] = await superuser<{ id: string }[]>`SELECT id FROM users WHERE lower(email) = ${email.toLowerCase()}`;
  if (user === undefined) throw new Error('No user has this email address');
  const reports = createReports(worker);
  const pending = await reports.pendingMonthly(user.id);
  let generated = 0;
  for (const period of pending) {
    await reports.generate(user.id, { kind: 'monthly', periodId: period.id }, new Date());
    generated += 1;
  }
  console.log(JSON.stringify({ generated }));
} finally {
  await worker.$client.end();
  await superuser.end();
}
