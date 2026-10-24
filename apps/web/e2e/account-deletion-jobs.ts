// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The worker's `account-deletion` job for one user (`node e2e/account-deletion-jobs.ts <email> <ISO instant>`), run
 * inline against the E2E environment with the given clock: purges the user's object prefixes, then deletes the user
 * through the SECURITY DEFINER fn — the 7-day grace has passed as far as this clock is concerned. Prints the result.
 */
import { loadConfig } from '@wf/config';
import { createAccountDeletion } from '@wf/db/account-deletion';
import { createDb } from '@wf/db/db';
import { createObjectPurger } from '@wf/integrations/objectstore';
import postgres from 'postgres';
import { createAccountDeletionProcessor } from '../../../apps/worker/src/processors/account-deletion.ts';

const email = process.argv[2];
const at = new Date(process.argv[3] ?? '2030-01-01T00:00:00Z');
if (email === undefined) throw new Error('Usage: account-deletion-jobs.ts <email> [ISO instant]');

const superuser = postgres(process.env['DATABASE_URL_SUPERUSER'] ?? '', { max: 1, onnotice: () => undefined });
const worker = createDb(process.env['DATABASE_URL_WORKER'] ?? '', { max: 1 });
try {
  const [user] = await superuser<{ id: string }[]>`SELECT id FROM users WHERE lower(email) = ${email.toLowerCase()}`;
  if (user === undefined) throw new Error('No user has this email address');
  const config = loadConfig(process.env);
  const processor = createAccountDeletionProcessor({
    db: { accountDeletion: createAccountDeletion(worker) },
    objects: {
      attachments: createObjectPurger({ s3: config.s3, bucket: 'attachments' }),
      avatars: createObjectPurger({ s3: config.s3, bucket: 'avatars' }),
    },
    now: () => at,
  });
  const result = await processor({ id: `del.${user.id}`, data: { userId: user.id }, attemptsMade: 0 });
  console.log(JSON.stringify(result));
} finally {
  await worker.$client.end();
  await superuser.end();
}
