// SPDX-License-Identifier: AGPL-3.0-only
import { Money, type MoneyProps } from './money.tsx';

export type DeltaProps = Omit<MoneyProps, 'context'>;

/** A flow or difference: always signed (`+9.500.000`, `−2.277.000`), green when positive, red when negative. */
export function Delta(props: DeltaProps) {
  return <Money {...props} context="delta" />;
}
