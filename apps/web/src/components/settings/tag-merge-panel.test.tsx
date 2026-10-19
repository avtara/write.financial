// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tagView } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { matchTags, TagMergePanel } from './tag-merge-panel.tsx';

const server = vi.hoisted(() => ({ mergeTags: vi.fn() }));
vi.mock('../../server/fn/tags.ts', () => server);

const REIMBURSE = tagView('reimburse', 12, ['klaim']);
const OFFICE = tagView('reimburse-kantor', 3);
const WORK = tagView('kerja-reimburse', 1);
const HOME = tagView('rumah', 5);
const TAGS = [REIMBURSE, HOME, OFFICE, WORK];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('matchTags', () => {
  it('matches the normalized query in slugs and aliases, and lists everything for an empty query', () => {
    expect(matchTags(TAGS, '#Reimburse').map((tag) => tag.slug)).toEqual([
      'reimburse',
      'reimburse-kantor',
      'kerja-reimburse',
    ]);
    expect(matchTags(TAGS, 'klaim')).toEqual([REIMBURSE]);
    expect(matchTags(TAGS, ' # ')).toEqual(TAGS);
  });
});

describe('TagMergePanel', () => {
  it('merges the chosen tags into the most used one by default, or the chosen target', async () => {
    server.mergeTags
      .mockResolvedValue({ ok: true, value: tagView('reimburse', 16) })
      .mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    const merged = vi.fn();
    const { screen } = await renderApp(
      <TagMergePanel tags={TAGS} initial={[OFFICE.id]} onCancel={vi.fn()} onMerged={merged} />,
    );
    await expect.element(screen.getByRole('heading', { name: 'Gabungkan tag' })).toBeVisible();
    await expect.element(screen.getByText('Pilih minimal 2 tag untuk digabung.')).toBeVisible();
    await screen.getByLabelText('Cari tag').fill('reimburse');
    await expect.element(screen.getByText('3 hasil')).toBeVisible();
    await screen.getByRole('checkbox', { name: 'reimburse', exact: true }).click();
    await screen.getByRole('checkbox', { name: 'kerja-reimburse' }).click();
    await expect.element(screen.getByText('3 dipilih')).toBeVisible();
    await expect.element(screen.getByText('16 transaksi diperbarui (12 + 3 + 1)')).toBeVisible();
    await expect
      .element(screen.getByText('#reimburse-kantor, #kerja-reimburse dihapus dan menjadi nama lain dari #reimburse'))
      .toBeVisible();

    await screen.getByRole('button', { name: 'Gabungkan 3 tag' }).click();
    await expect.element(screen.getByText('Data ini sudah tidak ada. Muat ulang halaman.')).toBeVisible();
    await screen.getByRole('button', { name: 'Gabungkan 3 tag' }).click();
    expect(server.mergeTags).toHaveBeenLastCalledWith({
      data: { sourceIds: [OFFICE.id, WORK.id], targetId: REIMBURSE.id },
    });
    expect(merged).toHaveBeenCalledWith(tagView('reimburse', 16), [OFFICE, WORK]);

    await screen.getByRole('combobox', { name: 'Gabungkan ke' }).click();
    await screen.getByRole('option', { name: /#kerja-reimburse/ }).click();
    await screen.getByRole('button', { name: 'Gabungkan 3 tag' }).click();
    expect(server.mergeTags).toHaveBeenLastCalledWith({
      data: { sourceIds: [REIMBURSE.id, OFFICE.id], targetId: WORK.id },
    });

    await screen.getByRole('checkbox', { name: 'kerja-reimburse' }).click();
    await expect.element(screen.getByText('2 dipilih')).toBeVisible();
  });

  it('cancels with or without a selection', async () => {
    const cancel = vi.fn();
    const { screen } = await renderApp(
      <TagMergePanel tags={TAGS} initial={[REIMBURSE.id, HOME.id]} onCancel={cancel} onMerged={vi.fn()} />,
    );
    await screen.getByRole('button', { name: 'Batal' }).click();
    expect(cancel).toHaveBeenCalledTimes(1);
    await screen.getByRole('checkbox', { name: 'rumah' }).click();
    await screen.getByRole('button', { name: 'Batal' }).click();
    expect(cancel).toHaveBeenCalledTimes(2);
  });
});
