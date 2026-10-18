// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Data for the backup → restore proof (deploy/ci/backup-restore.sh). Runs from the checkout (it uses the object store,
 * which the launcher itself does not depend on) on the stack's network, with web's environment and secrets volume:
 *
 *   node apps/launcher/test/backup-proof.ts seed            prints {"userId", "email", "key", "sha256", "marker"}
 *   node apps/launcher/test/backup-proof.ts verify '<json>'  exits 0 once everything below holds
 *
 * `seed` creates a user (as wf_auth, like sign-up), its DEK (as wf_app, wrapped with the KEK), and one attachment
 * encrypted with that DEK whose plaintext is a PNG signature followed by a random marker. `verify` checks after the
 * restore that the user row is back, that its DEK unwraps with the KEK, and that the object decrypts to the same bytes.
 */
import { randomBytes } from 'node:crypto';
import { loadConfig } from '@wf/config';
import { loadKeyring } from '@wf/crypto/keyring';
import { createDb } from '@wf/db/db';
import { createUserKeys } from '@wf/db/user-keys';
import { createObjectStore } from '@wf/integrations/objectstore';
import { secretsEnv } from '../src/env.ts';

interface Seed {
  readonly userId: string;
  readonly email: string;
  readonly key: string;
  readonly sha256: string;
  readonly marker: string;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const content = (marker: string) => Buffer.concat([PNG_SIGNATURE, Buffer.from(`${marker} struk belanja`)]);

const config = loadConfig({ ...process.env, ...(await secretsEnv(process.env)) });
const authDb = createDb(config.db.authUrl, { max: 1 });
const appDb = createDb(config.db.appUrl, { max: 1 });
const userKeys = createUserKeys(appDb, await loadKeyring(config.crypto.kekFile));
const attachments = createObjectStore({ s3: config.s3, bucket: 'attachments', getDek: userKeys.getOrCreateDek });

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`backup proof: ${message}`);
}

try {
  const [command, input] = process.argv.slice(2);
  if (command === 'seed') {
    // The marker is only in the object's plaintext: the email is stored in clear in the database, as it must be.
    const marker = `wf-proof-${randomBytes(12).toString('hex')}`;
    const email = `bukti-${randomBytes(6).toString('hex')}@example.com`;
    const [user] = await authDb.$client<{ id: string }[]>`
      insert into users (name, email) values ('Bukti Cadangan', ${email}) returning id`;
    check(user !== undefined, 'the user was not created');
    const userId = user?.id ?? '';
    await userKeys.getOrCreateDek(userId);
    const stored = await attachments.put(userId, content(marker), 'image/png');
    const seed: Seed = { userId, email, key: stored.key, sha256: stored.sha256, marker };
    console.log(JSON.stringify(seed));
  } else if (command === 'verify' && input !== undefined) {
    const seed = JSON.parse(input) as Seed;
    const users = await authDb.$client<{ email: string }[]>`select email from users where id = ${seed.userId}`;
    check(users[0]?.email === seed.email, 'the user row was not restored');
    const wrapped = await appDb.$client.begin(async (sql) => {
      await sql`select set_config('app.user_id', ${seed.userId}, true)`;
      return sql<
        { kekVersion: number }[]
      >`select kek_version as "kekVersion" from user_keys where user_id = ${seed.userId}`;
    });
    check(wrapped.length === 1, 'the wrapped DEK was not restored');
    // Unwraps the restored DEK with the KEK (a new DEK would be created only if the row were missing).
    await userKeys.getOrCreateDek(seed.userId);
    const object = await attachments.get(seed.userId, seed.key, seed.sha256);
    check(object.mime === 'image/png', 'the object has another media type');
    check(Buffer.from(object.bytes).equals(content(seed.marker)), 'the object does not decrypt to the original bytes');
    console.log(
      `verified: user ${seed.userId} restored, DEK v${wrapped[0]?.kekVersion ?? '?'} unwraps with the KEK, object ` +
        `${seed.key} decrypts to the original ${object.bytes.length} bytes`,
    );
  } else {
    throw new Error('Usage: backup-proof.ts seed | verify <seed JSON>');
  }
} finally {
  await authDb.$client.end();
  await appDb.$client.end();
}
