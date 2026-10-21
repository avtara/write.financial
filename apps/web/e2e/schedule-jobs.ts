// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Time travel" for the scheduled jobs (`runScheduleJobs` in `support.ts`): runs, as `wf_worker`, what the worker's
 * `occurrences` and `reminders` jobs would have done for one user by an instant after the run's clock — bills due by
 * then move to the Review queue, and every reminder whose time has come is sent (in-app, plus the outbox email).
 * `node e2e/schedule-jobs.ts <email> <ISO instant>` with the E2E environment; prints the job results as JSON.
 */
import { loadKeyring } from '@wf/crypto/keyring';
import { createDb } from '@wf/db/db';
import { createOccurrenceJobs } from '@wf/db/occurrence-jobs';
import { createUserKeys } from '@wf/db/user-keys';
import postgres from 'postgres';

const [email, iso] = process.argv.slice(2);
if (email === undefined || iso === undefined) throw new Error('Usage: schedule-jobs.ts <email> <ISO instant>');
const at = new Date(iso);
const env = (key: string): string => {
  const value = process.env[key];
  if (value === undefined) throw new Error(`${key} is missing`);
  return value;
};

// The lookups bypass RLS (superuser); the jobs themselves run as the worker does.
const superuser = postgres(env('DATABASE_URL_SUPERUSER'), { max: 1, onnotice: () => undefined });
const worker = createDb(env('DATABASE_URL_WORKER'), { max: 1 });
try {
  const [user] = await superuser<{ id: string }[]>`SELECT id FROM users WHERE lower(email) = ${email.toLowerCase()}`;
  if (user === undefined) throw new Error('No user has this email address');
  const jobs = createOccurrenceJobs(worker, {
    getDek: createUserKeys(worker, await loadKeyring(env('KEK_FILE'))).getOrCreateDek,
  });
  const advanced = await jobs.advance(user.id, at);
  const due = await superuser<{ id: string }[]>`
    SELECT id FROM scheduled_occurrences
    WHERE user_id = ${user.id} AND remind_at <= ${at} AND reminded_at IS NULL ORDER BY remind_at`;
  let reminded = 0;
  for (const occurrence of due) {
    if ((await jobs.remind(user.id, occurrence.id, at)).reminded) reminded += 1;
  }
  console.log(JSON.stringify({ ...advanced, reminded }));
} finally {
  await Promise.all([superuser.end(), worker.$client.end()]);
}
