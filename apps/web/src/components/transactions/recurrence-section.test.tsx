// SPDX-License-Identifier: AGPL-3.0-only
import type { RecurrenceView } from '@wf/db/schedules';
import type { LocalDate } from '@wf/domain/period';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { BCA, JAGO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import {
  RecurrenceBadge,
  RecurrenceSection,
  useTransactionRecurrence,
  type RecurrenceSectionProps,
} from './recurrence-section.tsx';

const server = vi.hoisted(() => ({
  getTransactionRecurrence: vi.fn(),
  stopRecurrence: vi.fn(),
  undoStopRecurrence: vi.fn(),
}));
vi.mock('../../server/fn/schedules.ts', () => server);
const toasts = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { undo: vi.fn() });
  return { toast };
});
vi.mock('@wf/ui/toast', () => toasts);

const today = '2026-10-17' as LocalDate;
/** "Setor dana darurat" BCA Tahapan → Bibit, monthly on the 14th since 14 Okt (design `jibQf`). */
const SETOR: RecurrenceView = {
  id: 'rec-setor',
  template: {
    type: 'transfer',
    fromAccountId: BCA.id,
    toAccountId: JAGO.id,
    sentMinor: 3_000_000n,
    receivedMinor: 3_000_000n,
    description: 'Setor dana darurat',
  },
  currency: 'IDR',
  freq: 'monthly',
  interval: 1,
  startOn: '2026-10-14' as LocalDate,
  weekday: null,
  monthDay: 14,
  end: { type: 'never' },
  remindOffsetDays: 1,
  status: 'active',
  stoppedAt: null,
  preview: ['2026-11-14', '2026-12-14', '2027-01-14'] as LocalDate[],
  nextDue: { occurrenceId: 'occ-nov', dueDate: '2026-11-14' as LocalDate, status: 'scheduled' },
  occurrences: { confirmed: 1, skipped: 0, open: 3 },
  createdAt: new Date('2026-10-14T12:31:00Z'),
};
const STOPPED: RecurrenceView = {
  ...SETOR,
  status: 'stopped',
  stoppedAt: new Date('2026-10-17T03:12:00Z'),
  preview: [],
};

async function renderSection(recurrence: RecurrenceView, patch: Partial<RecurrenceSectionProps> = {}) {
  const onChanged = vi.fn();
  const result = await renderApp(
    <RecurrenceSection
      recurrence={recurrence}
      title="Setor dana darurat"
      transactionDate={'2026-10-14' as LocalDate}
      route="BCA Tahapan → Bank Jago"
      locale="id"
      timeZone="Asia/Jakarta"
      today={today}
      onChanged={onChanged}
      {...patch}
    />,
  );
  return { ...result, onChanged };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('RecurrenceSection', () => {
  it('shows the rule and the next dates; stopping asks first and offers "Urungkan"', async () => {
    server.stopRecurrence.mockResolvedValue({ ok: true, value: { deletedOccurrences: 3 } });
    server.undoStopRecurrence.mockResolvedValue({ ok: true, value: SETOR });
    const { screen, onChanged } = await renderSection(SETOR);
    const section = screen.getByRole('region', { name: 'Ulangi' });
    await expect.element(section).toMatchTextContent('Aktif sejak 14 Okt · tampil di kalender');
    await expect.element(section).toMatchTextContent('Bulanan · tiap tgl 14');
    await expect.element(section.getByRole('list', { name: 'Berikutnya' })).toHaveTextContent('14 Nov14 Des14 Jan');
    await expect.element(section).toMatchTextContent('H-1');
    const toggle = section.getByRole('switch', { name: 'Ulangi transaksi ini' });
    await expect.element(toggle).toBeChecked();

    await userEvent.click(toggle);
    const dialog = page.getByRole('dialog', { name: 'Hentikan pengulangan?' });
    await expect
      .element(dialog)
      .toMatchTextContent('Jadwal mulai 14 Nov dihapus dari kalender dan pengingat H-1 dimatikan.');
    await expect.element(dialog).toMatchTextContent('BCA Tahapan → Bank Jago · tiap tgl 14');
    await expect.element(dialog).toMatchTextContent('Rp3.000.000');
    await expect.element(dialog).toMatchTextContent('Transaksi 14 Okt tetap tercatat · saldo tidak berubah');
    await userEvent.click(dialog.getByRole('button', { name: 'Batal' }));
    expect(server.stopRecurrence).not.toHaveBeenCalled();

    await userEvent.click(toggle);
    await userEvent.click(page.getByRole('dialog').getByRole('button', { name: 'Hentikan' }));
    expect(server.stopRecurrence).toHaveBeenCalledWith({ data: { id: 'rec-setor' } });
    await vi.waitFor(() => {
      expect(toasts.toast.undo).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Pengulangan dihentikan',
          description: 'Setor dana darurat · jadwal mulai 14 Nov dihapus dari kalender.',
          undoLabel: 'Urungkan',
        }),
      );
    });
    expect(onChanged).toHaveBeenCalledOnce();
    const [{ onUndo }] = toasts.toast.undo.mock.lastCall as [{ onUndo: () => void }];
    onUndo();
    expect(server.undoStopRecurrence).toHaveBeenCalledWith({ data: { id: 'rec-setor' } });
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({ tone: 'info', title: 'Pengulangan dinyalakan lagi' });
    });
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('a stopped recurrence says since when, and turns on again', async () => {
    server.undoStopRecurrence.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    const { screen, onChanged } = await renderSection(STOPPED);
    const section = screen.getByRole('region', { name: 'Ulangi' });
    await expect.element(section).toMatchTextContent('Mati · dihentikan 17 Okt');
    await expect
      .element(section)
      .toMatchTextContent(
        'Jadwal mulai 14 Nov sudah dihapus dari kalender. Nyalakan lagi untuk melanjutkan tiap tgl 14.',
      );
    const toggle = section.getByRole('switch');
    await expect.element(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({
        tone: 'error',
        title: 'Data ini sudah tidak ada. Muat ulang halaman.',
      });
    });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('a failed stop is told; weekly and yearly rules without a reminder or stop time read their own way', async () => {
    server.stopRecurrence.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
    const weekly = {
      ...SETOR,
      freq: 'weekly',
      weekday: 4,
      monthDay: null,
      remindOffsetDays: null,
      nextDue: { occurrenceId: 'occ', dueDate: '2026-10-22', status: 'scheduled' },
    } as RecurrenceView;
    const { screen, onChanged } = await renderSection(weekly);
    await expect.element(screen.getByRole('region')).toMatchTextContent('Mingguan · tiap Kamis');
    await expect.element(screen.getByRole('list')).toHaveTextContent('22 Okt29 Okt5 Nov');
    await expect.element(screen.getByRole('region')).not.toMatchTextContent('H-1');
    await userEvent.click(screen.getByRole('switch'));
    const dialog = page.getByRole('dialog');
    await expect.element(dialog).toMatchTextContent('Jadwal mulai 22 Okt dihapus dari kalender. Kamu bisa');
    await userEvent.click(dialog.getByRole('button', { name: 'Hentikan' }));
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({
        tone: 'error',
        title: 'Data ini sudah tidak ada. Muat ulang halaman.',
      });
    });
    expect(onChanged).not.toHaveBeenCalled();
    await screen.unmount();

    const yearly = {
      ...STOPPED,
      freq: 'yearly',
      monthDay: null,
      stoppedAt: null,
      startOn: '2026-12-01' as LocalDate,
      end: { type: 'after', count: 1 },
      template: { type: 'expense', accountId: BCA.id, amountMinor: 50_000n, categoryId: null },
    } as RecurrenceView;
    const second = await renderSection(yearly);
    const region = second.screen.getByRole('region');
    await expect.element(region).toMatchTextContent('Mati · dihentikan Ulangi transaksi ini');
    await expect
      .element(region)
      .toMatchTextContent(
        'Jadwal mulai 1 Des sudah dihapus dari kalender. Nyalakan lagi untuk melanjutkan tiap 1 Des.',
      );
    await second.screen.unmount();

    // Ended for good: nothing comes after.
    const ended = { ...yearly, startOn: '2025-12-01' as LocalDate } as RecurrenceView;
    const third = await renderSection(ended);
    await expect.element(third.screen.getByRole('region')).toMatchTextContent('Jadwal mulai sudah dihapus');
  });

  it('an active rule with nothing left lists no next dates', async () => {
    const ended = { ...SETOR, nextDue: null, end: { type: 'after', count: 1 } } as RecurrenceView;
    const { screen } = await renderSection(ended);
    await expect.element(screen.getByRole('list', { name: 'Berikutnya' })).toHaveTextContent('');
  });

  it('badges a repeating and a stopped transaction', async () => {
    const { screen } = await renderApp(
      <>
        <RecurrenceBadge recurrence={SETOR} />
        <RecurrenceBadge recurrence={STOPPED} />
      </>,
    );
    await expect.element(screen.getByText('Berulang · Bulanan')).toBeVisible();
    await expect.element(screen.getByText('Tidak berulang')).toBeVisible();
  });
});

describe('useTransactionRecurrence', () => {
  function Probe({ id }: { id: string }) {
    const { recurrence, reload } = useTransactionRecurrence(id, 0);
    return (
      <button type="button" onClick={reload}>
        {recurrence === undefined ? 'loading' : recurrence === null ? 'none' : recurrence.id}
      </button>
    );
  }

  it('loads the recurrence of a transaction, none when it fails, and reloads', async () => {
    server.getTransactionRecurrence.mockResolvedValueOnce({ ok: true, value: SETOR });
    const { screen } = await renderApp(<Probe id="tx-setor" />);
    await expect.element(screen.getByRole('button', { name: 'rec-setor' })).toBeVisible();
    expect(server.getTransactionRecurrence).toHaveBeenCalledWith({ data: { transactionId: 'tx-setor' } });
    server.getTransactionRecurrence.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    await userEvent.click(screen.getByRole('button'));
    await expect.element(screen.getByRole('button', { name: 'none' })).toBeVisible();
  });

  it('ignores an answer that arrives after unmounting', async () => {
    const pending = Promise.withResolvers<unknown>();
    server.getTransactionRecurrence.mockReturnValueOnce(pending.promise);
    const { screen } = await renderApp(<Probe id="tx-late" />);
    await expect.element(screen.getByRole('button', { name: 'loading' })).toBeVisible();
    await screen.unmount();
    pending.resolve({ ok: true, value: SETOR });
    await pending.promise;
  });
});
