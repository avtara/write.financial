// SPDX-License-Identifier: AGPL-3.0-only
import type { ReceivableView } from '@wf/db/receivables';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NADIA } from '../../../test/receivable-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { WriteOffDialog } from './write-off-dialog.tsx';

const fake = vi.hoisted(() => ({ writeOffReceivable: vi.fn() }));
vi.mock('../../server/fn/receivables.ts', () => fake);

afterEach(() => {
  vi.clearAllMocks();
});

function Harness({ onSaved }: { onSaved: (receivable: ReceivableView) => void }) {
  const [target, setTarget] = useState<ReceivableView | null>(NADIA);
  return (
    <WriteOffDialog
      receivable={target}
      onClose={() => {
        setTarget(null);
      }}
      locale="id"
      onSaved={onSaved}
    />
  );
}

describe('WriteOffDialog ("Hapuskan")', () => {
  it('says what happens, reports a refusal, retries with the same key, and closes', async () => {
    fake.writeOffReceivable
      .mockResolvedValueOnce({ ok: false, code: 'PERIOD_CLOSED' })
      .mockResolvedValueOnce({ ok: true, value: 'written off' });
    const onSaved = vi.fn();
    const { screen } = await renderApp(<Harness onSaved={onSaved} />);
    const dialog = screen.getByRole('dialog', { name: 'Hapuskan piutang Nadia?' });
    await expect
      .element(dialog)
      .toMatchTextContent(/Sisa Rp242\.500 dicatat sebagai pengeluaran “Piutang tak tertagih” hari ini/);
    await dialog.getByRole('button', { name: 'Hapuskan' }).click();
    await expect.element(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByRole('button', { name: 'Hapuskan' }).click();
    await vi.waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith('written off');
    });
    const [first, second] = fake.writeOffReceivable.mock.calls as [
      [{ data: { clientId: string } }],
      [{ data: { clientId: string } }],
    ];
    expect(second[0].data.clientId).toBe(first[0].data.clientId);
    expect(first[0].data).toMatchObject({ id: NADIA.id, occurredAt: expect.any(Date) as unknown });
    await dialog.getByRole('button', { name: 'Batal' }).click();
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
  });
});
