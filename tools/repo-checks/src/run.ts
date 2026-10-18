// SPDX-License-Identifier: AGPL-3.0-only
import { findFilesWithoutSpdx, findSourceFilesWithoutTests, SPDX_HEADER } from './checks.ts';

export interface Output {
  log(message: string): void;
  error(message: string): void;
}

/** Runs one repository check and returns the process exit code. */
export function run(args: readonly string[], root: string, output: Output): number {
  const [check] = args;
  if (check === 'test-files') {
    const missing = findSourceFilesWithoutTests(root);
    if (missing.length === 0) {
      output.log('Every source file has a co-located test file.');
      return 0;
    }
    output.error(`Source files without a co-located *.test.ts(x) (D27):\n${missing.map((f) => `  - ${f}`).join('\n')}`);
    return 1;
  }
  if (check === 'spdx') {
    const missing = findFilesWithoutSpdx(root);
    if (missing.length === 0) {
      output.log('Every code file has the SPDX header.');
      return 0;
    }
    output.error(`Files without "${SPDX_HEADER}" in the first 3 lines:\n${missing.map((f) => `  - ${f}`).join('\n')}`);
    return 1;
  }
  output.error('Usage: repo-checks <test-files|spdx>');
  return 2;
}
