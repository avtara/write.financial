// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import { TableSearch } from './table-search.tsx';

/** Applies the search like the page does (into `value`), recording each change. */
function Harness({ initial, onChange }: { initial?: string; onChange: (query: string | undefined) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <TableSearch
        value={value}
        hits={4}
        onChange={(query) => {
          onChange(query);
          setValue(query);
        }}
      />
      <button
        type="button"
        onClick={() => {
          setValue('netflix');
        }}
      >
        Dari luar
      </button>
      <button
        type="button"
        onClick={() => {
          setValue(undefined);
        }}
      >
        Hapus dari luar
      </button>
    </>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('TableSearch', () => {
  it('focuses on /, searches after a pause, and shows the hits with a clear button', async () => {
    const onChange = vi.fn();
    const { screen } = await renderApp(<Harness onChange={onChange} />);
    const input = screen.getByRole('searchbox', { name: 'Cari transaksi' });
    await expect.element(input).toHaveAttribute('placeholder', 'Cari merchant, catatan, atau #tag');
    await expect.element(screen.getByText('/')).toBeVisible();
    await userEvent.keyboard('/');
    await expect.element(input).toHaveFocus();
    await userEvent.fill(input, ' kantor ');
    await expect.poll(() => onChange.mock.calls).toEqual([['kantor']]);
    await expect.element(screen.getByText('4 hasil')).toBeVisible();
    await expect.element(input).toHaveValue(' kantor ');
    await userEvent.click(screen.getByRole('button', { name: 'Hapus pencarian' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    await expect.element(input).toHaveValue('');
    await expect.element(input).toHaveFocus();
  });

  it('clears on Escape, then leaves the field', async () => {
    const onChange = vi.fn();
    const { screen } = await renderApp(<Harness initial="gojek" onChange={onChange} />);
    const input = screen.getByRole('searchbox');
    await expect.element(input).toHaveValue('gojek');
    await userEvent.click(input);
    await userEvent.keyboard('{Escape}');
    expect(onChange).toHaveBeenCalledWith(undefined);
    await expect.element(input).toHaveValue('');
    await expect.element(input).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await expect.element(input).not.toHaveFocus();
    await userEvent.click(input);
    await userEvent.keyboard('x');
    await userEvent.keyboard('{Enter}');
    await expect.element(input).toHaveFocus();
  });

  it('follows a search set elsewhere', async () => {
    const onChange = vi.fn();
    const { screen } = await renderApp(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Dari luar' }));
    await expect.element(screen.getByRole('searchbox')).toHaveValue('netflix');
    const { promise, resolve } = Promise.withResolvers<null>();
    setTimeout(() => {
      resolve(null);
    }, 400);
    await promise;
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Hapus dari luar' }));
    await expect.element(screen.getByRole('searchbox')).toHaveValue('');
  });
});
