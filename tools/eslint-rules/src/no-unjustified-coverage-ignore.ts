// SPDX-License-Identifier: AGPL-3.0-only
import type { AST, Rule } from 'eslint';

const IGNORE_HINT = /\b(?:v8|c8|istanbul)\s+ignore\b/;
/** Justification after `--`, ending with an issue reference such as `#123`. */
const JUSTIFIED = /--\s*\S.*#\d+/;

/**
 * D27: coverage ignore hints hide untested code from the 100% gate.
 * They are allowed only with a written reason and a tracking issue:
 * `/* v8 ignore next -- Node-only fallback, see #42 *\/`
 */
export const noUnjustifiedCoverageIgnore: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Require a reason and an issue reference on coverage ignore comments (D27).' },
    schema: [],
    messages: {
      unjustified:
        'Coverage ignore comments need a reason and an issue reference, e.g. "v8 ignore next -- <reason>, see #123" (D27).',
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (IGNORE_HINT.test(comment.value) && !JUSTIFIED.test(comment.value)) {
            // ESLint always attaches `loc` to comments; the ESTree type marks it optional.
            context.report({ loc: comment.loc as AST.SourceLocation, messageId: 'unjustified' });
          }
        }
      },
    };
  },
};
