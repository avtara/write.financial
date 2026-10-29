// SPDX-License-Identifier: AGPL-3.0-only
import type { AiSettingsView } from '@wf/domain/ai';
import type { AssistantAnswer, AssistantDraft } from '@wf/domain/assistant';
import type { LocalDate } from '@wf/domain/period';
import { toast, Toaster } from '@wf/ui/toast';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { flushReact, renderApp } from '../../../test/render.tsx';
import { account, ACCOUNTS, CATEGORIES, categoryId, TAGS } from '../../../test/ledger-fixtures.ts';
import { RecordTransactionProvider } from '../ledger/record-transaction.tsx';
import { listAccounts, listCategories, listTags } from '../../server/fn/ledger.ts';
import { AssistantDialog } from './assistant-dialog.tsx';

const server = vi.hoisted(() => ({
  askAssistant: vi.fn(),
  getAiSettings: vi.fn(),
  recordTransaction: vi.fn(),
  removeTransactions: vi.fn(),
}));
vi.mock('../../server/fn/assistant.ts', () => ({ askAssistant: server.askAssistant }));
vi.mock('../../server/fn/ai.ts', () => ({ getAiSettings: server.getAiSettings }));
vi.mock('../../server/fn/transactions-write.ts', () => ({
  recordTransaction: server.recordTransaction,
  removeTransactions: server.removeTransactions,
  listDrafts: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
  listTransactionDays: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
  removeDraft: vi.fn(),
  saveDraft: vi.fn(),
}));
vi.mock('../ledger/receipt-entry.tsx', () => ({ ReceiptEntry: () => null }));
vi.mock('../../server/fn/ledger.ts', () => ({
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listTags: vi.fn(),
  getReferenceRate: vi.fn(),
}));
vi.mock('../../server/fn/rules.ts', () => ({
  listAutoRules: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
}));
vi.mock('../../server/fn/schedules.ts', () => ({
  listSubscriptions: vi.fn(() => Promise.resolve({ ok: true, value: { subscriptions: [] } })),
  createRecurrence: vi.fn(),
}));
vi.mock('../../server/fn/budget.ts', () => ({
  getBudgetStatus: vi.fn(() => Promise.resolve({ ok: false, code: 'NOT_FOUND' })),
}));
vi.mock('../../server/fn/goals.ts', () => ({
  listGoals: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
  spendFromGoal: vi.fn(),
}));
vi.mock('../../server/fn/debts.ts', () => ({
  getCardPaymentContext: vi.fn(),
  recordCardInstallment: vi.fn(),
  recordCardPayment: vi.fn(),
}));
vi.mock('../../server/fn/receivables.ts', () => ({ getSplitBillContext: vi.fn(), recordSplitBill: vi.fn() }));
vi.mock('../accounts/reconcile.tsx', () => ({ useReconcile: () => ({ openReconcile: vi.fn() }) }));

const SETTINGS: AiSettingsView = {
  revision: '0192a6c4-0000-7000-8000-0000000000a1',
  twoFactorEnabled: true,
  provider: 'openrouter',
  connections: [
    {
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      last4: '3f9a',
      status: 'connected',
      modelId: 'anthropic/claude-sonnet-5.5',
      addedAt: new Date('2026-10-02T04:00:00Z'),
      testedAt: new Date('2026-10-15T09:00:00Z'),
      errorCode: null,
      httpStatus: null,
      pricing: { inputUsdPerMillion: '3', outputUsdPerMillion: '15', requestUsd: '0', imageUsd: '0' },
      pricingSource: 'catalog',
    },
  ],
  allowReadFinancial: true,
  allowCreateDrafts: true,
  requireConfirmation: true,
  monthlyLimitUsd: '5',
  usage: {
    month: '2026-10',
    requests: 3,
    spentUsd: '1.24',
    estimatedUsd: '0.02',
    reservedUsd: '0',
    limitUsd: '5',
  },
  allowedCustomBaseUrls: [],
};

const BASE_DRAFT: AssistantDraft = {
  type: 'expense',
  description: 'Makan siang',
  amountMinor: 45_000n,
  currency: 'IDR',
  accountId: '0192a6c4-0000-7000-8000-0000000000b1',
  accountName: 'GoPay',
  categoryId: categoryId('system:food'),
  categoryName: 'Makan & Dapur',
  categoryBuiltInKey: 'system:food',
  occurredAt: new Date('2026-10-15T05:10:00Z'),
  tags: [],
  budget: { limitMinor: 3_500_000n, spentAfterMinor: 3_245_000n, usedBps: 9271 },
  balance: { currency: 'IDR', afterMinor: 367_000n, thresholdMinor: 500_000n },
  duplicate: null,
};

const draftAnswer = (overrides: Partial<AssistantAnswer> = {}): AssistantAnswer => ({
  text: 'Siap, ini draftnya. Periksa dulu sebelum disimpan:',
  cards: [],
  draft: BASE_DRAFT,
  provider: 'openrouter',
  modelId: 'anthropic/claude-sonnet-5.5',
  toolCalls: ['draf_transaksi'],
  usage: { ...SETTINGS.usage, requests: 4, spentUsd: '1.2402' },
  ...overrides,
});

function AssistantHarness() {
  const [open, setOpen] = useState(true);
  return (
    <RecordTransactionProvider timeZone="Asia/Jakarta">
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Buka kembali Asisten
      </button>
      <AssistantDialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        timeZone="Asia/Jakarta"
      />
    </RecordTransactionProvider>
  );
}

const render = (hidden = false) =>
  renderApp(
    <>
      <AssistantHarness />
      <Toaster label="Notifikasi" />
    </>,
    {
      preferences: { locale: 'id', balancesHidden: hidden },
    },
  );

beforeEach(() => {
  vi.clearAllMocks();
  server.getAiSettings.mockResolvedValue({ ok: true, value: SETTINGS });
  server.askAssistant.mockResolvedValue({ ok: true, value: draftAnswer() });
  server.recordTransaction.mockResolvedValue({ ok: true, value: { id: 't1', created: true, fxDifference: null } });
  vi.mocked(listAccounts).mockResolvedValue({
    ok: true,
    value: {
      baseCurrency: 'IDR',
      accounts: [...ACCOUNTS, account({ id: BASE_DRAFT.accountId, displayName: 'GoPay', type: 'ewallet' })],
      availableMinor: 0n,
      missingRates: [],
    },
  });
  vi.mocked(listCategories).mockResolvedValue({ ok: true, value: [...CATEGORIES] });
  vi.mocked(listTags).mockResolvedValue({ ok: true, value: [...TAGS] });
});

const composer = () => page.getByRole('textbox', { name: 'Pertanyaan untuk Asisten' });

describe('AssistantDialog states', () => {
  it('explains how to connect a provider and links to its settings', async () => {
    server.getAiSettings.mockResolvedValue({
      ok: true,
      value: { ...SETTINGS, revision: null, connections: [] },
    });
    const { router } = await render();
    await expect.element(page.getByRole('heading', { name: 'Belum ada penyedia AI' })).toBeVisible();
    await expect.element(page.getByText(/Asisten memakai API key milikmu/)).toBeVisible();
    await page.getByRole('button', { name: 'Buka Pengaturan → AI agent' }).click();
    await vi.waitFor(() => {
      expect(router.state.location.search).toEqual({ settings: 'ai' });
    });
    await expect.element(page.getByRole('dialog', { name: 'Asisten' })).not.toBeInTheDocument();
  });

  it('asks for the financial-data permission instead of answering', async () => {
    server.getAiSettings.mockResolvedValue({ ok: true, value: { ...SETTINGS, allowReadFinancial: false } });
    await render();
    await expect.element(page.getByRole('heading', { name: 'Izin baca data keuangan mati' })).toBeVisible();
    expect(composer().elements()).toHaveLength(0);
  });

  it('opens the AI permissions in Settings from the refusal and closes the Assistant', async () => {
    server.getAiSettings.mockResolvedValue({ ok: true, value: { ...SETTINGS, allowReadFinancial: false } });
    const { router } = await render();
    await page.getByRole('button', { name: 'Buka izin AI' }).click();
    await vi.waitFor(() => {
      expect(router.state.location.search).toEqual({ settings: 'ai' });
    });
    await expect.element(page.getByRole('dialog', { name: 'Asisten' })).not.toBeInTheDocument();
  });

  it('shows the provider, model and month meter in the header', async () => {
    await render();
    await expect.element(page.getByRole('dialog', { name: 'Asisten' })).toBeVisible();
    await expect.element(page.getByText(/claude-sonnet-5\.5/)).toBeVisible();
    await expect.element(page.getByText(/\$1,24 dari \$5,00 bulan ini/)).toBeVisible();
  });
});

describe('AssistantDialog asking', () => {
  it('answers an example question without writing to the ledger', async () => {
    await render();
    await page.getByRole('button', { name: 'Berapa sisa anggaran Makan bulan ini?' }).click();
    await expect.element(page.getByText(/Siap, ini draftnya/)).toBeVisible();
    expect(server.recordTransaction).not.toHaveBeenCalled();
  });

  it('masks amounts inside the answer while privacy mode is on', async () => {
    server.askAssistant.mockResolvedValue({
      ok: true,
      value: draftAnswer({
        text: 'Makan & Dapur terpakai Rp3.200.000 dari Rp3.500.000 (91%).',
        draft: null,
      }),
    });
    await render(true);
    await composer().fill('Berapa sisa anggaran Makan?');
    await page.getByRole('button', { name: 'Kirim' }).click();
    await expect.element(page.getByText(/Rp•••••• dari Rp•••••• \(91%\)/)).toBeVisible();
  });

  it('offers a retry after a timeout and resends the same question', async () => {
    server.askAssistant.mockResolvedValueOnce({ ok: false, code: 'AI_TIMEOUT' });
    await render();
    await composer().fill('Bandingkan Okt vs Sep');
    await page.getByRole('button', { name: 'Kirim' }).click();
    await expect.element(page.getByText(/tidak menjawab dalam 30 detik/)).toBeVisible();
    server.askAssistant.mockResolvedValueOnce({
      ok: true,
      value: draftAnswer({ text: 'Okt lebih tinggi.', draft: null }),
    });
    await page.getByRole('button', { name: 'Coba lagi' }).click();
    await expect.element(page.getByText('Okt lebih tinggi.')).toBeVisible();
  });
});

describe('AssistantDialog drafts', () => {
  it('shows the impact, saves only on confirmation, and offers the saved row', async () => {
    const { router } = await render();
    await composer().fill('Catat makan siang tadi 45.000 pakai GoPay');
    await page.getByRole('button', { name: 'Kirim' }).click();

    const card = page.getByRole('group', { name: 'Draft transaksi' });
    await expect.element(card.getByText('Makan siang')).toBeVisible();
    await expect.element(card.getByText('Makan & Dapur')).toBeVisible();
    await expect.element(card.getByText('GoPay')).toBeVisible();
    await expect.element(card.getByText('Kam, 15 Okt · 12.10')).toBeVisible();
    await expect.element(card.getByText(/Makan & Dapur jadi 92,71\s*%/)).toBeVisible();
    await expect.element(card.getByText(/saldo GoPay Rp367\.000 .*Rp500\.000/)).toBeVisible();
    expect(server.recordTransaction).not.toHaveBeenCalled();

    await card.getByRole('button', { name: 'Simpan' }).click();
    await expect.element(card.getByText('Tersimpan · dikonfirmasi olehmu')).toBeVisible();
    await card.getByRole('button', { name: 'Buka di Transaksi' }).click();
    await vi.waitFor(() => {
      expect(router.state.location.href).toBe('/transactions?tx=t1');
    });
    await expect.element(page.getByRole('dialog', { name: 'Asisten' })).not.toBeInTheDocument();
  });

  it('undoes a confirmed draft from its toast and refreshes what shows the ledger', async () => {
    // Earlier tests' toasts live in the shared store; only this save's "Urungkan" may be on screen.
    toast.dismiss();
    server.removeTransactions.mockResolvedValueOnce({ ok: true, value: undefined });
    const { router } = await render();
    const invalidate = vi.spyOn(router, 'invalidate').mockResolvedValue();
    await composer().fill('Catat makan siang tadi 45.000 pakai GoPay');
    await page.getByRole('button', { name: 'Kirim' }).click();
    await page.getByRole('group', { name: 'Draft transaksi' }).getByRole('button', { name: 'Simpan' }).click();
    const toasts = page.getByRole('region', { name: 'Notifikasi' });
    await expect.element(toasts).toMatchTextContent('Transaksi tersimpan');
    // The toast sits outside the modal Assistant: the user closes it to reach "Urungkan".
    await page.getByRole('button', { name: 'Tutup asisten', exact: true }).click();
    await expect.element(page.getByRole('dialog', { name: 'Asisten' })).not.toBeInTheDocument();
    invalidate.mockClear();
    await toasts.getByRole('button', { name: 'Urungkan' }).click();
    expect(server.removeTransactions).toHaveBeenCalledWith({ data: { ids: ['t1'] } });
    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
  });

  it('asks before recording something that already exists', async () => {
    server.askAssistant.mockResolvedValue({
      ok: true,
      value: draftAnswer({
        draft: {
          ...BASE_DRAFT,
          description: 'Indomaret',
          amountMinor: 110_000n,
          duplicate: {
            transactionId: 't9',
            description: 'Indomaret',
            localDate: '2026-10-15' as LocalDate,
            amountMinor: 110_000n,
          },
        },
      }),
    });
    await render();
    await composer().fill('Catat Indomaret 110.000 pagi ini');
    await page.getByRole('button', { name: 'Kirim' }).click();
    const card = page.getByRole('group', { name: 'Draft transaksi' });
    await expect.element(card.getByText(/Sudah tercatat: Indomaret/)).toBeVisible();
    await expect.element(card.getByRole('button', { name: 'Tetap catat' })).toBeVisible();
  });

  it('cancels an Assistant draft without writing to the ledger', async () => {
    await render();
    await composer().fill('Catat makan siang tadi 45.000 pakai GoPay');
    await page.getByRole('button', { name: 'Kirim' }).click();
    const card = page.getByRole('group', { name: 'Draft transaksi' });

    await card.getByRole('button', { name: 'Batal' }).click();
    await expect.element(page.getByText('Draf dibatalkan.')).toBeVisible();
    expect(server.recordTransaction).not.toHaveBeenCalled();
  });
});

it('opens the real Record sheet for editing and requires consent before an edited draft can be written', async () => {
  await render();
  await composer().fill('Catat makan siang tadi 45.000 pakai GoPay');
  await page.getByRole('button', { name: 'Kirim' }).click();
  await page.getByRole('group', { name: 'Draft transaksi' }).getByRole('button', { name: 'Ubah' }).click();
  await expect.element(page.getByRole('dialog', { name: 'Asisten' })).not.toBeInTheDocument();
  const sheet = page.getByRole('dialog', { name: /^Catat/ });
  await expect.element(sheet.getByRole('textbox', { name: 'Jumlah' })).toHaveValue('45.000');
  await expect.element(sheet.getByRole('textbox', { name: 'Catatan', exact: true })).toHaveValue('Makan siang');
  await expect.element(sheet.getByRole('button', { name: 'Rekening' })).toMatchTextContent('GoPay');
  await sheet.getByRole('textbox', { name: 'Jumlah' }).fill('50000');
  await userEvent.keyboard('{Escape}');
  await page.getByRole('button', { name: 'Buang', exact: true }).click();
  await expect.element(sheet).not.toBeInTheDocument();
  expect(server.recordTransaction).not.toHaveBeenCalled();
});

it('does not duplicate a committed transaction when its save response is lost and the user retries', async () => {
  const committed = new Map<string, { id: string }>();
  let loseResponse = true;
  // A ledger that keeps one transaction per clientId (like `recordTransaction`), and loses its first reply.
  server.recordTransaction.mockImplementation(({ data }: { data: { clientId: string } }) => {
    const previous = committed.get(data.clientId);
    if (previous !== undefined)
      return Promise.resolve({ ok: true, value: { ...previous, created: false, fxDifference: null } });
    const transaction = { id: `tx-${String(committed.size + 1)}` };
    committed.set(data.clientId, transaction);
    if (loseResponse) {
      loseResponse = false;
      return Promise.reject(new Error('response lost after commit'));
    }
    return Promise.resolve({ ok: true, value: { ...transaction, created: true, fxDifference: null } });
  });
  const { router } = await render();
  await composer().fill('Catat makan siang tadi 45.000 pakai GoPay');
  await page.getByRole('button', { name: 'Kirim' }).click();
  const card = page.getByRole('group', { name: 'Draft transaksi' });
  await card.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect.element(page.getByText('Transaksi tidak bisa disimpan. Coba lagi.')).toBeVisible();
  await expect.element(card.getByRole('button', { name: 'Simpan', exact: true })).toBeEnabled();
  expect(committed.size).toBe(1);
  await card.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect.element(card.getByText('Tersimpan · dikonfirmasi olehmu')).toBeVisible();
  expect(committed.size).toBe(1);
  await card.getByRole('button', { name: 'Buka di Transaksi' }).click();
  await vi.waitFor(() => {
    expect(router.state.location.href).toBe('/transactions?tx=tx-1');
  });
});

describe('Assistant recovery and request boundaries', () => {
  it('requires a successful settings reload after a refusal and a subsequent network outage', async () => {
    server.getAiSettings
      .mockResolvedValueOnce({ ok: false, code: 'AI_PERMISSION_REQUIRED' })
      .mockRejectedValueOnce(new Error('offline'));
    await render();
    const alert = page.getByRole('alert');
    await expect.element(alert).toBeVisible();
    expect(composer().elements()).toHaveLength(0);
    const firstFailure = alert.element().textContent;
    await page.getByRole('button', { name: 'Coba lagi' }).click();
    await expect.element(alert).toBeVisible();
    await expect.element(alert).not.toMatchTextContent(firstFailure);
    expect(composer().elements()).toHaveLength(0);
    await page.getByRole('button', { name: 'Coba lagi' }).click();
    await expect.element(composer()).toBeVisible();
    await expect.element(alert).not.toBeInTheDocument();
  });

  it('ignores a settings request from a closed sheet after a newer open has loaded', async () => {
    const stale = Promise.withResolvers<{ ok: false; code: string }>();
    server.getAiSettings.mockReturnValueOnce(stale.promise);
    await render();
    await expect.element(page.getByText('Menyiapkan jawaban…')).toBeVisible();
    expect(composer().elements()).toHaveLength(0);
    await page.getByRole('button', { name: 'Tutup asisten', exact: true }).click();
    await expect.element(page.getByRole('dialog', { name: 'Asisten' })).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Buka kembali Asisten' }).click();
    await expect.element(composer()).toBeVisible();
    stale.resolve({ ok: false, code: 'AI_PERMISSION_REQUIRED' });
    await flushReact();
    await expect.element(composer()).toBeVisible();
    expect(page.getByRole('alert').elements()).toHaveLength(0);
  });

  it('keeps a late answer without overwriting a failed settings reload', async () => {
    const answer = Promise.withResolvers<{ ok: true; value: AssistantAnswer }>();
    server.askAssistant.mockReturnValueOnce(answer.promise);
    await render();
    await composer().fill('Apa kabar anggaran?');
    await page.getByRole('button', { name: 'Kirim' }).click();
    await expect.element(page.getByText('Menyiapkan jawaban…')).toBeVisible();
    await page.getByRole('button', { name: 'Tutup asisten', exact: true }).click();
    await expect.element(page.getByRole('dialog', { name: 'Asisten' })).not.toBeInTheDocument();
    server.getAiSettings.mockRejectedValueOnce(new Error('offline'));
    await page.getByRole('button', { name: 'Buka kembali Asisten' }).click();
    await expect.element(page.getByRole('alert')).toBeVisible();
    answer.resolve({ ok: true, value: draftAnswer({ text: 'Jawaban dari permintaan sebelumnya.', draft: null }) });
    await flushReact();
    await expect.element(page.getByRole('alert')).toBeVisible();
    expect(composer().elements()).toHaveLength(0);
    await page.getByRole('button', { name: 'Coba lagi' }).click();
    await expect.element(page.getByText('Jawaban dari permintaan sebelumnya.')).toBeVisible();
    await expect.element(composer()).toBeVisible();
  });

  it('does not bill empty input, IME confirmation, or a second Enter while a request is in flight', async () => {
    const answer = Promise.withResolvers<{ ok: true; value: AssistantAnswer }>();
    server.askAssistant.mockReturnValueOnce(answer.promise);
    await render();
    await composer().fill('   ');
    await userEvent.keyboard('{Enter}');
    expect(server.askAssistant).not.toHaveBeenCalled();
    await composer().fill('Bantu bandingkan bulan ini');
    composer()
      .element()
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    expect(server.askAssistant).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByText('Menyiapkan jawaban…')).toBeVisible();
    await composer().fill('Pertanyaan berikutnya');
    await userEvent.keyboard('{Enter}');
    expect(server.askAssistant).toHaveBeenCalledTimes(1);
    answer.resolve({ ok: true, value: draftAnswer({ text: 'Perbandingan selesai.', draft: null }) });
    await expect.element(page.getByText('Perbandingan selesai.')).toBeVisible();
    await expect.element(composer()).toHaveValue('Pertanyaan berikutnya');
  });

  it('preserves an earlier answer when a later question loses its network connection', async () => {
    server.askAssistant
      .mockResolvedValueOnce({ ok: true, value: draftAnswer({ text: 'Jawaban pertama.', draft: null }) })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ok: true,
        value: draftAnswer({ text: 'Jawaban kedua setelah tersambung.', draft: null }),
      });
    await render();
    await composer().fill('Pertanyaan satu');
    await page.getByRole('button', { name: 'Kirim' }).click();
    await expect.element(page.getByText('Jawaban pertama.')).toBeVisible();
    await composer().fill('Pertanyaan dua');
    await page.getByRole('button', { name: 'Kirim' }).click();
    await expect.element(page.getByRole('alert')).toBeVisible();
    await expect.element(page.getByText('Jawaban pertama.')).toBeVisible();
    await page.getByRole('button', { name: 'Coba lagi' }).click();
    await expect.element(page.getByText('Jawaban kedua setelah tersambung.')).toBeVisible();
    await expect.element(page.getByText('Jawaban pertama.')).toBeVisible();
  });

  it('offers a new answer attempt when the provider returns no answer', async () => {
    server.askAssistant
      .mockResolvedValueOnce({ ok: true, value: draftAnswer({ text: '', draft: null }) })
      .mockResolvedValueOnce({ ok: true, value: draftAnswer({ text: 'Jawaban tersedia.', draft: null }) });
    await render();
    await composer().fill('Berapa sisa anggaran?');
    await page.getByRole('button', { name: 'Kirim' }).click();
    await expect.element(page.getByText('Asisten tidak memberi jawaban. Coba lagi.')).toBeVisible();
    await page.getByRole('button', { name: 'Coba lagi' }).click();
    await expect.element(page.getByText('Jawaban tersedia.')).toBeVisible();
    expect(server.recordTransaction).not.toHaveBeenCalled();
  });

  it('opens the source budget page and closes the Assistant without recording anything', async () => {
    server.askAssistant.mockResolvedValueOnce({
      ok: true,
      value: draftAnswer({
        text: 'Lihat anggaran untuk rincian.',
        draft: null,
        cards: [
          {
            kind: 'budget',
            from: '2026-10-01' as LocalDate,
            to: '2026-10-31' as LocalDate,
            currency: 'IDR',
            lines: [],
            unbudgetedSpentMinor: 0n,
          },
        ],
      }),
    });
    const { router } = await render();
    await composer().fill('Berapa sisa anggaran?');
    await page.getByRole('button', { name: 'Kirim' }).click();
    await page.getByRole('link', { name: 'Lihat anggaran' }).click();
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/budget');
    });
    await expect.element(page.getByRole('dialog', { name: 'Asisten' })).not.toBeInTheDocument();
    expect(server.recordTransaction).not.toHaveBeenCalled();
  });

  it('unlocks an income draft after a refused save and allows an explicit successful retry', async () => {
    const write = Promise.withResolvers<{ ok: false; code: string }>();
    server.recordTransaction.mockReturnValueOnce(write.promise);
    server.askAssistant.mockResolvedValueOnce({
      ok: true,
      value: draftAnswer({
        draft: {
          ...BASE_DRAFT,
          type: 'income',
          categoryId: null,
          categoryName: null,
          categoryBuiltInKey: null,
          budget: null,
          balance: null,
        },
      }),
    });
    await render();
    await composer().fill('Catat pemasukan 45.000 pakai GoPay');
    await page.getByRole('button', { name: 'Kirim' }).click();
    const card = page.getByRole('group', { name: 'Draft transaksi' });
    await card.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect.element(card.getByRole('button', { name: 'Simpan', exact: true })).toBeDisabled();
    await expect.element(card.getByRole('button', { name: 'Ubah' })).toBeDisabled();
    await expect.element(card.getByRole('button', { name: 'Batal', exact: true })).toBeDisabled();
    write.resolve({ ok: false, code: 'ACCOUNT_NOT_FOUND' });
    await expect.element(page.getByText('Transaksi tidak bisa disimpan. Coba lagi.')).toBeVisible();
    await expect.element(card.getByRole('button', { name: 'Simpan', exact: true })).toBeEnabled();
    await card.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect.element(card.getByText('Tersimpan · dikonfirmasi olehmu')).toBeVisible();
  });
});
