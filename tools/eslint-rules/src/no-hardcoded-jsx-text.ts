// SPDX-License-Identifier: AGPL-3.0-only
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/types';
import type { Rule } from 'eslint';

/** Attributes whose string value is shown or announced to the user. */
const USER_FACING_ATTRIBUTES: Readonly<Record<string, true>> = {
  alt: true,
  title: true,
  label: true,
  placeholder: true,
  description: true,
  'aria-label': true,
  'aria-description': true,
  'aria-placeholder': true,
  'aria-roledescription': true,
  'aria-valuetext': true,
};

/** Language-neutral symbols used by the design (privacy dots, separators, signs, keyboard glyphs). */
const DEFAULT_ALLOW = ['•', '·', '−', '+', '×', '⌘', '⇧', '⌥', '⌃', '↵', '↑', '↓', '←', '→'];

/** Whitespace, punctuation, and digits carry no language, so they need no translation. */
const LANGUAGE_NEUTRAL = /^[\s\p{P}\p{N}]*$/u;

/** The string a JSX child or attribute value always renders, or `null` when it is computed. */
function staticText(value: TSESTree.Node | null): string | null {
  switch (value?.type) {
    case AST_NODE_TYPES.Literal:
      return typeof value.value === 'string' ? value.value : null;
    case AST_NODE_TYPES.TemplateLiteral:
      return value.expressions.length === 0 ? value.quasis.map((quasi) => quasi.value.cooked).join('') : null;
    case AST_NODE_TYPES.JSXExpressionContainer:
      return staticText(value.expression);
    default:
      return null;
  }
}

/**
 * D26: every user-facing string comes from a Paraglide message function, so both locales stay complete.
 * Flags JSX text, string children (`{'…'}`, `` {`…`} ``), and string values of user-facing attributes
 * (`title`, `alt`, `placeholder`, `label`, `description`, `aria-label`, …) that contain letters or symbols.
 * Whitespace, punctuation, digits, and the `allow` list (default: privacy dots, `·`, `−`, `+`, `×`, arrows,
 * keyboard glyphs) are language-neutral and allowed.
 */
export const noHardcodedJsxText: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Require user-facing JSX text to come from message functions (D26).' },
    schema: [
      {
        type: 'object',
        properties: { allow: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ allow: DEFAULT_ALLOW }],
    messages: {
      hardcoded: 'User-facing text "{{text}}" must come from a message function, e.g. {m.some_key()} (D26).',
    },
  },
  create(context) {
    const [{ allow }] = context.options as [{ allow: string[] }];
    const check = (node: Rule.Node, text: string | null): void => {
      if (text === null) return;
      const rest = allow.reduce((remaining, symbol) => remaining.split(symbol).join(''), text);
      if (!LANGUAGE_NEUTRAL.test(rest)) {
        context.report({ node, messageId: 'hardcoded', data: { text: text.trim() } });
      }
    };
    // ESLint's `Rule.Node` only models plain ESTree; the parsers emit the JSX nodes TSESTree describes.
    return {
      JSXText(node: Rule.Node) {
        const text = node as unknown as TSESTree.JSXText;
        check(node, text.value);
      },
      JSXExpressionContainer(node: Rule.Node) {
        const container = node as unknown as TSESTree.JSXExpressionContainer;
        // Attribute values are checked per attribute name below; children always render.
        if (container.parent.type !== AST_NODE_TYPES.JSXAttribute) check(node, staticText(container));
      },
      JSXAttribute(node: Rule.Node) {
        const attribute = node as unknown as TSESTree.JSXAttribute;
        if (attribute.name.type === AST_NODE_TYPES.JSXIdentifier && USER_FACING_ATTRIBUTES[attribute.name.name]) {
          check(node, staticText(attribute.value));
        }
      },
    };
  },
};
