// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateTokensCss } from './generate.ts';

/** The snapshot exported from the private design file, and the committed generated stylesheet. */
export const SNAPSHOT_PATH = 'design/tokens.json';
export const TOKENS_CSS_PATH = 'packages/ui/src/tokens.css';

export interface Output {
  log(message: string): void;
  error(message: string): void;
}

/**
 * `write` regenerates `tokens.css`; `check` fails when the committed file differs from the generated one.
 * Returns the process exit code.
 */
export function run(args: readonly string[], root: string, output: Output): number {
  const [command] = args;
  if (command !== 'write' && command !== 'check') {
    output.error('Usage: tokens-from-pen <write|check>');
    return 2;
  }
  const css = generateTokensCss(JSON.parse(readFileSync(path.join(root, SNAPSHOT_PATH), 'utf8')));
  const target = path.join(root, TOKENS_CSS_PATH);
  if (command === 'write') {
    writeFileSync(target, css);
    output.log(`Wrote ${TOKENS_CSS_PATH} from ${SNAPSHOT_PATH}.`);
    return 0;
  }
  if (existsSync(target) && readFileSync(target, 'utf8') === css) {
    output.log(`${TOKENS_CSS_PATH} is up to date with ${SNAPSHOT_PATH}.`);
    return 0;
  }
  output.error(`${TOKENS_CSS_PATH} is out of date with ${SNAPSHOT_PATH}. Run \`pnpm tokens\` and commit the result.`);
  return 1;
}
