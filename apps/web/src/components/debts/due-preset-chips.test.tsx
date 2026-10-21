// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import type { DuePreset } from '@wf/domain/receivables';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { DuePresetChips } from './due-preset-chips.tsx';

describe('DuePresetChips', () => {
  it('offers the presets from the bill date and picks one', async () => {
    function Chips() {
      const [value, setValue] = useState<DuePreset>('none');
      return (
        <DuePresetChips value={value} onChange={setValue} from={'2026-10-11' as LocalDate} locale="id" label="Tempo" />
      );
    }
    const { screen } = await renderApp(<Chips />);
    await expect
      .element(screen.getByRole('group', { name: 'Tempo' }))
      .toHaveTextContent('1 minggu2 mingguAkhir bulan · 31 OktTanpa tenggat');
    await expect.element(screen.getByRole('button', { name: 'Tanpa tenggat' })).toHaveAttribute('aria-pressed', 'true');
    await screen.getByRole('button', { name: '1 minggu' }).click();
    await expect.element(screen.getByRole('button', { name: '1 minggu' })).toHaveAttribute('aria-pressed', 'true');
  });
});
