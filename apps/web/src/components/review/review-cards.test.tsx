// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { ACCOUNTS, CATEGORIES, categoryId } from '../../../test/ledger-fixtures.ts';
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
import { AiCard, BillCard, CategoryRow, CloseCard, type ReviewLookup } from './review-cards.tsx';
import type { CategoryItem, CloseItem, DraftItem } from './review-model.ts';

const lookup: ReviewLookup = { baseCurrency: 'IDR', accounts: ACCOUNTS, categories: CATEGORIES };
const today = '2026-10-15' as LocalDate;

afterEach(() => {
  vi.clearAllMocks();
});

describe('BillCard', () => {
  it('shows an overdue subscription bill and reports "Belum" or "Sudah dibayar"', async () => {
    const onPaid = vi.fn();
    const onUnpaid = vi.fn();
    const { screen } = await renderApp(
      <BillCard
        item={ICLOUD_ITEM as DraftItem}
        lookup={lookup}
        locale="id"
        today={today}
        editableAmount={false}
        pending={false}
        onPaid={onPaid}
        onUnpaid={onUnpaid}
      />,
    );
    const card = screen.getByRole('article', { name: 'iCloud+' });
    await expect.element(card).toMatchTextContent('200 GB · Langganan');
    await expect.element(card).toMatchTextContent('Rp45.000');
    await expect.element(card).toMatchTextContent('9 Okt');
    await expect
      .element(card)
      .toMatchTextContent('Jatuh tempo lewat 6 hari · belum tercatat. Saldo BCA Tahapan belum dipotong.');
    await expect.element(card.getByRole('button', { name: 'Ubah nominal' })).not.toBeInTheDocument();
    await userEvent.click(card.getByRole('button', { name: 'Belum' }));
    expect(onUnpaid).toHaveBeenCalledOnce();
    await userEvent.click(card.getByRole('button', { name: 'Sudah dibayar' }));
    expect(onPaid).toHaveBeenCalledWith(null);
  });

  it('a recurring transfer: its goal split, "Ubah nominal", and "Sudah ditransfer" with the new amount', async () => {
    const onPaid = vi.fn();
    const { screen } = await renderApp(
      <BillCard
        item={SISIHKAN_ITEM as DraftItem}
        lookup={lookup}
        locale="id"
        today={'2026-10-25' as LocalDate}
        editableAmount
        pending={false}
        onPaid={onPaid}
        onUnpaid={vi.fn()}
      />,
    );
    const card = screen.getByRole('article', { name: 'Sisihkan dana tidak rutin' });
    await expect.element(card).toMatchTextContent('BCA Tahapan → Bank Jago');
    await expect
      .element(card)
      .toMatchTextContent(
        'Jatuh tempo hari ini · belum tercatat. Saldo BCA Tahapan belum dipotong dan tujuan belum bertambah.',
      );
    const split = card.getByRole('region', { name: 'Dibagi ke' });
    await expect.element(split).toMatchTextContent('Liburan Bali867.000');
    await expect.element(card).toMatchTextContent('Sudah ditransfer?');
    await userEvent.click(card.getByRole('button', { name: 'Ubah nominal' }));
    const amount = card.getByRole('textbox', { name: 'Nominal' });
    await expect.element(amount).toHaveFocus();
    await userEvent.clear(amount);
    await expect.element(card.getByRole('button', { name: 'Sudah ditransfer' })).toBeDisabled();
    await userEvent.type(amount, '1200000');
    await userEvent.click(card.getByRole('button', { name: 'Sudah ditransfer' }));
    expect(onPaid).toHaveBeenCalledWith(1_200_000n);
  });

  it('keeps the proposal when the edited amount is unchanged; income and early bills read their own way', async () => {
    const onPaid = vi.fn();
    const income = reviewItem('rv-salary', {
      dueDate: '2026-10-20' as LocalDate,
      payload: {
        kind: 'transaction',
        draft: {
          type: 'income',
          occurredAt: new Date(),
          accountId: 'acc-missing',
          amountMinor: 500_000n,
          categoryId: null,
          description: null,
        },
      },
    }) as DraftItem;
    const { screen } = await renderApp(
      <BillCard
        item={income}
        lookup={lookup}
        locale="id"
        today={today}
        editableAmount
        pending
        onPaid={onPaid}
        onUnpaid={vi.fn()}
      />,
    );
    // No name and an unknown account: the card stays readable.
    const card = screen.getByRole('article');
    await expect.element(card).toMatchTextContent('Jatuh tempo 5 hari lagi · belum tercatat. Saldo belum bertambah.');
    await expect.element(card).toMatchTextContent('Sudah diterima?');
    await expect.element(card.getByRole('button', { name: 'Belum' })).toBeDisabled();
    await userEvent.click(card.getByRole('button', { name: 'Ubah nominal' }));
    await expect.element(card.getByRole('button', { name: 'Sudah diterima' })).toHaveAttribute('aria-busy', 'true');
  });

  it('an edited amount equal to the proposal confirms the proposal as it is', async () => {
    const onPaid = vi.fn();
    const noDate = {
      ...SISIHKAN_ITEM,
      dueDate: null,
      allocations: [],
      payload: {
        kind: 'transaction',
        draft: { ...(SISIHKAN_ITEM.payload as DraftItem['payload']).draft, toAccountId: 'acc-missing' },
      },
    } as DraftItem;
    const { screen } = await renderApp(
      <BillCard
        item={noDate}
        lookup={lookup}
        locale="id"
        today={today}
        editableAmount
        pending={false}
        onPaid={onPaid}
        onUnpaid={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ubah nominal' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sudah ditransfer' }));
    expect(onPaid).toHaveBeenCalledWith(null);
    await expect
      .element(screen.getByRole('article'))
      .toMatchTextContent('Jatuh tempo hari ini · belum tercatat. Saldo BCA Tahapan belum dipotong.');
    await expect.element(screen.getByRole('article')).toMatchTextContent('BCA Tahapan →');
  });

  it('a subscription without a plan or category shows its account', async () => {
    const plain = reviewItem('rv-plain', {
      label: 'Gym',
      dueDate: today,
      payload: {
        kind: 'transaction',
        draft: { type: 'expense', occurredAt: new Date(), accountId: 'acc-bca', amountMinor: 1n, categoryId: null },
      },
    }) as DraftItem;
    const { screen } = await renderApp(
      <BillCard
        item={plain}
        lookup={lookup}
        locale="id"
        today={today}
        editableAmount={false}
        pending={false}
        onPaid={vi.fn()}
        onUnpaid={vi.fn()}
      />,
    );
    await expect.element(screen.getByRole('article', { name: 'Gym' })).toMatchTextContent('GymBCA Tahapan');
  });

  it('Netflix due in three days (paid early)', async () => {
    const { screen } = await renderApp(
      <BillCard
        item={NETFLIX_ITEM as DraftItem}
        lookup={lookup}
        locale="en"
        today={today}
        editableAmount={false}
        pending={false}
        onPaid={vi.fn()}
        onUnpaid={vi.fn()}
      />,
      { preferences: { locale: 'en' } },
    );
    await expect.element(screen.getByRole('article', { name: 'Netflix' })).toMatchTextContent('Due in 3 days');
  });
});

describe('AiCard', () => {
  it('shows the confidence of an AI result and offers "Catat" or "Abaikan"', async () => {
    const onRecord = vi.fn();
    const onIgnore = vi.fn();
    const { screen } = await renderApp(
      <AiCard
        item={GMAIL_ITEM as DraftItem}
        lookup={lookup}
        locale="id"
        timeZone="Asia/Jakarta"
        pending={false}
        onRecord={onRecord}
        onIgnore={onIgnore}
      />,
    );
    const card = screen.getByRole('article', { name: 'Tokopedia' });
    await expect.element(card).toMatchTextContent('Gmail');
    await expect.element(card).toMatchTextContent('15 Okt 15.40');
    await expect.element(card).toMatchTextContent('Yakin 62%: periksa dulu sebelum dicatat.');
    await expect.element(card).toMatchTextContent('MerchantTokopedia');
    await expect.element(card).toMatchTextContent('RekeningBCA Tahapan');
    await userEvent.click(card.getByRole('button', { name: 'Catat' }));
    await userEvent.click(card.getByRole('button', { name: 'Abaikan' }));
    expect(onRecord).toHaveBeenCalledOnce();
    expect(onIgnore).toHaveBeenCalledOnce();
  });

  it('an import row without a name, confidence, merchant, or known account; an income; a transfer', async () => {
    const draft = (patch: object) =>
      reviewItem('rv-row', {
        reason: 'import_row',
        source: 'receipt',
        payload: {
          kind: 'transaction',
          draft: {
            type: 'expense',
            occurredAt: new Date('2026-10-14T01:00:00Z'),
            accountId: 'acc-missing',
            amountMinor: 1_000n,
            categoryId: null,
            ...patch,
          } as never,
        },
      }) as DraftItem;
    const { screen } = await renderApp(
      <>
        <AiCard
          item={draft({})}
          lookup={lookup}
          locale="id"
          timeZone="Asia/Jakarta"
          pending
          onRecord={vi.fn()}
          onIgnore={vi.fn()}
        />
        <AiCard
          item={{ ...draft({ type: 'income' }), id: 'rv-income' }}
          lookup={lookup}
          locale="id"
          timeZone="Asia/Jakarta"
          pending={false}
          onRecord={vi.fn()}
          onIgnore={vi.fn()}
        />
        <AiCard
          item={{ ...SISIHKAN_ITEM, reason: 'ai_suggestion', source: 'assistant' } as DraftItem}
          lookup={lookup}
          locale="id"
          timeZone="Asia/Jakarta"
          pending={false}
          onRecord={vi.fn()}
          onIgnore={vi.fn()}
        />
      </>,
    );
    const articles = screen.getByRole('article');
    const row = articles.nth(0);
    const income = articles.nth(1);
    const transfer = articles.nth(2);
    await expect.element(row).toMatchTextContent('Tanpa nama');
    await expect.element(row).toMatchTextContent('Struk');
    await expect.element(row).toMatchTextContent('Merchantbelum diketahuiRekeningbelum diketahui');
    await expect.element(row).not.toMatchTextContent('Yakin');
    await expect.element(income).toMatchTextContent('Rp1.000');
    await expect.element(transfer).toMatchTextContent('Asisten');
    await expect.element(transfer).toMatchTextContent('Merchantbelum diketahui');
  });
});

describe('CategoryRow', () => {
  it('a recorded transaction that lost its category: a picker and the most used categories as suggestions', async () => {
    const onValueChange = vi.fn();
    const { screen } = await renderApp(
      <CategoryRow
        item={CATEGORY_ITEM as CategoryItem}
        lookup={lookup}
        locale="id"
        timeZone="Asia/Jakarta"
        value={categoryId('system:food')}
        onValueChange={onValueChange}
        onIgnore={vi.fn()}
      />,
    );
    const card = screen.getByRole('article', { name: 'Tokopedia' });
    await expect.element(card).toMatchTextContent('Mouse wireless');
    await expect.element(card).toMatchTextContent('−Rp189.000');
    await expect.element(card).toMatchTextContent('12 Okt 20.41');
    await expect.element(card).toMatchTextContent('Sudah tercatat · BCA Tahapan');
    await expect.element(card.getByRole('button', { name: 'Kategori untuk Tokopedia' })).toMatchTextContent('Makan');
    const food = card.getByRole('button', { name: 'Makan & Dapur', exact: true });
    await expect.element(food).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(card.getByRole('button', { name: 'Transportasi', exact: true }));
    expect(onValueChange).toHaveBeenCalledWith(categoryId('system:transport'));
  });

  it('an income without a merchant takes income suggestions; a deleted transaction can only be ignored', async () => {
    const onIgnore = vi.fn();
    const income = {
      ...CATEGORY_ITEM,
      id: 'rv-income',
      subject: { ...CATEGORY_ITEM.subject, type: 'income', merchant: null, accountId: 'acc-missing' },
    } as CategoryItem;
    const gone = { ...CATEGORY_ITEM, id: 'rv-gone', subject: null } as CategoryItem;
    const nameless = { ...gone, id: 'rv-nameless', label: null } as CategoryItem;
    const noSuggestions = { ...CATEGORY_ITEM, id: 'rv-none' } as CategoryItem;
    const { screen } = await renderApp(
      <>
        <CategoryRow
          item={income}
          lookup={lookup}
          locale="id"
          timeZone="Asia/Jakarta"
          value={null}
          onValueChange={vi.fn()}
          onIgnore={vi.fn()}
        />
        <CategoryRow
          item={gone}
          lookup={lookup}
          locale="id"
          timeZone="Asia/Jakarta"
          value={null}
          onValueChange={vi.fn()}
          onIgnore={onIgnore}
        />
        <CategoryRow
          item={nameless}
          lookup={lookup}
          locale="id"
          timeZone="Asia/Jakarta"
          value={null}
          onValueChange={vi.fn()}
          onIgnore={vi.fn()}
        />
        <CategoryRow
          item={noSuggestions}
          lookup={{ ...lookup, categories: [] }}
          locale="id"
          timeZone="Asia/Jakarta"
          value={null}
          onValueChange={vi.fn()}
          onIgnore={vi.fn()}
        />
      </>,
    );
    const articles = screen.getByRole('article');
    const first = articles.nth(0);
    const second = articles.nth(1);
    const third = articles.nth(2);
    const fourth = articles.nth(3);
    await expect.element(first).toMatchTextContent('Mouse wireless');
    await expect.element(first).toMatchTextContent('Saran:Gaji');
    await expect.element(first).toMatchTextContent('Sudah tercatat · ');
    await expect.element(second).toMatchTextContent('Transaksi ini sudah dihapus.');
    await userEvent.click(second.getByRole('button', { name: 'Abaikan' }));
    expect(onIgnore).toHaveBeenCalledOnce();
    await expect.element(third).toMatchTextContent('Tanpa nama');
    await expect.element(fourth).not.toMatchTextContent('Saran:');
  });
});

describe('CloseCard', () => {
  it('September\'s leftover to Dana Darurat and a rollover: "Terapkan" or "Abaikan"', async () => {
    const onApply = vi.fn();
    const onIgnore = vi.fn();
    const { screen } = await renderApp(
      <>
        <CloseCard
          item={LEFTOVER_ITEM as CloseItem}
          lookup={lookup}
          locale="id"
          pending={false}
          onApply={onApply}
          onIgnore={onIgnore}
        />
        <CloseCard
          item={ROLLOVER_ITEM as CloseItem}
          lookup={lookup}
          locale="id"
          pending={false}
          onApply={vi.fn()}
          onIgnore={vi.fn()}
        />
      </>,
    );
    const leftover = screen.getByRole('article', { name: 'Pindahkan sisa anggaran ke Dana Darurat' });
    await expect.element(leftover).toMatchTextContent('BCA Tahapan → Bank Jago');
    await expect.element(leftover).toMatchTextContent('Rp1.150.000');
    await userEvent.click(leftover.getByRole('button', { name: 'Terapkan' }));
    await userEvent.click(leftover.getByRole('button', { name: 'Abaikan' }));
    expect(onApply).toHaveBeenCalledOnce();
    expect(onIgnore).toHaveBeenCalledOnce();
    const rollover = screen.getByRole('article', { name: 'Bawa sisa Makan & Dapur ke periode berikutnya' });
    await expect.element(rollover).toMatchTextContent('anggaran periode berikutnya disesuaikan');
    await expect.element(rollover).toMatchTextContent('Rp300.000');
  });

  it('a leftover without a goal or accounts, and an overspend of an unknown category', async () => {
    const leftover = {
      ...LEFTOVER_ITEM,
      label: null,
      payload: { ...LEFTOVER_ITEM.payload, fromAccountId: null, toAccountId: null },
    } as CloseItem;
    const over = {
      ...ROLLOVER_ITEM,
      payload: { ...ROLLOVER_ITEM.payload, categoryId: 'cat-gone', deltaMinor: -50_000n },
    } as CloseItem;
    const { screen } = await renderApp(
      <>
        <CloseCard item={leftover} lookup={lookup} locale="id" pending onApply={vi.fn()} onIgnore={vi.fn()} />
        <CloseCard item={over} lookup={lookup} locale="id" pending={false} onApply={vi.fn()} onIgnore={vi.fn()} />
      </>,
    );
    const plain = screen.getByRole('article', { name: 'Pindahkan sisa anggaran', exact: true });
    await expect.element(plain).toMatchTextContent('rekening dipilih saat diterapkan');
    await expect.element(plain.getByRole('button', { name: 'Abaikan' })).toBeDisabled();
    await expect
      .element(screen.getByRole('article', { name: 'Bawa kelebihan Tanpa nama ke periode berikutnya' }))
      .toMatchTextContent('−Rp50.000');
  });
});
