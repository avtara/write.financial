// SPDX-License-Identifier: AGPL-3.0-only
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run, SNAPSHOT_PATH, TOKENS_CSS_PATH } from './run.ts';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
let root: string;
const output = { log: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>() };

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'tokens-from-pen-'));
  mkdirSync(path.join(root, 'design'));
  mkdirSync(path.join(root, path.dirname(TOKENS_CSS_PATH)), { recursive: true });
  cpSync(path.join(repoRoot, SNAPSHOT_PATH), path.join(root, SNAPSHOT_PATH));
  output.log.mockClear();
  output.error.mockClear();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('run', () => {
  it('keeps the committed tokens.css in sync with design/tokens.json', () => {
    expect(run(['check'], repoRoot, output)).toBe(0);
    expect(output.log).toHaveBeenCalledWith(`${TOKENS_CSS_PATH} is up to date with ${SNAPSHOT_PATH}.`);
  });

  it('fails check when tokens.css is missing, then write creates it and check passes', () => {
    expect(run(['check'], root, output)).toBe(1);
    expect(output.error).toHaveBeenCalledWith(
      `${TOKENS_CSS_PATH} is out of date with ${SNAPSHOT_PATH}. Run \`pnpm tokens\` and commit the result.`,
    );
    expect(run(['write'], root, output)).toBe(0);
    expect(output.log).toHaveBeenCalledWith(`Wrote ${TOKENS_CSS_PATH} from ${SNAPSHOT_PATH}.`);
    expect(readFileSync(path.join(root, TOKENS_CSS_PATH), 'utf8')).toBe(
      readFileSync(path.join(repoRoot, TOKENS_CSS_PATH), 'utf8'),
    );
    expect(run(['check'], root, output)).toBe(0);
  });

  it('fails check when tokens.css was edited by hand', () => {
    run(['write'], root, output);
    writeFileSync(path.join(root, TOKENS_CSS_PATH), ':root { --fg: red; }\n');
    expect(run(['check'], root, output)).toBe(1);
  });

  it('prints usage for unknown or missing commands', () => {
    expect(run([], root, output)).toBe(2);
    expect(run(['generate'], root, output)).toBe(2);
    expect(output.error).toHaveBeenCalledWith('Usage: tokens-from-pen <write|check>');
  });
});
