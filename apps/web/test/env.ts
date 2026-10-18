// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A complete, valid environment for tests that start the web server's request handling: the repository's
 * `.env.example` (dev-only values for every `@wf/config` key, kept current whenever a key is added) plus
 * `overrides`. Nothing in the web tests connects to the services it names.
 */
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const EXAMPLE = new URL('../../../.env.example', import.meta.url);

export function exampleEnv(overrides: Readonly<Record<string, string>> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parseEnv(readFileSync(EXAMPLE, 'utf8')))) {
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...overrides };
}
