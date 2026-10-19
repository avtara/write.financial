// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { tagView } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { similarGroups, TagsSection } from './tags-section.tsx';

const server = vi.hoisted(() => ({
  createTag: vi.fn(),
  renameTag: vi.fn(),
  mergeTags: vi.fn(),
  deleteTag: vi.fn(),
}));
vi.mock('../../server/fn/tags.ts', () => server);
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@wf/ui/toast', () => toasts);

const REIMBURSE = tagView('reimburse', 12, ['klaim', 'reimbursement']);
const OFFICE = tagView('reimburse-kantor', 3);
const WORK = tagView('kerja-reimburse', 1);
const HOME = tagView('rumah', 5);
const KOPI = tagView('kopi', 0);
const TAGS = [REIMBURSE, HOME, OFFICE, WORK, KOPI];
const PAIRS = [
  { a: 'kerja-reimburse', b: 'reimburse' },
  { a: 'reimburse', b: 'reimburse-kantor' },
  { a: 'kopi', b: 'kopi-susu' },
];

const ok = <T,>(value: T) => Promise.resolve({ ok: true, value });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('similarGroups', () => {
  it('joins overlapping pairs into groups ordered like the list and skips unknown slugs', () => {
    expect(similarGroups(TAGS, PAIRS)).toEqual([[REIMBURSE, OFFICE, WORK]]);
    expect(
      similarGroups(
        [REIMBURSE, OFFICE, WORK],
        [
          { a: 'kerja-reimburse', b: 'reimburse' },
          { a: 'kerja-reimburse', b: 'reimburse-kantor' },
          { a: 'reimburse', b: 'reimburse-kantor' },
        ],
      ),
    ).toEqual([[REIMBURSE, OFFICE, WORK]]);
    expect(similarGroups(TAGS, [])).toEqual([]);
  });
});

describe('TagsSection', () => {
  it('lists tags with usage and aliases, searches, and sorts by name', async () => {
    const { screen } = await renderApp(<TagsSection tags={TAGS} similar={[]} />);
    await expect.element(screen.getByText('5 tag')).toBeVisible();
    const list = screen.getByRole('list', { name: 'Daftar tag' });
    await expect.element(list.getByText('12×')).toBeVisible();
    await expect.element(list.getByText('juga dikenali: #klaim, #reimbursement')).toBeVisible();

    await screen.getByLabelText('Cari tag').fill('#KLAIM');
    expect(list.getByRole('listitem').elements()).toHaveLength(1);
    await screen.getByLabelText('Cari tag').fill('tidak-ada');
    await expect.element(screen.getByText('Tidak ada tag yang cocok.')).toBeVisible();
    await screen.getByLabelText('Cari tag').fill('');

    await screen.getByRole('combobox', { name: 'Urutkan tag' }).click();
    await screen.getByRole('option', { name: 'Nama A–Z' }).click();
    await expect.poll(() => list.getByRole('listitem').first().element().textContent).toContain('kerja-reimburse');
  });

  it('shows the empty state', async () => {
    const { screen } = await renderApp(<TagsSection tags={[]} similar={[]} />);
    await expect.element(screen.getByText(/Belum ada tag/)).toBeVisible();
  });

  it('creates a tag with the slug shown as you type', async () => {
    server.createTag
      .mockReturnValueOnce(Promise.resolve({ ok: false, code: 'INVALID_TAG' }))
      .mockReturnValueOnce(ok(tagView('dana-darurat')));
    const { screen } = await renderApp(<TagsSection tags={TAGS} similar={[]} />);
    await screen.getByRole('button', { name: 'Tag baru' }).click();
    const input = screen.getByRole('textbox', { name: 'Nama tag baru' });
    await expect.element(input).toHaveFocus();
    await expect.element(input).toHaveAccessibleDescription(/Huruf kecil/);
    await expect.element(screen.getByRole('button', { name: 'Buat tag' })).toBeDisabled();
    await input.fill('!!!');
    await expect.element(screen.getByText('Tag perlu huruf atau angka, maks. 32 karakter.')).toBeVisible();
    await expect.element(input).toHaveAttribute('aria-invalid', 'true');
    await input.fill('#Dana Darurat');
    await expect.element(screen.getByText('Disimpan sebagai #dana-darurat')).toBeVisible();
    await screen.getByRole('button', { name: 'Buat tag' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith(expect.objectContaining({ tone: 'error' }));
    });
    await expect.element(screen.getByRole('button', { name: 'Buat tag' })).toBeEnabled();
    await screen.getByRole('button', { name: 'Buat tag' }).click();
    expect(server.createTag).toHaveBeenLastCalledWith({ data: { input: '#Dana Darurat' } });
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith({ title: 'Tag #dana-darurat dibuat' });
    });
    await expect.element(screen.getByRole('textbox', { name: 'Nama tag baru' })).not.toBeInTheDocument();

    await screen.getByRole('button', { name: 'Tag baru' }).click();
    await screen.getByRole('button', { name: 'Batal' }).click();
    await expect.element(screen.getByRole('textbox', { name: 'Nama tag baru' })).not.toBeInTheDocument();
    await screen.getByRole('button', { name: 'Tag baru' }).click();
    await userEvent.keyboard('x');
    await expect.element(screen.getByRole('textbox', { name: 'Nama tag baru' })).toHaveValue('x');
    await userEvent.keyboard('{Escape}');
    await expect.element(screen.getByRole('textbox', { name: 'Nama tag baru' })).not.toBeInTheDocument();
  });

  it('renames and deletes from the row menu', async () => {
    server.renameTag.mockReturnValue(ok(tagView('rumah-tangga', 5)));
    server.deleteTag.mockReturnValue(ok(null));
    const { screen } = await renderApp(<TagsSection tags={TAGS} similar={[]} />);
    await screen.getByRole('button', { name: 'Menu #rumah' }).click();
    await screen.getByRole('menuitem', { name: 'Ganti nama' }).click();
    await screen.getByRole('button', { name: 'Batal' }).click();
    await expect.element(screen.getByRole('textbox', { name: 'Nama baru untuk #rumah' })).not.toBeInTheDocument();
    await screen.getByRole('button', { name: 'Menu #rumah' }).click();
    await screen.getByRole('menuitem', { name: 'Ganti nama' }).click();
    const input = screen.getByRole('textbox', { name: 'Nama baru untuk #rumah' });
    await expect.element(input).toHaveValue('rumah');
    await input.fill('Rumah Tangga');
    await screen.getByRole('button', { name: 'Simpan perubahan' }).click();
    expect(server.renameTag).toHaveBeenCalledWith({ data: { id: HOME.id, input: 'Rumah Tangga' } });
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith({ title: 'Tag diganti menjadi #rumah-tangga' });
    });

    await screen.getByRole('button', { name: 'Menu #rumah' }).click();
    await screen.getByRole('menuitem', { name: 'Hapus tag' }).click();
    const confirm = screen.getByRole('alertdialog', { name: 'Hapus tag #rumah?' });
    await expect.element(confirm.getByText(/dilepas dari 5 transaksi/)).toBeVisible();
    await confirm.getByRole('button', { name: 'Batal' }).click();
    await screen.getByRole('button', { name: 'Menu #kopi' }).click();
    await screen.getByRole('menuitem', { name: 'Hapus tag' }).click();
    const unused = screen.getByRole('alertdialog', { name: 'Hapus tag #kopi?' });
    await expect.element(unused.getByText('Tag ini belum dipakai. Tindakan ini tidak bisa dibatalkan.')).toBeVisible();
    await unused.getByRole('button', { name: 'Hapus tag' }).click();
    expect(server.deleteTag).toHaveBeenCalledWith({ data: { id: KOPI.id } });
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith({ title: 'Tag #kopi dihapus' });
    });
  });

  it('merges a similar group in one click or after review, and from a row', async () => {
    server.mergeTags.mockReturnValue(ok(tagView('reimburse', 16)));
    const { screen } = await renderApp(<TagsSection tags={TAGS} similar={PAIRS} />);
    const banner = screen.getByRole('region', { name: '3 tag terlihat sama' });
    await expect.element(banner.getByText('#reimburse 12× · #reimburse-kantor 3× · #kerja-reimburse 1×')).toBeVisible();
    await banner.getByRole('button', { name: 'Gabungkan ke #reimburse' }).click();
    expect(server.mergeTags).toHaveBeenCalledWith({
      data: { sourceIds: [OFFICE.id, WORK.id], targetId: REIMBURSE.id },
    });
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith({
        title: '3 tag digabung ke #reimburse',
        description: '#reimburse-kantor, #kerja-reimburse tetap dikenali saat kamu mengetik.',
      });
    });

    await banner.getByRole('button', { name: 'Tinjau & gabungkan' }).click();
    await expect.element(screen.getByText('3 dipilih')).toBeVisible();
    await screen.getByRole('button', { name: 'Gabungkan 3 tag' }).click();
    await expect.element(screen.getByRole('heading', { name: 'Gabungkan tag' })).not.toBeInTheDocument();
    expect(server.mergeTags).toHaveBeenCalledTimes(2);

    await screen.getByRole('button', { name: 'Menu #rumah' }).click();
    await screen.getByRole('menuitem', { name: 'Gabungkan dengan…' }).click();
    await expect.element(screen.getByText('1 dipilih')).toBeVisible();
    await screen.getByRole('button', { name: 'Batal' }).click();
    await expect.element(screen.getByRole('list', { name: 'Daftar tag' })).toBeVisible();
  });
});
