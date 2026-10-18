// SPDX-License-Identifier: AGPL-3.0-only
import { setTimeout as sleep } from 'node:timers/promises';
import { migrate } from '@wf/db/migrate';
import { bootstrapRoles } from '@wf/db/roles';
import { isSetupPending } from '@wf/db/setup-status';
import { importEntry, main } from './main.ts';

process.exitCode = await main(process.argv.slice(2), process, {
  importEntry,
  fetch,
  bootstrapRoles,
  migrate,
  sleep,
  setupPending: isSetupPending,
  output: console,
});
