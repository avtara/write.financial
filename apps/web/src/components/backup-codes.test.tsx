// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../test/render.tsx';
import { BACKUP_CODES_FILE, BackupCodes } from './backup-codes.tsx';

const CODES = ['aaaa-1111', 'bbbb-2222', 'cccc-3333'];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BackupCodes', () => {
  it('lists the codes, copies and downloads them, and continues once they are saved', async () => {
    const onDone = vi.fn();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const { screen } = await renderApp(<BackupCodes codes={CODES} onDone={onDone} />, {
      preferences: { locale: 'en' },
    });
    await expect.element(screen.getByRole('list', { name: 'Backup codes' })).toHaveTextContent(CODES.join(''));

    await userEvent.click(screen.getByRole('button', { name: 'Copy all' }));
    expect(writeText).toHaveBeenCalledWith(CODES.join('\n'));
    await expect.element(screen.getByRole('button', { name: 'Copied' })).toBeVisible();

    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Download .txt' }));
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(await blob.text()).toBe(`write.financial backup codes — each code works once.\n\n${CODES.join('\n')}\n`);
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe(BACKUP_CODES_FILE);
    expect(link.href).toMatch(/^blob:/);
    expect(revokeObjectURL).toHaveBeenCalledWith(link.href);

    const done = screen.getByRole('button', { name: 'Done' });
    await expect.element(done).toBeDisabled();
    await userEvent.click(screen.getByLabelText('I have saved my backup codes'));
    await userEvent.click(done);
    expect(onDone).toHaveBeenCalledOnce();
  });
});
