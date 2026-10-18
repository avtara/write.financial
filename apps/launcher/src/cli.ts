// SPDX-License-Identifier: AGPL-3.0-only
import { setTimeout as sleep } from 'node:timers/promises';
import { bundledMigrations, inspectRestoreTarget, migrationLevel, resetAppSchema } from '@wf/db/backup';
import { migrate } from '@wf/db/migrate';
import { bootstrapRoles } from '@wf/db/roles';
import { isSetupPending } from '@wf/db/setup-status';
import { createS3Port } from '@wf/s3';
import { runCommand } from './command.ts';
import { importEntry, main } from './main.ts';

process.exitCode = await main(process.argv.slice(2), process, {
  importEntry,
  fetch,
  bootstrapRoles,
  migrate,
  sleep,
  setupPending: isSetupPending,
  runCommand,
  createS3: createS3Port,
  migrationLevel,
  inspectRestoreTarget,
  resetAppSchema,
  migrations: bundledMigrations(),
  stdin: process.stdin,
  now: Date.now,
  output: console,
});
