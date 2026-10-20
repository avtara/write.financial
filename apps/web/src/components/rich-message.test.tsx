// SPDX-License-Identifier: AGPL-3.0-only
import { m } from '@wf/i18n/messages';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../test/render.tsx';
import { RichMessage } from './rich-message.tsx';

describe('RichMessage', () => {
  it('puts components into a translated sentence in the translator’s word order', async () => {
    const { screen } = await renderApp(
      <p data-testid="note">
        <RichMessage
          message={m.budget_line_left_daily}
          slots={{ amount: <strong>Rp300.000</strong>, daily: <em>Rp18.000</em> }}
        />
      </p>,
    );
    const note = screen.getByTestId('note');
    await expect.element(note).toHaveTextContent('sisa Rp300.000 · Rp18.000/hari');
    expect(note.element().querySelector('strong')?.textContent).toBe('Rp300.000');
    expect(note.element().querySelector('em')?.textContent).toBe('Rp18.000');
  });

  it('renders a slot at the very start and plain strings as slots', async () => {
    const { screen } = await renderApp(
      <p data-testid="title">
        <RichMessage message={m.budget_kpi_over_one} slots={{ name: 'Belanja', amount: <b>Rp400.000</b> }} />
      </p>,
    );
    await expect.element(screen.getByTestId('title')).toHaveTextContent('Belanja +Rp400.000');
  });
});
