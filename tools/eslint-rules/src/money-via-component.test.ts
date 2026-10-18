// SPDX-License-Identifier: AGPL-3.0-only
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { moneyViaComponent } from './money-via-component.ts';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } });
const error = (name: string) => ({ messageId: 'rendered', data: { name } });

ruleTester.run('money-via-component', moneyViaComponent, {
  valid: [
    '<Money minor={balanceMinor} currency="IDR" context="amount" />',
    '<Delta minor={row.deltaMinor} currency="IDR" />',
    '<WalletCard balanceMinor={account.balanceMinor} />',
    '<ui.Card totalMinor={totalMinor} />',
    '<ul>{rows.map((row) => <li key={row.id}><Money minor={row.amountMinor} currency="IDR" context="table" /></li>)}</ul>',
    '<ul>{rows.map(({ amountMinor, id }) => <li key={id}><Money minor={amountMinor} currency="IDR" context="table" /></li>)}</ul>',
    '<ul>{rows.map(([amountMinor]) => <Money minor={amountMinor} currency="IDR" context="table" />)}</ul>',
    '<ul>{rows.map(({ id, ...restMinor }) => <Row key={id} />)}</ul>',
    '<ul>{rows.map(function (amountMinor) { return <Money minor={amountMinor} currency="IDR" context="table" />; })}</ul>',
    '<p>{(() => { const totalMinor = sum(); return <Money minor={totalMinor} currency="IDR" context="amount" />; })()}</p>',
    '<p>{(() => { function f(amountMinor) { return 0; } return f(1); })()}</p>',
    '<p>{config({ amountMinor: 1 })}</p>',
    '<p>{format({ [key]: 1 })}</p>',
    '<p>{count}</p>',
    '<p>{Minor}</p>',
    'const label = String(balanceMinor);',
  ],
  invalid: [
    { code: '<p>{balanceMinor}</p>', errors: [error('balanceMinor')] },
    { code: '<>{row.amountMinor}</>', errors: [error('amountMinor')] },
    { code: '<p>{formatMoney(totalMinor, "IDR", options)}</p>', errors: [error('totalMinor')] },
    { code: '<p>{rows.map((row) => row.amountMinor)}</p>', errors: [error('amountMinor')] },
    { code: '<p>{rows.map(({ id }) => id + amountMinor)}</p>', errors: [error('amountMinor')] },
    { code: '<p>{(() => { const shown = totalMinor; return shown; })()}</p>', errors: [error('totalMinor')] },
    { code: '<p>{format({ [amountMinor]: 1 })}</p>', errors: [error('amountMinor')] },
    { code: '<span title={balanceMinor} />', errors: [error('balanceMinor')] },
    { code: '<data value={String(balanceMinor)} />', errors: [error('balanceMinor')] },
    { code: '<WalletCard label={balanceMinor} />', errors: [error('balanceMinor')] },
    { code: '<svg:text balanceMinor={balanceMinor} />', errors: [error('balanceMinor')] },
    { code: '<Card xlink:totalMinor={totalMinor} />', errors: [error('totalMinor')] },
  ],
});
