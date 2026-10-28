// SPDX-License-Identifier: AGPL-3.0-only
import type { ReviewItemView } from '@wf/db/review';
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ACCOUNTS, BCA, CATEGORIES, categoryId, JAGO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import {
  CATEGORY_ITEM,
  GMAIL_ITEM,
  ICLOUD_ITEM,
  LEFTOVER_ITEM,
  NETFLIX_ITEM,
  reviewItem,
  ROLLOVER_ITEM,
  SISIHKAN_ITEM,
} from '../../../test/review-fixtures.ts';
import { ReviewPage } from './review-page.tsx';

const server = vi.hoisted(() => ({
  confirmReview: vi.fn(),
  confirmReviewBulk: vi.fn(),
  ignoreReview: vi.fn(),
  markReviewUnpaid: vi.fn(),
  removeTransactions: vi.fn(),
}));
vi.mock('../../server/fn/review.ts', () => server);
vi.mock('../../server/fn/transactions-write.ts', () => ({ removeTransactions: server.removeTransactions }));
const toasts = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { undo: vi.fn() }) }));
vi.mock('@wf/ui/toast', () => toasts);

const lookup = { baseCurrency: 'IDR', accounts: ACCOUNTS, categories: CATEGORIES };
const ok = <T,>(value: T) => ({ ok: true, value }) as const;
const ALL = [GMAIL_ITEM, CATEGORY_ITEM, ICLOUD_ITEM, NETFLIX_ITEM, SISIHKAN_ITEM, LEFTOVER_ITEM, ROLLOVER_ITEM];

async function renderPage(items: readonly ReviewItemView[] = ALL, focusItem?: string) {
  const result = await renderApp(
    <ReviewPage
      items={items}
      lookup={lookup}
      timeZone="Asia/Jakarta"
      today={'2026-10-15' as LocalDate}
      focusItem={focusItem}
    />,
  );
  const invalidate = vi.spyOn(result.router, 'invalidate').mockResolvedValue();
  return { ...result, invalidate };
}

const panel = (name: RegExp) => page.getByRole('region', { name });
const lastToast = (): unknown => toasts.toast.mock.lastCall?.[0];

afterEach(() => {
  vi.clearAllMocks();
});

describe('ReviewPage', () => {
  it('says when nothing waits', async () => {
    const { screen } = await renderPage([]);
    await expect.element(screen.getByRole('heading', { level: 1, name: 'Perlu ditinjau' })).toBeVisible();
    await expect.element(screen.getByText('Semua sudah ditinjau')).toBeVisible();
  });

  it("lists every reason in the design's panels; confidence only on AI results", async () => {
    const { screen } = await renderPage();
    await expect
      .element(
        screen.getByText('7 item menunggu konfirmasimu. Saldo dan anggaran baru berubah setelah kamu konfirmasi.'),
      )
      .toBeVisible();
    await expect.element(panel(/hasil AI/)).toMatchTextContent('Yakin 62%');
    await expect.element(panel(/^Perlu kategori · 1/)).toMatchTextContent('kategori Belanja Online dihapus');
    const bills = panel(/tagihan langganan jatuh tempo/);
    await expect.element(bills).toMatchTextContent('Perlu ditinjau · 2');
    await expect.element(bills).toMatchTextContent('Total menunggu Rp231.000');
    await expect.element(bills).not.toMatchTextContent('Yakin');
    await expect.element(panel(/setoran rutin jatuh tempo/)).toMatchTextContent('Rp1.150.000 menunggu');
    await expect
      .element(panel(/Usulan penutupan periode · 2/))
      .toMatchTextContent('periode September 2026 sudah ditutup');
  });

  it('"Sudah dibayar" records the bill only then, and refreshes the page and the badge', async () => {
    server.confirmReview.mockResolvedValue(ok({ transactionId: 'tx-1', overrideIds: [] }));
    const { screen, invalidate } = await renderPage();
    const netflix = screen.getByRole('article', { name: 'Netflix' });
    await userEvent.click(netflix.getByRole('button', { name: 'Sudah dibayar' }));
    expect(server.confirmReview).toHaveBeenCalledWith({ data: { itemId: NETFLIX_ITEM.id, edits: undefined } });
    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
    expect(lastToast()).toMatchObject({ tone: 'success', title: 'Tercatat' });
  });

  it('"Belum" keeps the bill waiting; failures are told', async () => {
    server.markReviewUnpaid.mockResolvedValueOnce(ok(null));
    const { screen } = await renderPage();
    const icloud = screen.getByRole('article', { name: 'iCloud+' });
    await userEvent.click(icloud.getByRole('button', { name: 'Belum' }));
    expect(server.markReviewUnpaid).toHaveBeenCalledWith({ data: { itemId: ICLOUD_ITEM.id } });
    await vi.waitFor(() => {
      expect(lastToast()).toMatchObject({ tone: 'info', title: 'Ditandai belum dibayar' });
    });
    server.markReviewUnpaid.mockResolvedValueOnce({ ok: false, code: 'REVIEW_RESOLVED' });
    await userEvent.click(icloud.getByRole('button', { name: 'Belum' }));
    await vi.waitFor(() => {
      expect(lastToast()).toMatchObject({ tone: 'error', title: 'Item ini sudah dikonfirmasi atau diabaikan.' });
    });
    server.markReviewUnpaid.mockRejectedValueOnce(new TypeError('offline'));
    await userEvent.click(icloud.getByRole('button', { name: 'Belum' }));
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledTimes(3);
    });
    expect(lastToast()).toMatchObject({ tone: 'error' });
  });

  it('"Tandai semua dibayar" asks first, then confirms each bill and reports refusals', async () => {
    server.confirmReviewBulk.mockResolvedValue(
      ok({ confirmed: [ICLOUD_ITEM.id], failed: [{ id: NETFLIX_ITEM.id, code: 'PERIOD_CLOSED' }] }),
    );
    const { screen } = await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Tandai semua dibayar' }));
    const dialog = page.getByRole('dialog', { name: 'Tandai 2 tagihan dibayar?' });
    await expect.element(dialog).toMatchTextContent('Total menunggu Rp231.000');
    await userEvent.click(dialog.getByRole('button', { name: 'Batal' }));
    await expect.element(dialog).not.toBeInTheDocument();
    expect(server.confirmReviewBulk).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Tandai semua dibayar' }));
    await userEvent.click(page.getByRole('dialog').getByRole('button', { name: 'Tandai dibayar' }));
    expect(server.confirmReviewBulk).toHaveBeenCalledWith({ data: { itemIds: [ICLOUD_ITEM.id, NETFLIX_ITEM.id] } });
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledTimes(2);
    });
    expect(toasts.toast.mock.calls.map(([options]: unknown[]) => options)).toMatchObject([
      { title: '1 item dikonfirmasi' },
      { title: '1 item belum bisa dikonfirmasi' },
    ]);
  });

  it('a bulk confirmation without results says nothing; bills in two currencies and of unknown accounts', async () => {
    server.confirmReviewBulk.mockResolvedValue(ok({ confirmed: [], failed: [] }));
    server.confirmReview.mockResolvedValue(ok({ transactionId: 'tx-1', overrideIds: [] }));
    const bill = (id: string, label: string | null, accountId: string) =>
      reviewItem(id, {
        label,
        dueDate: ICLOUD_ITEM.dueDate,
        occurrence: ICLOUD_ITEM.occurrence,
        payload: {
          kind: 'transaction',
          draft: { type: 'expense', occurredAt: new Date(), accountId, amountMinor: 45_000n, categoryId: null },
        },
      });
    const { screen } = await renderPage([
      ICLOUD_ITEM,
      bill('rv-usd', 'Cloud', 'acc-gotrade'),
      bill('rv-unknown', null, 'acc-missing'),
    ]);
    await expect.element(panel(/tagihan langganan/)).toMatchTextContent('Total menunggu Rp90.000 + ');
    await userEvent.click(screen.getByRole('article').nth(2).getByRole('button', { name: 'Sudah dibayar' }));
    expect(server.confirmReview).toHaveBeenCalledWith({ data: { itemId: 'rv-unknown', edits: undefined } });
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledOnce();
    });
    toasts.toast.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Tandai semua dibayar' }));
    await userEvent.click(page.getByRole('dialog').getByRole('button', { name: 'Tandai dibayar' }));
    await vi.waitFor(() => {
      expect(server.confirmReviewBulk).toHaveBeenCalled();
    });
    expect(toasts.toast).not.toHaveBeenCalled();
  });

  it('"Ubah nominal" then "Sudah ditransfer" confirms with the new amount; income bills are positive', async () => {
    server.confirmReview.mockResolvedValue(ok({ transactionId: 'tx-1', overrideIds: [] }));
    const income = reviewItem('rv-salary', {
      label: 'Retainer',
      dueDate: '2026-10-14' as LocalDate,
      occurrence: {
        id: 'o',
        sourceType: 'recurrence',
        sourceId: 's',
        status: 'unconfirmed',
        dueDate: '2026-10-14' as LocalDate,
      },
      payload: {
        kind: 'transaction',
        draft: { type: 'income', occurredAt: new Date(), accountId: JAGO.id, amountMinor: 5_000n, categoryId: null },
      },
    });
    const { screen } = await renderPage([SISIHKAN_ITEM, income]);
    server.markReviewUnpaid.mockResolvedValue(ok(null));
    const card = screen.getByRole('article', { name: 'Sisihkan dana tidak rutin' });
    await userEvent.click(card.getByRole('button', { name: 'Belum' }));
    expect(server.markReviewUnpaid).toHaveBeenCalledWith({ data: { itemId: SISIHKAN_ITEM.id } });
    await userEvent.click(card.getByRole('button', { name: 'Ubah nominal' }));
    await userEvent.clear(card.getByRole('textbox', { name: 'Nominal' }));
    await userEvent.type(card.getByRole('textbox', { name: 'Nominal' }), '1000000');
    await userEvent.click(card.getByRole('button', { name: 'Sudah ditransfer' }));
    expect(server.confirmReview).toHaveBeenCalledWith({
      data: { itemId: SISIHKAN_ITEM.id, edits: { amountMinor: 1_000_000n } },
    });
    await userEvent.click(
      screen.getByRole('article', { name: 'Retainer' }).getByRole('button', { name: 'Sudah diterima' }),
    );
    expect(server.confirmReview).toHaveBeenLastCalledWith({ data: { itemId: 'rv-salary', edits: undefined } });
  });

  it('records or ignores an AI result', async () => {
    server.confirmReview.mockResolvedValue(ok({ transactionId: 'tx-1', overrideIds: [] }));
    server.ignoreReview.mockResolvedValue(ok({ ignored: 1 }));
    const nameless = { ...GMAIL_ITEM, id: 'rv-nameless', label: null };
    const { screen } = await renderPage([GMAIL_ITEM, nameless]);
    const articles = screen.getByRole('article');
    const first = articles.nth(0);
    const second = articles.nth(1);
    await userEvent.click(first.getByRole('button', { name: 'Catat' }));
    expect(server.confirmReview).toHaveBeenCalledWith({ data: { itemId: GMAIL_ITEM.id } });
    await vi.waitFor(() => {
      expect(lastToast()).toMatchObject({ title: 'Tercatat' });
    });
    await userEvent.click(second.getByRole('button', { name: 'Catat' }));
    await userEvent.click(second.getByRole('button', { name: 'Abaikan' }));
    expect(server.ignoreReview).toHaveBeenCalledWith({ data: { itemIds: ['rv-nameless'] } });
    await vi.waitFor(() => {
      expect(lastToast()).toMatchObject({ tone: 'info', title: '1 item diabaikan' });
    });
  });

  it('categorizes per row ("Simpan") or all at once ("Terapkan" after a confirmation)', async () => {
    server.confirmReview.mockResolvedValue(ok({ transactionId: 'tx-mouse', overrideIds: [] }));
    server.confirmReviewBulk.mockResolvedValue(ok({ confirmed: [CATEGORY_ITEM.id], failed: [] }));
    server.ignoreReview.mockResolvedValue(ok({ ignored: 1 }));
    const other = {
      ...CATEGORY_ITEM,
      id: 'rv-cable',
      label: 'Shopee',
      subject: { ...CATEGORY_ITEM.subject, merchant: 'Shopee' },
      payload: { ...CATEGORY_ITEM.payload, previousCategoryName: 'Hobi' },
    } as ReviewItemView;
    const gone = { ...CATEGORY_ITEM, id: 'rv-gone', label: 'Lama', subject: null };
    const { screen } = await renderPage([CATEGORY_ITEM, other, gone]);
    const categories = panel(/^Perlu kategori/);
    await expect.element(categories).toMatchTextContent('kategorinya dihapus');
    await expect.element(categories).toMatchTextContent('0 dari 3 sudah diberi kategori');
    await expect.element(categories.getByRole('button', { name: 'Simpan' })).toBeDisabled();
    const mouse = screen.getByRole('article', { name: 'Tokopedia' });
    await userEvent.click(mouse.getByRole('button', { name: 'Makan & Dapur', exact: true }));
    await expect.element(categories).toMatchTextContent('1 dari 3 sudah diberi kategori');
    await userEvent.click(categories.getByRole('button', { name: 'Simpan' }));
    expect(server.confirmReview).toHaveBeenCalledWith({
      data: { itemId: CATEGORY_ITEM.id, edits: { categoryId: categoryId('system:food') } },
    });
    await vi.waitFor(() => {
      expect(lastToast()).toMatchObject({ title: '1 item dikonfirmasi' });
    });
    await expect.element(categories).toMatchTextContent('0 dari 3 sudah diberi kategori');

    // One failure stops the save with its message.
    server.confirmReview.mockResolvedValueOnce({ ok: false, code: 'PERIOD_CLOSED' });
    await userEvent.click(mouse.getByRole('button', { name: 'Makan & Dapur', exact: true }));
    await userEvent.click(categories.getByRole('button', { name: 'Simpan' }));
    await vi.waitFor(() => {
      expect(lastToast()).toMatchObject({ tone: 'error' });
    });

    // All at once.
    const apply = categories.getByRole('button', { name: 'Terapkan' });
    await expect.element(apply).toBeDisabled();
    await userEvent.selectOptions(
      categories.getByRole('combobox', { name: 'Set kategori untuk semua 3 transaksi' }),
      categoryId('system:shopping'),
    );
    await userEvent.click(apply);
    const dialog = page.getByRole('dialog', { name: /^Set Belanja.* untuk 3 transaksi\?$/ });
    await userEvent.click(dialog.getByRole('button', { name: 'Batal' }));
    await userEvent.click(apply);
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(apply);
    await userEvent.click(page.getByRole('dialog').getByRole('button', { name: 'Terapkan' }));
    expect(server.confirmReviewBulk).toHaveBeenCalledWith({
      data: {
        itemIds: [CATEGORY_ITEM.id, 'rv-cable', 'rv-gone'],
        edits: { categoryId: categoryId('system:shopping') },
      },
    });
    // The chosen rows that were confirmed are cleared; the rest keep their choice.
    await vi.waitFor(() => {
      expect(lastToast()).toMatchObject({ title: '1 item dikonfirmasi' });
    });
    await expect.element(categories).toMatchTextContent('0 dari 3 sudah diberi kategori');
    await userEvent.click(screen.getByRole('article', { name: 'Lama' }).getByRole('button', { name: 'Abaikan' }));
    expect(server.ignoreReview).toHaveBeenCalledWith({ data: { itemIds: ['rv-gone'] } });
  });

  it('"Terapkan" on a proposal shows what it does and changes nothing until "Konfirmasi"', async () => {
    server.confirmReview.mockResolvedValue(ok({ transactionId: 'tx-move', overrideIds: [] }));
    server.ignoreReview.mockResolvedValue(ok({ ignored: 1 }));
    const { screen } = await renderPage([LEFTOVER_ITEM, ROLLOVER_ITEM]);
    const leftover = screen.getByRole('article', { name: 'Pindahkan sisa anggaran ke Dana Darurat' });
    await userEvent.click(leftover.getByRole('button', { name: 'Terapkan' }));
    const dialog = page.getByRole('dialog', { name: 'Terapkan usulan?' });
    await expect.element(dialog).toMatchTextContent('Belum ada yang berubah sampai kamu konfirmasi.');
    await expect
      .element(dialog)
      .toMatchTextContent('Pindahkan sisa anggaran ke Dana Darurat: BCA Tahapan → Bank Jago Rp1.150.000');
    expect(server.confirmReview).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog).not.toBeInTheDocument();
    await userEvent.click(leftover.getByRole('button', { name: 'Terapkan' }));
    await userEvent.click(page.getByRole('dialog').getByRole('button', { name: 'Batal' }));
    await userEvent.click(leftover.getByRole('button', { name: 'Terapkan' }));
    await userEvent.click(page.getByRole('dialog').getByRole('button', { name: 'Konfirmasi' }));
    expect(server.confirmReview).toHaveBeenCalledWith({ data: { itemId: LEFTOVER_ITEM.id, edits: undefined } });
    await vi.waitFor(() => {
      expect(lastToast()).toMatchObject({ title: 'Usulan diterapkan' });
    });

    const rollover = screen.getByRole('article', { name: 'Bawa sisa Makan & Dapur ke periode berikutnya' });
    await userEvent.click(rollover.getByRole('button', { name: 'Terapkan' }));
    await expect
      .element(page.getByRole('dialog'))
      .toMatchTextContent('Bawa sisa Makan & Dapur ke periode berikutnya: Rp300.000');
    await userEvent.click(page.getByRole('dialog').getByRole('button', { name: 'Konfirmasi' }));
    expect(server.confirmReview).toHaveBeenLastCalledWith({ data: { itemId: ROLLOVER_ITEM.id, edits: undefined } });
    await userEvent.click(rollover.getByRole('button', { name: 'Abaikan' }));
    expect(server.ignoreReview).toHaveBeenCalledWith({ data: { itemIds: [ROLLOVER_ITEM.id] } });
  });

  it('a leftover without accounts asks for them; proposals of several periods, or of an unknown category', async () => {
    server.confirmReview.mockResolvedValue(ok({ transactionId: 'tx-move', overrideIds: [] }));
    const open = {
      ...LEFTOVER_ITEM,
      label: null,
      periodLabel: '2026-08' as YearMonth,
      payload: { ...LEFTOVER_ITEM.payload, fromAccountId: null, toAccountId: null },
    } as ReviewItemView;
    const unknown = {
      ...ROLLOVER_ITEM,
      periodLabel: null,
      payload: { ...ROLLOVER_ITEM.payload, categoryId: 'cat-gone' },
    } as ReviewItemView;
    const { screen } = await renderPage([open, LEFTOVER_ITEM, unknown]);
    await expect.element(panel(/Usulan penutupan periode/)).toMatchTextContent('periode yang sudah ditutup');
    await userEvent.click(
      screen
        .getByRole('article', { name: 'Pindahkan sisa anggaran', exact: true })
        .getByRole('button', { name: 'Terapkan' }),
    );
    const dialog = page.getByRole('dialog');
    await expect.element(dialog).toMatchTextContent('Pindahkan sisa anggaran ke : … → …');
    const confirm = dialog.getByRole('button', { name: 'Konfirmasi' });
    // Both default to the first active account: the same, so it cannot be confirmed yet.
    await expect.element(confirm).toBeDisabled();
    await userEvent.selectOptions(dialog.getByRole('combobox', { name: 'Ke rekening' }), JAGO.id);
    await userEvent.selectOptions(dialog.getByRole('combobox', { name: 'Dari rekening' }), BCA.id);
    await userEvent.click(confirm);
    expect(server.confirmReview).toHaveBeenCalledWith({
      data: { itemId: open.id, edits: { fromAccountId: BCA.id, toAccountId: JAGO.id } },
    });
    await userEvent.click(
      screen.getByRole('article', { name: /Tanpa nama/ }).getByRole('button', { name: 'Terapkan' }),
    );
    await expect.element(page.getByRole('dialog')).toMatchTextContent('Bawa sisa ke periode berikutnya:');
  });

  it('a leftover without accounts and no active account to default to', async () => {
    const open = {
      ...LEFTOVER_ITEM,
      payload: { ...LEFTOVER_ITEM.payload, fromAccountId: null, toAccountId: null },
    } as ReviewItemView;
    const result = await renderApp(
      <ReviewPage
        items={[open]}
        lookup={{ ...lookup, accounts: [] }}
        timeZone="Asia/Jakarta"
        today={'2026-10-15' as LocalDate}
      />,
    );
    await userEvent.click(result.screen.getByRole('button', { name: 'Terapkan' }));
    await expect.element(page.getByRole('dialog').getByRole('button', { name: 'Konfirmasi' })).toBeDisabled();
    await expect.element(page.getByRole('dialog')).toMatchTextContent('… → … Rp1.150.000');
  });

  it('focuses the card ⌘K opened', async () => {
    await renderPage(ALL, NETFLIX_ITEM.id);
    await expect
      .element(page.getByRole('article', { name: 'Netflix' }).getByRole('button', { name: 'Belum' }))
      .toHaveFocus();
  });
});

describe('ReviewPage Gmail items', () => {
  const PLN = reviewItem('rv-pln', {
    reason: 'ai_suggestion',
    source: 'gmail',
    label: 'PLN',
    payload: {
      kind: 'gmail',
      logId: 'log-pln',
      messageId: 'msg-pln',
      from: 'tagihan@pln.test',
      subject: 'Pembayaran listrik',
      excerpt: 'Pembayaran Rp350.000 berhasil',
      tags: [],
      errorCode: null,
      extraction: {
        amountMinor: 350_000n,
        occurredAt: new Date('2026-10-14T02:00:00Z'),
        merchant: 'PLN',
        currency: 'IDR',
        accountId: BCA.id,
        categoryId: categoryId('system:bills'),
        confidence: { amount: 97, date: 97, merchant: 97, currency: 97, account: 97, category: 97 },
      },
    },
  });

  it('records a 97% email only on "Catat", offers Urungkan, and refreshes the queue', async () => {
    server.confirmReview.mockResolvedValue(ok({ transactionId: 'tx-pln', overrideIds: [] }));
    const { invalidate } = await renderPage([PLN]);
    const card = panel(/^Gmail/).getByRole('article', { name: 'PLN' });
    await expect.element(card).toBeVisible();
    expect(server.confirmReview).not.toHaveBeenCalled();
    await userEvent.click(card.getByRole('button', { name: 'Catat' }));
    expect(server.confirmReview).toHaveBeenCalledWith({
      data: {
        itemId: PLN.id,
        edits: {
          amountMinor: 350_000n,
          accountId: BCA.id,
          categoryId: categoryId('system:bills'),
          merchant: 'PLN',
          occurredAt: new Date('2026-10-14T02:00:00Z'),
        },
      },
    });
    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
    expect(toasts.toast.undo).toHaveBeenCalledWith(expect.objectContaining({ title: 'Transaksi tersimpan' }));
    server.removeTransactions.mockResolvedValueOnce({ ok: true, value: { deleted: ['tx-pln'] } });
    invalidate.mockClear();
    const [{ onUndo }] = toasts.toast.undo.mock.lastCall as [{ onUndo: () => void }];
    onUndo();
    expect(server.removeTransactions).toHaveBeenCalledWith({ data: { ids: ['tx-pln'] } });
    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
  });

  it('offers no Urungkan when the confirmation left no transaction, and keeps the item after a refusal', async () => {
    server.confirmReview
      .mockResolvedValueOnce({ ok: false, code: 'INVALID_ACCOUNT' })
      .mockResolvedValueOnce(ok({ transactionId: null, overrideIds: [] }));
    const { invalidate } = await renderPage([PLN]);
    const card = panel(/^Gmail/).getByRole('article', { name: 'PLN' });
    await userEvent.click(card.getByRole('button', { name: 'Catat' }));
    await vi.waitFor(() => {
      expect(lastToast()).toMatchObject({ tone: 'error', title: 'Periksa lagi data rekening.' });
    });
    expect(invalidate).not.toHaveBeenCalled();
    await expect.element(card.getByRole('button', { name: 'Catat' })).toBeEnabled();
    await userEvent.click(card.getByRole('button', { name: 'Catat' }));
    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
    expect(toasts.toast.undo).not.toHaveBeenCalled();
  });

  it('ignores an email without recording it', async () => {
    server.ignoreReview.mockResolvedValue(ok({ ignored: 1 }));
    await renderPage([PLN]);
    await userEvent.click(panel(/^Gmail/).getByRole('button', { name: 'Abaikan' }));
    expect(server.ignoreReview).toHaveBeenCalledWith({ data: { itemIds: [PLN.id] } });
    expect(server.confirmReview).not.toHaveBeenCalled();
  });
});
