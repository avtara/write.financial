// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import { AssistantProvider, useAssistant } from './assistant.tsx';

vi.mock('./assistant-dialog.tsx', () => ({
  AssistantDialog: ({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) =>
    open ? (
      <div role="dialog" aria-label="Asisten">
        <p>dialog open</p>
        <button type="button" onClick={onClose}>
          tutup
        </button>
      </div>
    ) : null,
}));

function Opener() {
  const assistant = useAssistant();
  return (
    <button
      type="button"
      onClick={() => {
        assistant.open();
      }}
    >
      buka asisten
    </button>
  );
}

const render = () =>
  renderApp(
    <AssistantProvider timeZone="Asia/Jakarta">
      <Opener />
    </AssistantProvider>,
    { preferences: { locale: 'id' } },
  );

describe('AssistantProvider', () => {
  it('opens on ⌘J and closes through the dialog', async () => {
    await render();
    expect(page.getByRole('dialog').elements()).toHaveLength(0);
    await userEvent.keyboard('{Meta>}j{/Meta}');
    await expect.element(page.getByText('dialog open')).toBeVisible();
    await page.getByRole('button', { name: 'tutup' }).click();
    await expect.element(page.getByText('dialog open')).not.toBeInTheDocument();
  });

  it('opens for a caller through the hook', async () => {
    await render();
    await page.getByRole('button', { name: 'buka asisten' }).click();
    await expect.element(page.getByRole('dialog', { name: 'Asisten' })).toBeVisible();
  });
});
