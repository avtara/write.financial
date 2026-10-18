// SPDX-License-Identifier: AGPL-3.0-only
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { noUnjustifiedCoverageIgnore } from './no-unjustified-coverage-ignore.ts';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester();
const error = { messageId: 'unjustified' };

ruleTester.run('no-unjustified-coverage-ignore', noUnjustifiedCoverageIgnore, {
  valid: [
    'const a = 1;',
    '// a normal comment about v8 and ignoring things\nconst a = 1;',
    '/* v8 ignore next -- Node-only fallback, see #42 */\nconst a = 1;',
    '// c8 ignore next -- platform branch #7\nconst a = 1;',
    '/* istanbul ignore else -- unreachable by contract #1001 */\nconst a = 1;',
  ],
  invalid: [
    { code: '/* v8 ignore next */\nconst a = 1;', errors: [error] },
    { code: '// v8 ignore start\nconst a = 1;\n// v8 ignore stop', errors: [error, error] },
    { code: '/* c8 ignore next -- no issue reference */\nconst a = 1;', errors: [error] },
    { code: '/* istanbul ignore next #12 */\nconst a = 1;', errors: [error] },
    { code: '/* v8 ignore next -- #12 */\nconst a = 1;', errors: [error] },
  ],
});
