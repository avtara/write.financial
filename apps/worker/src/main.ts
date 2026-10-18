// SPDX-License-Identifier: AGPL-3.0-only
import { connectBroker } from './platform.ts';
import { run } from './run.ts';

// Exit explicitly: after a timed-out or forced shutdown, open sockets would otherwise keep the process alive.
process.exit(
  await run(process.argv.slice(2), process.env, { connect: connectBroker, signals: process, output: console }),
);
