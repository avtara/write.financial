// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { Tooltip } from './tooltip.tsx';

describe('Tooltip', () => {
  it('shows on keyboard focus, describes its trigger, and hides on Escape', async () => {
    const screen = await render(
      <Tooltip content="Ringkasan">
        <button type="button">R</button>
      </Tooltip>,
    );
    await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument();
    await userEvent.tab();
    const tooltip = page.getByRole('tooltip');
    await expect.element(tooltip).toHaveTextContent('Ringkasan');
    await expect.element(screen.getByRole('button', { name: 'R' })).toHaveAccessibleDescription('Ringkasan');
    await userEvent.keyboard('{Escape}');
    await expect.element(tooltip).not.toBeInTheDocument();
  });

  it('shows on hover with a heading, multi-line body and hint', async () => {
    const screen = await render(
      <Tooltip content={'Baris 1\nBaris 2'} heading="Label" hint="Klik untuk rincian" side="right" delayDuration={0}>
        <button type="button">Titik</button>
      </Tooltip>,
    );
    await userEvent.hover(screen.getByRole('button', { name: 'Titik' }));
    await expect.element(page.getByRole('tooltip')).toHaveTextContent('LabelBaris 1 Baris 2Klik untuk rincian');
    const body = page
      .getByText(/Baris 1/)
      .elements()
      .find((element) => element.classList.contains('whitespace-pre-line'));
    expect(body?.textContent).toBe('Baris 1\nBaris 2');
    expect(getComputedStyle(body as HTMLElement).whiteSpace).toBe('pre-line');
    // Two lines high: the line break is kept.
    expect(body?.getBoundingClientRect().height).toBeGreaterThan(30);
  });
});
