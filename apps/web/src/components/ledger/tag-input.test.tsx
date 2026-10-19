// SPDX-License-Identifier: AGPL-3.0-only
import type { TagView } from '@wf/db/tags';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { TAGS } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { TagInput } from './tag-input.tsx';

function Tags({
  initial = [],
  tags = TAGS,
  onValueChange,
  withId = true,
}: {
  readonly initial?: readonly string[];
  readonly tags?: readonly TagView[];
  readonly onValueChange?: (tags: string[]) => void;
  readonly withId?: boolean;
}) {
  const [value, setValue] = useState<readonly string[]>(initial);
  return (
    <div>
      <button type="button">Di luar</button>
      <button
        type="button"
        onPointerDown={(event) => {
          event.preventDefault();
        }}
      >
        Tanpa fokus
      </button>
      <label htmlFor="tags">Tag</label>
      <TagInput
        {...(withId ? { id: 'tags' } : {})}
        aria-describedby="tags-hint"
        value={value}
        tags={tags}
        onValueChange={(next) => {
          onValueChange?.(next);
          setValue(next);
        }}
      />
    </div>
  );
}

const input = () => page.getByRole('combobox', { name: 'Tag' });
const options = () =>
  page
    .getByRole('option')
    .elements()
    .map((option) => option.textContent);
const frequentRow = () => page.getByText(/^Sering dipakai:/);

describe('TagInput', () => {
  it('suggests tags by slug or alias, most used first, and offers to create one', async () => {
    await renderApp(<Tags />);
    await expect.element(input()).toHaveAttribute('placeholder', 'Tambah tag…');
    await expect.element(input()).toHaveAttribute('aria-describedby', 'tags-hint');
    await expect.element(input()).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(input());
    // Nothing typed: no list.
    await expect.element(input()).toHaveAttribute('aria-expanded', 'false');

    await userEvent.keyboard('#ke');
    await expect.element(input()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(page.getByText('Tag yang ada')).toBeVisible();
    expect(options()).toEqual(['#keluarga4× dipakai', 'Buat tag #ke']);
    await expect.element(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await expect.element(page.getByText('0 / 5 tag')).toBeVisible();

    await userEvent.fill(input(), 'bali');
    await expect.poll(options).toEqual(['#liburan-bali7× dipakai', 'Buat tag #bali']);
    // An existing slug is not offered for creation.
    await userEvent.fill(input(), 'kopi');
    await expect.poll(options).toEqual(['#kopi2× dipakai']);
  });

  it('moves with ↑/↓ and adds with Enter', async () => {
    const onValueChange = vi.fn();
    await renderApp(<Tags onValueChange={onValueChange} />);
    await userEvent.click(input());
    await userEvent.keyboard('k');
    await expect.poll(options).toEqual(['#kantor18× dipakai', '#keluarga4× dipakai', '#kopi2× dipakai', 'Buat tag #k']);
    await userEvent.keyboard('{ArrowDown}');
    await expect.element(page.getByRole('option', { name: /keluarga/ })).toHaveAttribute('aria-selected', 'true');
    await expect
      .element(input())
      .toHaveAttribute('aria-activedescendant', page.getByRole('option').nth(1).element().id);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    await expect.element(page.getByRole('option', { name: /kantor/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowUp}');
    await expect.element(page.getByRole('option', { name: 'Buat tag #k' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowUp}{Enter}');
    expect(onValueChange).toHaveBeenLastCalledWith(['kopi']);
    await expect.element(input()).toHaveValue('');
    await expect.element(page.getByRole('button', { name: 'Hapus tag kopi' })).toBeVisible();

    // A new tag, normalized.
    await userEvent.keyboard('#Mudik 2026{Enter}');
    expect(onValueChange).toHaveBeenLastCalledWith(['kopi', 'mudik-2026']);
  });

  it('ignores arrows and modified Enter while closed, and Enter with nothing to add', async () => {
    const onValueChange = vi.fn();
    await renderApp(<Tags onValueChange={onValueChange} />);
    await userEvent.click(input());
    await userEvent.keyboard('{ArrowDown}{ArrowUp}{Enter}');
    await userEvent.keyboard('#');
    await expect.element(input()).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('{Enter}');
    await userEvent.fill(input(), 'kantor');
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onValueChange).not.toHaveBeenCalled();
    await expect.element(input()).toHaveValue('kantor');
  });

  it('adds a tag typed again only once', async () => {
    const onValueChange = vi.fn();
    await renderApp(<Tags initial={['kantor']} onValueChange={onValueChange} />);
    await userEvent.click(input());
    await userEvent.keyboard('kantor');
    await expect.element(input()).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('{Enter}');
    expect(onValueChange).not.toHaveBeenCalled();
    await expect.element(input()).toHaveValue('');
  });

  it('removes tags with their button or Backspace in an empty field', async () => {
    const onValueChange = vi.fn();
    await renderApp(<Tags initial={['kantor', 'kopi']} onValueChange={onValueChange} />);
    await userEvent.click(page.getByRole('button', { name: 'Hapus tag kantor' }));
    expect(onValueChange).toHaveBeenLastCalledWith(['kopi']);
    await userEvent.click(input());
    await userEvent.keyboard('x{Backspace}');
    expect(onValueChange).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Backspace}');
    expect(onValueChange).toHaveBeenLastCalledWith([]);
    await userEvent.keyboard('{Backspace}');
    expect(onValueChange).toHaveBeenCalledTimes(2);
  });

  it('adds frequent tags from "Sering dipakai" and by clicking a suggestion', async () => {
    const onValueChange = vi.fn();
    await renderApp(<Tags initial={['kantor']} onValueChange={onValueChange} />);
    await expect.element(frequentRow()).toBeVisible();
    expect(page.getByRole('button', { name: 'Tambah tag kantor' }).query()).toBeNull();
    // Unused tags are never "frequent".
    expect(page.getByRole('button', { name: 'Tambah tag baru' }).query()).toBeNull();
    await userEvent.click(page.getByRole('button', { name: 'Tambah tag liburan-bali' }));
    expect(onValueChange).toHaveBeenLastCalledWith(['kantor', 'liburan-bali']);

    await userEvent.click(input());
    await userEvent.keyboard('kel');
    await userEvent.click(page.getByRole('option', { name: /keluarga/ }));
    expect(onValueChange).toHaveBeenLastCalledWith(['kantor', 'liburan-bali', 'keluarga']);
    await expect.element(input()).toHaveFocus();
  });

  it('closes the list with Escape until the text changes, and when clicking outside', async () => {
    await renderApp(<Tags initial={['kopi']} />);
    await userEvent.click(input());
    await userEvent.keyboard('ka');
    await expect.element(input()).toHaveAttribute('aria-expanded', 'true');
    // Clicking in the field keeps it open.
    await userEvent.click(input());
    await expect.element(input()).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    await expect.element(input()).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('n');
    await expect.element(input()).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(page.getByRole('button', { name: 'Di luar' }));
    await expect.element(input()).toHaveAttribute('aria-expanded', 'false');
    // Coming back to the text shows its suggestions again.
    await userEvent.click(input());
    await expect.element(input()).toHaveAttribute('aria-expanded', 'true');
    // A click outside that leaves focus in the field dismisses the list.
    await userEvent.click(page.getByRole('button', { name: 'Tanpa fokus' }));
    await expect.element(input()).toHaveAttribute('aria-expanded', 'false');
    await expect.element(input()).toHaveFocus();
  });

  it('stops at five tags', async () => {
    await renderApp(<Tags initial={['a', 'b', 'c', 'd', 'e']} withId={false} />);
    const field = page.getByRole('combobox');
    await expect.element(field).toBeDisabled();
    await expect.element(field).toHaveAttribute('placeholder', 'Maks. 5 tag');
    expect(field.element().id).toBe('');
    expect(frequentRow().query()).toBeNull();
  });

  it('shows no "Sering dipakai" without used tags, nor "Tag yang ada" without matches', async () => {
    await renderApp(<Tags tags={[]} />);
    expect(frequentRow().query()).toBeNull();
    await userEvent.click(input());
    await userEvent.keyboard('baru');
    await expect.poll(options).toEqual(['Buat tag #baru']);
    expect(page.getByText('Tag yang ada').query()).toBeNull();
  });
});
