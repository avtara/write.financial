// SPDX-License-Identifier: AGPL-3.0-only
import { run } from './run.ts';

process.exitCode = run(process.argv.slice(2), process.cwd(), console);
