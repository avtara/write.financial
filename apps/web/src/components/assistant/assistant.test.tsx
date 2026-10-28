// SPDX-License-Identifier: AGPL-3.0-only
import { Component, type ReactNode } from 'react';
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

describe('AssistantProvider', () => {
  it('opens on ⌘J and closes through the dialog', async () => {
    await renderApp(
      <AssistantProvider timeZone="Asia/Jakarta">
        <Opener />
      </AssistantProvider>,
    );
    expect(page.getByRole('dialog').elements()).toHaveLength(0);
    await userEvent.keyboard('{Meta>}j{/Meta}');
    await expect.element(page.getByText('dialog open')).toBeVisible();
    await page.getByRole('button', { name: 'tutup' }).click();
    await expect.element(page.getByText('dialog open')).not.toBeInTheDocument();
  });

  it('opens for a caller through the hook', async () => {
    await renderApp(
      <AssistantProvider timeZone="Asia/Jakarta">
        <Opener />
      </AssistantProvider>,
    );
    await page.getByRole('button', { name: 'buka asisten' }).click();
    await expect.element(page.getByRole('dialog', { name: 'Asisten' })).toBeVisible();
  });
});

class Boundary extends Component<{ readonly children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error === null ? this.props.children : <output role="alert">{this.state.error.name}</output>;
  }
}

it('reports an unconfigured Assistant instead of accepting commands without its provider', async () => {
  await renderApp(
    <Boundary>
      <Opener />
    </Boundary>,
  );
  await expect.element(page.getByRole('alert')).toMatchTextContent('MissingAssistantProviderError');
  expect(page.getByRole('button', { name: 'buka asisten' }).elements()).toHaveLength(0);
});
