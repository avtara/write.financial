// SPDX-License-Identifier: AGPL-3.0-only
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/types';
import type { Rule } from 'eslint';

/** Minor-unit amounts are named `<something>Minor` (`balanceMinor`, `posting.amountMinor`). */
const MINOR = /.Minor$/;
/** Components that render amounts themselves, honouring privacy mode (`AmountInput` masks its value until focused). */
const MONEY_COMPONENTS: Readonly<Record<string, true>> = { Money: true, Delta: true, AmountInput: true };
/** Comparisons yield a boolean; the amount itself never reaches the DOM. */
const COMPARISONS: Readonly<Record<string, true>> = {
  '===': true,
  '!==': true,
  '==': true,
  '!=': true,
  '<': true,
  '>': true,
  '<=': true,
  '>=': true,
};
/** Event handler props (`onClick`, `onValueChange`) hold code that runs later; it renders nothing. */
const EVENT_HANDLER = /^on[A-Z]/;

/** What a `*Minor` read inside JSX means for this rule. */
function classify(parent: TSESTree.Node, child: TSESTree.Node): 'binding' | 'allowed' | 'rendered' | 'continue' {
  switch (parent.type) {
    case AST_NODE_TYPES.ObjectPattern:
    case AST_NODE_TYPES.ArrayPattern:
    case AST_NODE_TYPES.RestElement:
    case AST_NODE_TYPES.AssignmentPattern:
      return 'binding';
    case AST_NODE_TYPES.VariableDeclarator:
      return child === parent.id ? 'binding' : 'continue';
    case AST_NODE_TYPES.ArrowFunctionExpression:
    case AST_NODE_TYPES.FunctionExpression:
    case AST_NODE_TYPES.FunctionDeclaration:
      return (parent.params as TSESTree.Node[]).includes(child) ? 'binding' : 'continue';
    case AST_NODE_TYPES.Property:
      // `{ amountMinor: 1 }` names a key; it does not read an amount.
      return child === parent.key && !parent.computed ? 'binding' : 'continue';
    case AST_NODE_TYPES.BinaryExpression:
      return COMPARISONS[parent.operator] ? 'allowed' : 'continue';
    case AST_NODE_TYPES.JSXExpressionContainer:
      // Children render as text; attribute containers are decided by their JSXAttribute.
      return parent.parent.type === AST_NODE_TYPES.JSXAttribute ? 'continue' : 'rendered';
    case AST_NODE_TYPES.JSXAttribute: {
      const element = parent.parent.name;
      const elementName = element.type === AST_NODE_TYPES.JSXIdentifier ? element.name : '';
      if (MONEY_COMPONENTS[elementName]) return 'allowed';
      if (parent.name.type === AST_NODE_TYPES.JSXIdentifier && EVENT_HANDLER.test(parent.name.name)) return 'allowed';
      const isComponent = element.type === AST_NODE_TYPES.JSXMemberExpression || /^[A-Z]/.test(elementName);
      const isMinorProp = parent.name.type === AST_NODE_TYPES.JSXIdentifier && MINOR.test(parent.name.name);
      // Passing an amount down as a `*Minor` prop keeps it a number; the receiving component is linted too.
      return isComponent && isMinorProp ? 'allowed' : 'rendered';
    }
    default:
      return 'continue';
  }
}

/**
 * PRD §7.1 + plan §7: money reaches the DOM only through `<Money>`/`<Delta>`, which apply the number
 * format, the U+2212 minus, and privacy mode. Amounts follow the `*Minor` naming convention, so this rule
 * flags any `*Minor` identifier or property read inside JSX — as a child (`{balanceMinor}`,
 * `{formatMoney(row.amountMinor, …)}`) or in an attribute (`title={balanceMinor}`) — unless the attribute
 * belongs to `<Money>`/`<Delta>`/`<AmountInput>`, is an event handler (`onValueChange={…}`), or is itself a `*Minor` prop of a component
 * (`<WalletCard balanceMinor={account.balanceMinor} />`). Parameters, destructuring, declarations, and
 * object keys are bindings, not reads; comparisons (`amountMinor === null`, `afterMinor < 0n`) yield booleans. Amounts with other names are out of scope; keep the convention.
 */
export const moneyViaComponent: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Require minor-unit money amounts in JSX to render through <Money> or <Delta>.' },
    schema: [],
    messages: {
      rendered: '"{{name}}" is a minor-unit amount; render it with <Money> or <Delta> (PRD §7.1).',
    },
  },
  create(context) {
    return {
      Identifier(node) {
        if (!MINOR.test(node.name)) return;
        // ESLint's `Rule.Node` only models plain ESTree; the parsers emit the JSX nodes TSESTree describes.
        let child = node as unknown as TSESTree.Node;
        // Program's parent is `null` at runtime even though the type says `undefined`.
        for (let parent = child.parent; parent; child = parent, parent = parent.parent) {
          const verdict = classify(parent, child);
          if (verdict === 'rendered') context.report({ node, messageId: 'rendered', data: { name: node.name } });
          if (verdict !== 'continue') return;
        }
      },
    };
  },
};
