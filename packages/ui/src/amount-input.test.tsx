// SPDX-License-Identifier: AGPL-3.0-only
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { AmountInput, IDR_QUICK_ADDS, type AmountInputProps } from './amount-input.tsx';
import { PrivacyProvider } from './privacy.tsx';

type HarnessProps = Partial<Omit<AmountInputProps, 'value'>> & { initial?: bigint | null };

function Harness({ initial = null, onValueChange, currency = 'IDR', locale = 'id', ...props }: HarnessProps) {
  const [value, setValue] = useState<bigint | null>(initial);
  return (
    <>
      <AmountInput
        value={value}
        onValueChange={(minor) => {
          onValueChange?.(minor);
          setValue(minor);
        }}
        currency={currency}
        locale={locale}
        aria-label="Jumlah"
        {...props}
      />
      <button
        type="button"
        onClick={() => {
          setValue(null);
        }}
      >
        Reset
      </button>
    </>
  );
}

function withPrivacy(ui: ReactNode, hidden = false) {
  return render(
    <PrivacyProvider hidden={hidden} onHiddenChange={() => {}} hiddenLabel="nominal disembunyikan">
      {ui}
    </PrivacyProvider>,
  );
}

const input = () => page.getByRole('textbox', { name: 'Jumlah' });

describe('AmountInput', () => {
  it('parses shorthand as typed and formats it on blur', async () => {
    const onValueChange = vi.fn();
    await withPrivacy(<Harness onValueChange={onValueChange} />);
    await expect.element(page.getByText('Rp')).toBeVisible();
    await expect.element(input()).toHaveAttribute('inputmode', 'decimal');
    await userEvent.type(input(), '25rb');
    expect(onValueChange).toHaveBeenLastCalledWith(25_000n);
    await expect.element(input()).toHaveValue('25rb');
    await userEvent.tab();
    await expect.element(input()).toHaveValue('25.000');
    await userEvent.fill(input(), '1,5jt');
    expect(onValueChange).toHaveBeenLastCalledWith(1_500_000n);
    await userEvent.tab();
    await expect.element(input()).toHaveValue('1.500.000');
  });

  it('marks text that is not an amount invalid and reports null; empty is not invalid', async () => {
    const onValueChange = vi.fn();
    await withPrivacy(<Harness onValueChange={onValueChange} />);
    await userEvent.type(input(), '12abc');
    expect(onValueChange).toHaveBeenLastCalledWith(null);
    await expect.element(input()).toHaveAttribute('aria-invalid', 'true');
    await userEvent.tab();
    await expect.element(input()).toHaveValue('12abc');
    await userEvent.clear(input());
    expect(onValueChange).toHaveBeenLastCalledWith(null);
    await expect.element(input()).toHaveAttribute('aria-invalid', 'false');
  });

  it('adds the quick amounts to the current value', async () => {
    const onValueChange = vi.fn();
    await withPrivacy(<Harness onValueChange={onValueChange} quickAdds={IDR_QUICK_ADDS} />);
    const chips = page.getByRole('button', { name: /^\+/ });
    expect(chips.elements().map((chip) => chip.textContent)).toEqual(['+10.000', '+50.000', '+100.000', '+500.000']);
    await userEvent.click(page.getByRole('button', { name: '+50.000' }));
    expect(onValueChange).toHaveBeenLastCalledWith(50_000n);
    await expect.element(input()).toHaveValue('50.000');
    await userEvent.click(page.getByRole('button', { name: '+10.000' }));
    await expect.element(input()).toHaveValue('60.000');
  });

  it('follows a value set from outside', async () => {
    await withPrivacy(<Harness initial={485_000n} />);
    await expect.element(input()).toHaveValue('485.000');
    await userEvent.click(page.getByRole('button', { name: 'Reset' }));
    await expect.element(input()).toHaveValue('');
  });

  it('takes two decimals for USD and English separators', async () => {
    const onValueChange = vi.fn();
    await withPrivacy(<Harness currency="USD" locale="en" onValueChange={onValueChange} size="inline" />);
    await expect.element(page.getByText('US$')).toBeVisible();
    await userEvent.type(input(), '1234.5');
    expect(onValueChange).toHaveBeenLastCalledWith(123_450n);
    await userEvent.tab();
    await expect.element(input()).toHaveValue('1,234.50');
    await userEvent.fill(input(), '1.234');
    await expect.element(input()).toHaveAttribute('aria-invalid', 'true');
  });

  it('masks the amount in privacy mode until focused', async () => {
    await withPrivacy(<Harness initial={485_000n} />, true);
    await expect.element(input()).toHaveValue('••••••');
    await userEvent.click(input());
    await expect.element(input()).toHaveValue('485.000');
    await userEvent.tab();
    await expect.element(input()).toHaveValue('••••••');
  });

  it('passes field wiring through and can be disabled', async () => {
    const onKeyDown = vi.fn();
    await withPrivacy(
      <>
        <Harness
          id="jumlah"
          aria-describedby="hint"
          aria-invalid
          placeholder="Isi jumlah"
          autoFocus
          onKeyDown={onKeyDown}
          quickAdds={[100n]}
        />
        <p id="hint">Isi jumlah dulu</p>
      </>,
    );
    await expect.element(input()).toHaveFocus();
    await expect.element(input()).toHaveAttribute('id', 'jumlah');
    await expect.element(input()).toHaveAccessibleDescription('Isi jumlah dulu');
    await expect.element(input()).toHaveAttribute('aria-invalid', 'true');
    await expect.element(input()).toHaveAttribute('placeholder', 'Isi jumlah');
    await userEvent.keyboard('{Enter}');
    expect(onKeyDown).toHaveBeenCalled();
  });

  it('can be disabled with its chips', async () => {
    await withPrivacy(<Harness disabled quickAdds={IDR_QUICK_ADDS} />);
    await expect.element(input()).toBeDisabled();
    await expect.element(page.getByRole('button', { name: '+10.000' })).toBeDisabled();
  });
});
