// SPDX-License-Identifier: AGPL-3.0-only
import { parseKeyring } from '@wf/crypto/keyring';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { keyFileText } from '../test/keys.ts';
import { insertUser, pgError, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { InvalidUserIdError, MissingRowError } from './db.ts';
import {
  createInstanceSettings,
  NotAdminError,
  type InstanceSettingsRepository,
  type SetupInput,
  type SmtpSettings,
} from './instance-settings.ts';

const keyring = parseKeyring(keyFileText());
/** Built at runtime so no fixture looks like a committed secret. */
const SMTP_PASSWORD = ['smtp', 'pass', String(Date.now())].join('-');

const SMTP: SmtpSettings = {
  host: 'smtp.example.test',
  port: 587,
  secure: false,
  username: 'mailer',
  from: 'Uang <no-reply@example.test>',
};

const SETUP: SetupInput = {
  instanceName: 'Keluarga Avtara',
  publicUrl: 'https://uang.example.test/',
  defaultLocale: 'en',
  defaultTimezone: 'Asia/Makassar',
  registrationMode: 'invite',
  smtp: { ...SMTP, password: SMTP_PASSWORD },
};

let test: TestDatabase;
let settings: InstanceSettingsRepository;
let admin: string;
let member: string;

beforeAll(async () => {
  test = await startMigrated();
  settings = createInstanceSettings(test.db, keyring);
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  await test.query('DELETE FROM instance_settings');
  await test.query('INSERT INTO instance_settings DEFAULT VALUES');
  admin = await insertUser(test, 'admin@example.test', 'admin');
  member = await insertUser(test, 'member@example.test');
});

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const stored = async () =>
  (
    await test.query<{ enc: Uint8Array | null; wrapped: Uint8Array | null; completed: Date | null }>(
      'SELECT smtp_password_enc AS enc, instance_dek_wrapped AS wrapped, setup_completed_at AS completed FROM instance_settings',
    )
  )[0];

describe('get', () => {
  it('returns the seeded defaults to every role without a user context', async () => {
    const expected = {
      instanceName: 'write.financial',
      publicUrl: null,
      defaultLocale: 'id',
      defaultTimezone: 'Asia/Jakarta',
      registrationMode: 'closed',
      setupCompletedAt: null,
      smtp: null,
    };
    for (const role of ['wf_app', 'wf_worker', 'wf_auth'] as const) {
      expect(await test.as(role, () => settings.get())).toEqual(expected);
    }
  });

  it('fails loudly if the settings row is missing', async () => {
    await test.query('DELETE FROM instance_settings');
    await expect(asApp(() => settings.get())).rejects.toBeInstanceOf(MissingRowError);
  });
});

describe('updateSetup', () => {
  it('saves the wizard as an admin, encrypts the SMTP password, and never returns it', async () => {
    const result = await asApp(() => settings.updateSetup(admin, SETUP));
    expect(result).toEqual({
      instanceName: 'Keluarga Avtara',
      publicUrl: 'https://uang.example.test/',
      defaultLocale: 'en',
      defaultTimezone: 'Asia/Makassar',
      registrationMode: 'invite',
      setupCompletedAt: expect.any(Date) as Date,
      smtp: { ...SMTP, hasPassword: true },
    });
    expect(await asApp(() => settings.get())).toEqual(result);

    const row = await stored();
    expect(Buffer.from(row?.enc ?? []).includes(SMTP_PASSWORD)).toBe(false);
    expect(row?.wrapped).toHaveLength(65);
    expect(await test.as('wf_worker', () => settings.smtpPassword())).toBe(SMTP_PASSWORD);
  });

  it('keeps the completion time and the stored password when the password is left out', async () => {
    await asApp(() => settings.updateSetup(admin, SETUP));
    const first = await stored();
    const result = await asApp(() =>
      settings.updateSetup(admin, { ...SETUP, registrationMode: 'open', smtp: { ...SMTP, port: 465, secure: true } }),
    );
    expect(result).toMatchObject({ registrationMode: 'open', smtp: { port: 465, secure: true, hasPassword: true } });
    const second = await stored();
    expect(second?.completed).toEqual(first?.completed);
    expect(second?.enc).toEqual(first?.enc);
    expect(await asApp(() => settings.smtpPassword())).toBe(SMTP_PASSWORD);
  });

  it('reuses the instance DEK when the password changes', async () => {
    await asApp(() => settings.updateSetup(admin, SETUP));
    const first = await stored();
    await asApp(() => settings.updateSetup(admin, { ...SETUP, smtp: { ...SMTP, password: `${SMTP_PASSWORD}-new` } }));
    expect((await stored())?.wrapped).toEqual(first?.wrapped);
    expect(await asApp(() => settings.smtpPassword())).toBe(`${SMTP_PASSWORD}-new`);
  });

  it('removes the password (null) or the whole SMTP configuration (smtp: null)', async () => {
    await asApp(() => settings.updateSetup(admin, SETUP));
    const withoutPassword = { ...SETUP, smtp: { ...SMTP, username: null, password: null } };
    expect(await asApp(() => settings.updateSetup(admin, withoutPassword))).toMatchObject({
      smtp: { username: null, hasPassword: false },
    });
    expect(await asApp(() => settings.smtpPassword())).toBeNull();

    expect(await asApp(() => settings.updateSetup(admin, { ...SETUP, smtp: null }))).toMatchObject({ smtp: null });
    expect(await stored()).toMatchObject({ enc: null });
  });

  it('refuses a non-admin, with or without an SMTP password, and changes nothing', async () => {
    await expect(asApp(() => settings.updateSetup(member, SETUP))).rejects.toThrow(new NotAdminError());
    await expect(asApp(() => settings.updateSetup(member, { ...SETUP, smtp: null }))).rejects.toBeInstanceOf(
      NotAdminError,
    );
    expect(await stored()).toEqual({ enc: null, wrapped: null, completed: null });
  });

  it('is not writable by the worker or the auth role', async () => {
    for (const role of ['wf_worker', 'wf_auth'] as const) {
      await expect(test.as(role, () => settings.updateSetup(admin, { ...SETUP, smtp: null }))).rejects.toMatchObject(
        pgError(/permission denied/),
      );
    }
  });

  it('rejects a user id that is not a UUID', async () => {
    await expect(settings.updateSetup('admin', SETUP)).rejects.toBeInstanceOf(InvalidUserIdError);
  });
});

describe('smtpPassword', () => {
  it('is null before any password is stored', async () => {
    expect(await asApp(() => settings.smtpPassword())).toBeNull();
  });
});
