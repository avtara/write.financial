// SPDX-License-Identifier: AGPL-3.0-only
import type { AiSettingsView } from '@wf/domain/ai';
import type { AssistantAnswer, AssistantDraft } from '@wf/domain/assistant';
import type { LocalDate } from '@wf/domain/period';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import { AssistantDialog } from './assistant-dialog.tsx';

const server = vi.hoisted(() => ({
  askAssistant: vi.fn(),
  getAiSettings: vi.fn(),
  recordTransaction: vi.fn(),
}));
vi.mock('../../server/fn/assistant.ts', () => ({ askAssistant: server.askAssistant }));
vi.mock('../../server/fn/ai.ts', () => ({ getAiSettings: server.getAiSettings }));
vi.mock('../../server/fn/transactions-write.ts', () => ({
  recordTransaction: server.recordTransaction,
  removeTransactions: vi.fn(),
}));
vi.mock('../ledger/receipt-entry.tsx', () => ({ ReceiptEntry: () => null }));
const record = vi.hoisted(() => ({ open: vi.fn(), announceSaved: vi.fn() }));
vi.mock('../ledger/record-transaction.tsx', () => ({
  useRecordTransaction: () => ({ open: record.open }),
}));
vi.mock('../ledger/announce-saved.tsx', () => ({ announceSaved: record.announceSaved }));

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
  categoryId: '0192a6c4-0000-7000-8000-0000000000c1',
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

const render = (onClose = vi.fn(), hidden = false) =>
  renderApp(<AssistantDialog open onClose={onClose} timeZone="Asia/Jakarta" />, {
    preferences: { locale: 'id', balancesHidden: hidden },
  });

beforeEach(() => {
  vi.clearAllMocks();
  server.getAiSettings.mockResolvedValue({ ok: true, value: SETTINGS });
  server.askAssistant.mockResolvedValue({ ok: true, value: draftAnswer() });
  server.recordTransaction.mockResolvedValue({ ok: true, value: { id: 't1', created: true, fxDifference: null } });
});

const composer = () => page.getByRole('textbox', { name: 'Pertanyaan untuk Asisten' });

describe('AssistantDialog states', () => {
  it('explains how to connect a provider and links to its settings', async () => {
    const onClose = vi.fn();
    server.getAiSettings.mockResolvedValue({
      ok: true,
      value: { ...SETTINGS, connections: [] },
    });
    await render(onClose);
    await expect.element(page.getByRole('heading', { name: 'Belum ada penyedia AI' })).toBeVisible();
    await expect.element(page.getByText(/Asisten memakai API key milikmu/)).toBeVisible();
    await page.getByRole('button', { name: 'Buka Pengaturan → AI agent' }).click();
    expect(onClose).toHaveBeenCalled();
  });

  it('asks for the financial-data permission instead of answering', async () => {
    server.getAiSettings.mockResolvedValue({ ok: true, value: { ...SETTINGS, allowReadFinancial: false } });
    await render();
    await expect.element(page.getByRole('heading', { name: 'Izin baca data keuangan mati' })).toBeVisible();
    expect(composer().elements()).toHaveLength(0);
  });

  it('shows the provider, model and month meter in the header', async () => {
    await render();
    await expect.element(page.getByRole('dialog', { name: 'Asisten' })).toBeVisible();
    await expect.element(page.getByText(/claude-sonnet-5\.5/)).toBeVisible();
    await expect.element(page.getByText(/\$1,24 dari \$5,00 bulan ini/)).toBeVisible();
  });
});

describe('AssistantDialog asking', () => {
  it('sends an example question with the recent turns and shows the answer', async () => {
    await render();
    await page.getByRole('button', { name: 'Berapa sisa anggaran Makan bulan ini?' }).click();
    await expect.element(page.getByText(/Siap, ini draftnya/)).toBeVisible();
    expect(server.askAssistant).toHaveBeenCalledWith({
      data: {
        requestId: expect.any(String) as string,
        expectedRevision: SETTINGS.revision,
        question: 'Berapa sisa anggaran Makan bulan ini?',
        history: [],
      },
    });
  });

  it('masks amounts inside the answer while privacy mode is on', async () => {
    server.askAssistant.mockResolvedValue({
      ok: true,
      value: draftAnswer({
        text: 'Makan & Dapur terpakai Rp3.200.000 dari Rp3.500.000 (91%).',
        draft: null,
      }),
    });
    await render(vi.fn(), true);
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
    expect(server.askAssistant).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ question: 'Bandingkan Okt vs Sep' }) as unknown,
    });
  });
});

describe('AssistantDialog drafts', () => {
  it('shows the impact, saves only on confirmation, and offers the saved row', async () => {
    const onClose = vi.fn();
    await render(onClose);
    await composer().fill('Catat makan siang tadi 45.000 pakai GoPay');
    await page.getByRole('button', { name: 'Kirim' }).click();

    const card = page.getByRole('group', { name: 'Draft transaksi' });
    await expect.element(card.getByText('Makan siang')).toBeVisible();
    await expect.element(card.getByText('Makan & Dapur')).toBeVisible();
    await expect.element(card.getByText('GoPay')).toBeVisible();
    await expect.element(card.getByText('Kam, 15 Okt · 12.10')).toBeVisible();
    await expect.element(card.getByText(/Makan & Dapur jadi 93\s*%/)).toBeVisible();
    await expect.element(card.getByText(/saldo GoPay Rp367\.000 .*Rp500\.000/)).toBeVisible();
    expect(server.recordTransaction).not.toHaveBeenCalled();

    await card.getByRole('button', { name: 'Simpan' }).click();
    expect(server.recordTransaction).toHaveBeenCalledWith({
      data: {
        type: 'expense',
        clientId: expect.any(String) as string,
        occurredAt: new Date('2026-10-15T05:10:00Z'),
        accountId: '0192a6c4-0000-7000-8000-0000000000b1',
        amountMinor: 45_000n,
        categoryId: '0192a6c4-0000-7000-8000-0000000000c1',
        description: 'Makan siang',
        tags: [],
        source: 'assistant',
      },
    });
    expect(record.announceSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1', amountMinor: -45_000n, accountName: 'GoPay' }),
    );
    await expect.element(card.getByText('Tersimpan · dikonfirmasi olehmu')).toBeVisible();
    await card.getByRole('button', { name: 'Buka di Transaksi' }).click();
    expect(onClose).toHaveBeenCalled();
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

  it('edits through the Record sheet and cancels without writing', async () => {
    await render();
    await composer().fill('Catat makan siang tadi 45.000 pakai GoPay');
    await page.getByRole('button', { name: 'Kirim' }).click();
    const card = page.getByRole('group', { name: 'Draft transaksi' });

    await card.getByRole('button', { name: 'Ubah' }).click();
    expect(record.open).toHaveBeenCalledWith({
      type: 'expense',
      description: 'Makan siang',
      date: '2026-10-15',
      time: '12:10',
      accountId: '0192a6c4-0000-7000-8000-0000000000b1',
      amountMinor: 45_000n,
      categoryId: '0192a6c4-0000-7000-8000-0000000000c1',
    });

    await card.getByRole('button', { name: 'Batal' }).click();
    await expect.element(page.getByText('Draf dibatalkan.')).toBeVisible();
    expect(server.recordTransaction).not.toHaveBeenCalled();
  });
});
