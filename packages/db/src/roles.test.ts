// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPglite, TEST_PASSWORDS, PGLITE_HOOK_TIMEOUT, type PgliteServer } from '../test/pglite.ts';
import { bootstrapRoles, ROLES, RolePasswordError, scramVerifier } from './roles.ts';

let pglite: PgliteServer;

beforeAll(async () => {
  pglite = await startPglite();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await pglite.close();
});

interface RoleRow {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  rolcanlogin: boolean;
  rolpassword: string | null;
  rolconfig: string[] | null;
}

const roleRows = () =>
  pglite.query<RoleRow>(
    `SELECT a.rolname, a.rolsuper, a.rolbypassrls, a.rolcreatedb, a.rolcreaterole, a.rolreplication, a.rolcanlogin,
            a.rolpassword, r.rolconfig
     FROM pg_authid a JOIN pg_roles r USING (oid) WHERE a.rolname LIKE 'wf\\_%' ORDER BY a.rolname`,
  );

describe('scramVerifier', () => {
  it('derives keys that complete the RFC 7677 example exchange', () => {
    // RFC 7677 §3: user "user", password "pencil", salt W22ZaJ0SNY7soEsUEjb6gQ==, 4096 iterations.
    const verifier = scramVerifier('pencil', Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64'));
    const match = /^SCRAM-SHA-256\$4096:W22ZaJ0SNY7soEsUEjb6gQ==\$([^:]+):(.+)$/.exec(verifier);
    expect(match).not.toBeNull();
    const [storedKey, serverKey] = [match?.[1] ?? '', match?.[2] ?? ''].map((b64) => Buffer.from(b64, 'base64'));
    const nonce = 'rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
    const authMessage = `n=user,r=rOprNGfwEbeRWgbNEkqO,r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,c=biws,r=${nonce}`;

    const serverSignature = createHmac('sha256', serverKey ?? '')
      .update(authMessage)
      .digest('base64');
    expect(serverSignature).toBe('6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');

    // The client's proof from the RFC must verify against the stored key, as the server does it.
    const proof = Buffer.from('dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=', 'base64');
    const clientSignature = createHmac('sha256', storedKey ?? '')
      .update(authMessage)
      .digest();
    const clientKey = proof.map((byte, i) => byte ^ (clientSignature[i] ?? 0));
    expect(
      createHash('sha256')
        .update(clientKey)
        .digest()
        .equals(storedKey ?? Buffer.alloc(0)),
    ).toBe(true);
  });

  it('uses a fresh salt by default', () => {
    expect(scramVerifier('same')).not.toBe(scramVerifier('same'));
  });
});

describe('bootstrapRoles', () => {
  it('rejects an unusable password before connecting, naming only the role', async () => {
    for (const bad of ['', 'kata sandi ✓', 'line\nbreak']) {
      const error = bootstrapRoles('postgres://nobody@127.0.0.1:1/none', { ...TEST_PASSWORDS, worker: bad });
      await expect(error).rejects.toThrow(
        new RolePasswordError('Password for wf_worker must be non-empty printable ASCII'),
      );
    }
    expect(await roleRows()).toEqual([]);
  });

  it('demotes a pre-existing privileged role', async () => {
    await pglite.query('CREATE ROLE wf_app SUPERUSER BYPASSRLS CREATEDB CREATEROLE REPLICATION');
    await bootstrapRoles(pglite.url, TEST_PASSWORDS);
    expect((await roleRows()).find((row) => row.rolname === 'wf_app')).toMatchObject({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolcanlogin: true,
    });
  });

  it('creates every role as a plain login role with a SCRAM verifier, never the plaintext', async () => {
    await bootstrapRoles(pglite.url, TEST_PASSWORDS);
    const rows = await roleRows();
    expect(rows.map((row) => row.rolname)).toEqual(Object.values(ROLES).toSorted());
    for (const row of rows) {
      expect(row).toMatchObject({
        rolsuper: false,
        rolbypassrls: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolcanlogin: true,
      });
      expect(row.rolpassword).toMatch(/^SCRAM-SHA-256\$4096:/);
      for (const password of Object.values(TEST_PASSWORDS)) expect(row.rolpassword).not.toContain(password);
    }
    expect(rows.find((row) => row.rolname === ROLES.readonlyOps)?.rolconfig).toEqual([
      'default_transaction_read_only=on',
      'log_statement=all',
    ]);
  });

  it('grants CONNECT to every role and CREATE only to wf_migrate', async () => {
    const [privileges] = await pglite.query<Record<string, boolean>>(
      `SELECT
         bool_and(has_database_privilege(r, current_database(), 'CONNECT')) AS all_connect,
         has_database_privilege('wf_migrate', current_database(), 'CREATE') AS migrate_db_create,
         has_schema_privilege('wf_migrate', 'public', 'CREATE') AS migrate_schema_create,
         bool_or(has_database_privilege(r, current_database(), 'CREATE')) FILTER (WHERE r <> 'wf_migrate') AS other_db_create,
         bool_or(has_schema_privilege(r, 'public', 'CREATE')) FILTER (WHERE r <> 'wf_migrate') AS other_schema_create
       FROM unnest($1::text[]) AS r`,
      [Object.values(ROLES)],
    );
    expect(privileges).toEqual({
      all_connect: true,
      migrate_db_create: true,
      migrate_schema_create: true,
      other_db_create: false,
      other_schema_create: false,
    });
  });

  it('is idempotent and replaces passwords on re-run; a null readonlyOps password disables its login', async () => {
    const before = await roleRows();
    await bootstrapRoles(pglite.url, { ...TEST_PASSWORDS, readonlyOps: null });
    const after = await roleRows();
    expect(after.map((row) => row.rolname)).toEqual(before.map((row) => row.rolname));
    expect(after.find((row) => row.rolname === ROLES.app)?.rolpassword).not.toBe(
      before.find((row) => row.rolname === ROLES.app)?.rolpassword,
    );
    expect(after.find((row) => row.rolname === ROLES.readonlyOps)).toMatchObject({
      rolcanlogin: false,
      rolpassword: null,
    });
  });
});
