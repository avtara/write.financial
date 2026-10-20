// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A translated sentence with components in it ("sisa {amount} · {daily}/hari" with `<Money>` for the amounts): the
 * message is rendered with a marker for each slot, then split, so word order stays the translator's and amounts still
 * go through `<Money>` (privacy mode, PRD §7.1).
 */
import { Fragment, type ReactNode } from 'react';

const MARK = '\u0001';

export interface RichMessageProps<K extends string> {
  /** A Paraglide message taking the slot names as inputs. */
  readonly message: (inputs: Record<K, string>) => string;
  readonly slots: Readonly<Record<K, ReactNode>>;
}

export function RichMessage<K extends string>({ message, slots }: RichMessageProps<K>) {
  const inputs = Object.fromEntries(Object.keys(slots).map((key) => [key, `${MARK}${key}${MARK}`])) as Record<
    K,
    string
  >;
  return (
    <>
      {message(inputs)
        .split(MARK)
        // Odd parts are slot names: the text alternates with markers.
        .map((part, index) => (
          <Fragment key={index}>{index % 2 === 1 ? slots[part as K] : part}</Fragment>
        ))}
    </>
  );
}
