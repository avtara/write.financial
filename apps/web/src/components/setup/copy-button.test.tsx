// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import { CopyButton } from './copy-button.tsx';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CopyButton', () => {
  it('copies the value and says so', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const { screen } = await renderApp(<CopyButton value="chmod 600 x" label="Salin perintah" />);
    await expect.element(screen.getByRole('status')).toHaveTextContent('');
    await userEvent.click(screen.getByRole('button', { name: 'Salin perintah' }));
    expect(write).toHaveBeenCalledWith('chmod 600 x');
    await expect.element(screen.getByRole('status')).toHaveTextContent('Disalin');
  });

  it('asks to copy by hand when the clipboard refuses', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    const { screen } = await renderApp(<CopyButton value="x" label="Copy" />, { preferences: { locale: 'en' } });
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await expect.element(screen.getByRole('status')).toHaveTextContent("Couldn't copy. Copy it manually.");
  });
});
