// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import { PinPad } from './pin-pad.tsx';

describe('PinPad', () => {
  it('takes the PIN from the keypad, announcing the progress but never the digits', async () => {
    const onComplete = vi.fn();
    const { screen } = await renderApp(<PinPad label="Masukkan PIN" onComplete={onComplete} />);
    const pad = screen.getByRole('group', { name: 'Masukkan PIN' });
    for (const digit of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']) {
      const key = pad.getByRole('button', { name: digit, exact: true });
      await expect.element(key).toBeVisible();
      // Touch targets of at least 40 px.
      expect(key.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
    }
    await userEvent.click(pad.getByRole('button', { name: '1', exact: true }));
    await userEvent.click(pad.getByRole('button', { name: '2', exact: true }));
    await expect.element(pad.getByText('2 dari 6 digit diisi')).toBeInTheDocument();
    await userEvent.click(pad.getByRole('button', { name: 'Hapus digit' }));
    await expect.element(pad.getByText('1 dari 6 digit diisi')).toBeInTheDocument();
    for (const digit of ['0', '9', '8', '7', '6']) {
      await userEvent.click(pad.getByRole('button', { name: digit, exact: true }));
    }
    expect(onComplete).toHaveBeenCalledExactlyOnceWith('109876');
    // Ready for the next attempt.
    await expect.element(pad.getByText('0 dari 6 digit diisi')).toBeInTheDocument();
    expect(pad.element().textContent).not.toContain('109876');
  });

  it('takes digits and Backspace from the physical keyboard, and leaves shortcuts with modifiers alone', async () => {
    const onComplete = vi.fn();
    const { screen } = await renderApp(<PinPad label="Masukkan PIN" onComplete={onComplete} />);
    await userEvent.keyboard('12');
    await expect.element(screen.getByText('2 dari 6 digit diisi')).toBeInTheDocument();
    await userEvent.keyboard('{Backspace}{Control>}3{/Control}{Meta>}3{/Meta}{Alt>}3{/Alt}x');
    await expect.element(screen.getByText('1 dari 6 digit diisi')).toBeInTheDocument();
    await userEvent.keyboard('23456');
    expect(onComplete).toHaveBeenCalledExactlyOnceWith('123456');
  });

  it('ignores input while disabled', async () => {
    const onComplete = vi.fn();
    const { screen } = await renderApp(<PinPad label="Masukkan PIN" onComplete={onComplete} disabled />);
    await expect.element(screen.getByRole('button', { name: '5', exact: true })).toBeDisabled();
    await expect.element(screen.getByRole('button', { name: 'Hapus digit' })).toBeDisabled();
    await userEvent.keyboard('123456');
    await expect.element(screen.getByText('0 dari 6 digit diisi')).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });
});
