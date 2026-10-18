// SPDX-License-Identifier: AGPL-3.0-only
import { Component, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { CodeInput, type CodeInputProps } from './code-input.tsx';

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error === null ? this.props.children : <output>{this.state.error.name}</output>;
  }
}

async function renderCode(props: Partial<CodeInputProps> = {}) {
  const onChange = vi.fn<(code: string) => void>();
  const onComplete = vi.fn<(code: string) => void>();
  const screen = await render(
    <CodeInput
      label="Kode verifikasi"
      digitLabel={(position, length) => `Digit ${String(position)} dari ${String(length)}`}
      onChange={onChange}
      onComplete={onComplete}
      {...props}
    />,
  );
  const group = screen.getByRole('group', { name: 'Kode verifikasi' });
  const boxes = [...group.element().querySelectorAll('input')];
  const values = () => boxes.map((box) => box.value).join('|');
  return { screen, group, boxes, values, onChange, onComplete };
}

function paste(target: HTMLInputElement, text: string): void {
  const data = new DataTransfer();
  data.setData('text', text);
  target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
}

describe('CodeInput', () => {
  it('renders one labelled numeric box per digit, with one-time-code autofill on the first', async () => {
    const { screen, boxes } = await renderCode();
    expect(boxes).toHaveLength(6);
    await expect.element(screen.getByLabelText('Digit 1 dari 6')).toHaveAttribute('autocomplete', 'one-time-code');
    await expect.element(screen.getByLabelText('Digit 6 dari 6')).toHaveAttribute('autocomplete', 'off');
    for (const box of boxes) {
      expect(box.inputMode).toBe('numeric');
      expect(box.getAttribute('aria-invalid')).toBe('false');
    }
  });

  it('advances while typing, ignores non-digits, and completes once', async () => {
    const { boxes, values, onChange, onComplete } = await renderCode();
    await userEvent.click(boxes[0] as HTMLInputElement);
    await userEvent.keyboard('1a2');
    expect(values()).toBe('1|2||||');
    expect(document.activeElement).toBe(boxes[2]);
    expect(onChange).toHaveBeenLastCalledWith('12');
    await userEvent.keyboard('3456');
    expect(onComplete).toHaveBeenCalledExactlyOnceWith('123456');
    // The last box keeps focus instead of moving past the end.
    expect(document.activeElement).toBe(boxes[5]);
  });

  it('replaces a digit when typing into a filled box', async () => {
    const { boxes, values } = await renderCode({ length: 3 });
    await userEvent.click(boxes[0] as HTMLInputElement);
    await userEvent.keyboard('123');
    await userEvent.click(boxes[1] as HTMLInputElement);
    await userEvent.keyboard('9');
    expect(values()).toBe('1|9|3');
  });

  it('steps back with Backspace', async () => {
    const { boxes, values, onChange } = await renderCode({ length: 4 });
    await userEvent.click(boxes[0] as HTMLInputElement);
    await userEvent.keyboard('12');
    // Focus is on the empty third box: Backspace clears the second and moves there.
    await userEvent.keyboard('{Backspace}');
    expect(values()).toBe('1|||');
    expect(document.activeElement).toBe(boxes[1]);
    await userEvent.click(boxes[0] as HTMLInputElement);
    // A filled box is cleared in place.
    await userEvent.keyboard('{Backspace}');
    expect(values()).toBe('|||');
    expect(document.activeElement).toBe(boxes[0]);
    onChange.mockClear();
    // Nothing before the first box.
    await userEvent.keyboard('{Backspace}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves with the arrow keys and stops at both ends', async () => {
    const { boxes } = await renderCode({ length: 3 });
    await userEvent.click(boxes[0] as HTMLInputElement);
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(boxes[0]);
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(document.activeElement).toBe(boxes[2]);
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(boxes[1]);
    // Other keys keep their default behavior.
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toBe(boxes[2]);
  });

  it('fills every box from a pasted code, wherever it is pasted', async () => {
    const { boxes, values, onComplete } = await renderCode();
    paste(boxes[3] as HTMLInputElement, ' 123-456 ');
    await vi.waitFor(() => {
      expect(values()).toBe('1|2|3|4|5|6');
    });
    expect(onComplete).toHaveBeenCalledWith('123456');
    expect(document.activeElement).toBe(boxes[5]);
  });

  it('fills from the current box when a partial code is pasted, and ignores pastes without digits', async () => {
    const { boxes, values, onChange } = await renderCode();
    paste(boxes[2] as HTMLInputElement, '78');
    await vi.waitFor(() => {
      expect(values()).toBe('||7|8||');
    });
    expect(document.activeElement).toBe(boxes[4]);
    onChange.mockClear();
    paste(boxes[0] as HTMLInputElement, 'abc');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('accepts a whole code autofilled into the first box and clears a box emptied by the browser', async () => {
    const { boxes, values, onComplete } = await renderCode();
    await userEvent.fill(boxes[0] as HTMLInputElement, '654321');
    expect(values()).toBe('6|5|4|3|2|1');
    expect(onComplete).toHaveBeenCalledWith('654321');
    await userEvent.fill(boxes[2] as HTMLInputElement, '');
    expect(values()).toBe('6|5||3|2|1');
  });

  it('works without an onComplete handler', async () => {
    const onChange = vi.fn<(code: string) => void>();
    const screen = await render(<CodeInput label="Kode" digitLabel={() => 'Digit'} length={1} onChange={onChange} />);
    await userEvent.fill(screen.getByLabelText('Digit'), '7');
    expect(onChange).toHaveBeenCalledWith('7');
  });

  it('marks every box invalid or disabled', async () => {
    const { boxes } = await renderCode({ invalid: true, disabled: true });
    for (const box of boxes) {
      expect(box.getAttribute('aria-invalid')).toBe('true');
      expect(box.disabled).toBe(true);
    }
  });

  it.each([0, 2.5])('rejects length %d', async (length) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const screen = await render(
      <Boundary>
        <CodeInput label="Kode" digitLabel={() => 'Digit'} length={length} onChange={() => {}} />
      </Boundary>,
    );
    await expect.element(screen.getByText('RangeError')).toBeInTheDocument();
  });
});
