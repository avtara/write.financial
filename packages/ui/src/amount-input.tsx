// SPDX-License-Identifier: AGPL-3.0-only
import { currencyInfo, formatMoney, groupAmountInput, parseMoneyInput, type Locale } from '@wf/domain/money';
import { useLayoutEffect, useRef, useState, type KeyboardEventHandler } from 'react';
import { usePrivacy } from './privacy.tsx';

export interface AmountInputProps {
  /** Minor units; `null` while empty or not a valid amount. */
  value: bigint | null;
  onValueChange: (minor: bigint | null) => void;
  /** ISO 4217 code: the prefix (`Rp`, `US$`) and the allowed decimals follow it. */
  currency: string;
  locale: Locale;
  /**
   * Amounts (minor units) offered as chips that add to the current value (FR-T2: `+10.000` … `+500.000` for IDR).
   * Default none.
   */
  quickAdds?: readonly bigint[];
  /** `hero`: the 32 px amount of the Record Transaction sheet · `inline`: a 14 px field (Quick Add bar, dialogs). */
  size?: 'hero' | 'inline';
  /** From a `Field`, or `aria-label` when there is no visible label. */
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string | undefined;
  /** Shown as invalid even when the text parses (e.g. "Isi jumlah dulu"); unparseable text always is. */
  'aria-invalid'?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}

/** IDR chips from the design: +10.000, +50.000, +100.000, +500.000. */
export const IDR_QUICK_ADDS: readonly bigint[] = [10_000n, 50_000n, 100_000n, 500_000n];

const INPUT: Readonly<Record<'hero' | 'inline', { prefix: string; input: string }>> = {
  hero: {
    prefix: 'text-[20px] text-subtle',
    input: 'text-[32px] font-medium tracking-[-1px] placeholder:text-text-faint',
  },
  inline: { prefix: 'text-[14px] text-subtle', input: 'text-[14px] placeholder:text-subtle' },
};

/**
 * Money entry (FR-T2): accepts what people type — "25rb", "1,5jt", "25k", "1.234.567", "12,50" for USD — parsed by
 * `parseMoneyInput` for the locale and currency. Typed digits are grouped as they go ("213123123" shows
 * "213.123.123", the caret staying after the same digits); once the person types anything but a digit themselves
 * ("1.5jt", "2.500.000", "25rb") the text stays as typed until the field is emptied, and it shows formatted
 * (`25.000`) once the field loses focus. Text that is not an exact amount marks the field invalid and reports
 * `null`. In privacy mode the amount is masked until the field is focused, so it never sits on screen unattended.
 */
export function AmountInput({
  value,
  onValueChange,
  currency,
  locale,
  quickAdds = [],
  size = 'hero',
  id,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  'aria-invalid': invalid = false,
  placeholder = '0',
  autoFocus = false,
  disabled = false,
  onKeyDown,
}: AmountInputProps) {
  const { hidden } = usePrivacy();
  const show = (minor: bigint | null) =>
    minor === null ? '' : formatMoney(minor, currency, { locale, context: 'table' });
  const [text, setText] = useState(() => show(value));
  const [reported, setReported] = useState(value);
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  /** Where the caret goes after a regrouped keystroke (the new text moved it to the end). */
  const caret = useRef<number | null>(null);
  /** The person typed a separator or a shorthand: no live grouping for this entry. */
  const asTyped = useRef(false);
  const parsed = text.trim() === '' ? null : parseMoneyInput(text, { locale, currency });
  // A new value from outside (a chip, a reset, a draft) replaces the text; echoes of our own reports do not.
  if (value !== reported) {
    setReported(value);
    setText(show(value));
  }
  useLayoutEffect(() => {
    if (caret.current === null) return;
    // Set only by a keystroke in the input, so it is mounted.
    (input.current as HTMLInputElement).setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  const styles = INPUT[size];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 font-mono">
        <span aria-hidden="true" className={styles.prefix}>
          {currencyInfo(currency).symbol}
        </span>
        <input
          ref={input}
          {...(id === undefined ? {} : { id })}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          aria-invalid={invalid || (text.trim() !== '' && parsed === null)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          value={
            hidden && !focused && value !== null
              ? formatMoney(value, currency, { locale, context: 'table', privacy: true })
              : text
          }
          onChange={(event) => {
            const typed = (event.nativeEvent as InputEvent).data ?? '';
            let next = event.currentTarget.value;
            if (next.trim() === '') asTyped.current = false;
            else if (/\D/.test(typed)) asTyped.current = true;
            // A text input always has a selection (`selectionStart` is null only for types without one).
            const at = event.currentTarget.selectionStart as number;
            const grouped = asTyped.current ? null : groupAmountInput(next, at, { locale, currency });
            if (grouped !== null) {
              next = grouped.text;
              caret.current = grouped.caret;
            }
            const minor = next.trim() === '' ? null : parseMoneyInput(next, { locale, currency });
            setText(next);
            setReported(minor);
            onValueChange(minor);
          }}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
            asTyped.current = false;
            if (parsed !== null) setText(show(parsed));
          }}
          onKeyDown={onKeyDown}
          className={`w-full min-w-0 bg-transparent text-fg tabular-nums outline-none disabled:text-text-disabled aria-invalid:text-red-fg ${styles.input}`}
        />
      </div>
      {quickAdds.length === 0 ? null : (
        <div className="flex flex-wrap gap-1.5">
          {quickAdds.map((step) => (
            <button
              key={step.toString()}
              type="button"
              disabled={disabled}
              onClick={() => {
                onValueChange((value ?? 0n) + step);
              }}
              className="rounded-[5px] border border-border px-2 py-[3px] font-mono text-[11.5px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
            >
              {formatMoney(step, currency, { locale, context: 'delta' })}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
