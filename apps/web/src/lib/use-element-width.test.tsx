// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { useElementWidth } from './use-element-width.ts';

function Probe() {
  const [wide, setWide] = useState(false);
  const [ref, width] = useElementWidth();
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setWide(true);
        }}
      >
        widen
      </button>
      <div ref={ref} className={wide ? 'w-[300px]' : 'w-[120px]'}>
        {width === null ? 'unmeasured' : `${String(width)}px`}
      </div>
    </div>
  );
}

describe('useElementWidth', () => {
  it('measures the element and follows its resizes', async () => {
    const screen = await render(<Probe />);
    await expect.element(screen.getByText('120px')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'widen' }));
    await expect.element(screen.getByText('300px')).toBeVisible();
    await screen.unmount();
  });
});
