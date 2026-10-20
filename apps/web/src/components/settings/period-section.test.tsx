// SPDX-License-Identifier: AGPL-3.0-only
import type { Payday, PeriodsOverview, PeriodView, StartDayPreview } from '@wf/db/periods';
import type { LocalDate, Period, PeriodStartDay } from '@wf/domain/period';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import { gridTarget, PeriodSection, recalculation } from './period-section.tsx';

const server = vi.hoisted(() => ({ previewPeriodStart: vi.fn(), changePeriodStart: vi.fn() }));
vi.mock('../../server/fn/budget-write.ts', () => server);
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@wf/ui/toast', () => toasts);

const TODAY = '2026-10-15' as LocalDate;

function period(start: string, end: string, days: number, kind: Period['kind'] = 'normal'): Period {
  return { kind, start: start as LocalDate, end: end as LocalDate, days, label: end.slice(0, 7) as Period['label'] };
}

function row(base: Period, status: PeriodView['status'] = 'open'): PeriodView {
  return { ...base, id: `id-${base.start}`, status, closedAt: status === 'closed' ? new Date('2026-10-01') : null };
}

const SEPTEMBER = row(period('2026-09-01', '2026-09-30', 30), 'closed');
const OCTOBER = row(period('2026-10-01', '2026-10-31', 31));
const NOVEMBER = period('2026-11-01', '2026-11-30', 30);
const DECEMBER = period('2026-12-01', '2026-12-31', 31);

const OVERVIEW: PeriodsOverview = {
  startDay: 1 as PeriodStartDay,
  mode: 'fixed_day',
  today: TODAY,
  baseCurrency: 'IDR',
  current: OCTOBER,
  periods: [OCTOBER, SEPTEMBER],
  upcoming: [NOVEMBER, DECEMBER],
};
const PAYDAY: Payday = { day: 1 as PeriodStartDay, merchant: 'PT Kinarya', count: 6 };

const TRANSITION = period('2026-11-01', '2026-11-24', 24, 'transition');
const NEW_OCTOBER = period('2026-09-25', '2026-10-24', 30);

function preview(overrides: Partial<StartDayPreview> = {}): StartDayPreview {
  return {
    apply: 'next_period',
    fromDay: 1 as PeriodStartDay,
    toDay: 25 as PeriodStartDay,
    paydayDay: 1 as PeriodStartDay,
    baseCurrency: 'IDR',
    current: OCTOBER,
    periods: [OCTOBER, TRANSITION, period('2026-11-25', '2026-12-24', 30)],
    transition: { period: TRANSITION, limitMinor: 18_750_000n, proratedMinor: 15_000_000n },
    moved: { count: 0, largest: [] },
    ...overrides,
  };
}

const NEXT = preview();
const RECALCULATE = preview({
  apply: 'recalculate',
  periods: [NEW_OCTOBER, period('2026-10-25', '2026-11-24', 31), period('2026-11-25', '2026-12-24', 30)],
  transition: null,
  moved: {
    count: 9,
    largest: [
      {
        id: 'tx-1',
        localDate: '2026-09-27' as LocalDate,
        merchant: 'Tokopedia',
        description: 'Sepatu lari',
        amountMinor: 449_000n,
      },
    ],
  },
});

const ok = <T,>(value: T) => Promise.resolve({ ok: true, value });

/** Answers `previewPeriodStart` with `next` / `recalculate` by the requested `apply`. */
function previews(next: StartDayPreview = NEXT, recalculate: StartDayPreview = RECALCULATE) {
  server.previewPeriodStart.mockImplementation(({ data }: { data: { apply: string } }) =>
    ok(data.apply === 'next_period' ? next : recalculate),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('gridTarget', () => {
  it('moves by day and week within 1–28 and ignores other keys', () => {
    expect(gridTarget('ArrowRight', 1)).toBe(2);
    expect(gridTarget('ArrowLeft', 1)).toBe(1);
    expect(gridTarget('ArrowDown', 25)).toBe(28);
    expect(gridTarget('ArrowUp', 9)).toBe(2);
    expect(gridTarget('Home', 17)).toBe(1);
    expect(gridTarget('End', 3)).toBe(28);
    expect(gridTarget('a', 3)).toBeNull();
  });
});

describe('recalculation', () => {
  it('names the period containing today and the days moving into it', () => {
    expect(recalculation(RECALCULATE, OCTOBER, TODAY, 'id')).toEqual({
      movedIn: true,
      name: 'Oktober',
      range: '25 Sep – 24 Okt',
      moved: '25–30 Sep',
      largest: { ...RECALCULATE.moved.largest[0], label: 'Tokopedia — Sepatu lari' },
    });
  });

  it('knows days leaving the period, unnamed transactions, and falls back to the current period', () => {
    const later = preview({
      apply: 'recalculate',
      periods: [period('2026-10-05', '2026-11-04', 31)],
      moved: {
        count: 1,
        largest: [
          { id: 'tx', localDate: '2026-10-02' as LocalDate, merchant: null, description: null, amountMinor: 1n },
        ],
      },
    });
    expect(recalculation(later, OCTOBER, TODAY, 'id')).toMatchObject({
      movedIn: false,
      name: 'November',
      moved: '1–4 Okt',
      largest: { label: 'Tanpa nama' },
    });
    const elsewhere = preview({ periods: [DECEMBER] });
    expect(recalculation(elsewhere, OCTOBER, TODAY, 'id')).toMatchObject({ name: 'Oktober', largest: null });
  });
});

describe('PeriodSection', () => {
  it('shows the start day, the matching payday, the naming rule, and the current and coming periods', async () => {
    const { screen } = await renderApp(<PeriodSection overview={OVERVIEW} payday={PAYDAY} />);
    const start = screen.getByRole('region', { name: 'Awal periode' });
    await expect
      .element(start.getByRole('button', { name: 'Bulan keuangan dimulai Tanggal 1' }))
      .toHaveTextContent('Tanggal 1');
    await expect.element(start.getByText('Tanggal 1–28 · sama di setiap bulan, termasuk Februari')).toBeVisible();
    await expect.element(start.getByText('Gaji PT Kinarya masuk tiap tgl 1 (6 bulan terakhir)')).toBeVisible();
    await expect.element(start.getByText('Sudah sesuai')).toBeVisible();
    await expect.element(start.getByText(/Dihitung dari transaksi Gaji terakhir/)).toBeVisible();
    await expect.element(start.getByText('Dipakai di judul & laporan')).toBeVisible();
    await expect
      .element(start.getByTitle('Periode dinamai menurut bulan berakhirnya'))
      .toHaveTextContent('Akhir · Periode dinamai menurut bulan berakhirnya');

    const preview = screen.getByRole('region', { name: 'Pratinjau' });
    expect(preview.element().textContent).toBe(
      'PratinjauOktober 20261 Okt – 31 Okt31 hariNovember 20261 Nov – 30 Nov30 hariDesember 20261 Des – 31 Des31 hari',
    );
    expect(preview.element().querySelector('[aria-current="true"]')?.textContent).toContain('Oktober 2026');
    await expect.element(screen.getByRole('status').last()).toHaveTextContent('Tersinkron ke semua perangkat');
    await expect.element(screen.getByRole('button', { name: 'Simpan perubahan' })).toBeDisabled();
    await expect.element(screen.getByRole('button', { name: 'Batal' })).toBeDisabled();
    expect(screen.getByRole('group', { name: 'Terapkan perubahan' }).elements()).toHaveLength(0);
  });

  it('picks a day with the keyboard and previews both ways to apply it', async () => {
    previews();
    const { screen } = await renderApp(<PeriodSection overview={OVERVIEW} payday={PAYDAY} />);
    await screen.getByRole('button', { name: /Bulan keuangan dimulai/ }).click();
    const grid = screen.getByRole('grid', { name: 'Mulai tiap tanggal' });
    await expect.element(grid.getByRole('button', { name: 'Tanggal 1', exact: true })).toHaveFocus();
    await expect.element(grid.getByRole('gridcell').first()).toHaveAttribute('aria-selected', 'true');
    await expect.element(screen.getByText(/Tanggal 29–31 tidak tersedia/)).toBeVisible();
    await userEvent.keyboard('{End}');
    await expect.element(grid.getByRole('button', { name: 'Tanggal 28' })).toHaveFocus();
    await userEvent.keyboard('{Home}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowUp}');
    await expect.element(grid.getByRole('button', { name: 'Tanggal 18' })).toHaveFocus();
    await userEvent.keyboard('x{ArrowDown}{ArrowLeft}{ArrowRight}{Enter}');
    expect(server.previewPeriodStart).toHaveBeenCalledWith({ data: { day: 25, apply: 'next_period' } });
    expect(server.previewPeriodStart).toHaveBeenCalledWith({ data: { day: 25, apply: 'recalculate' } });

    const start = screen.getByRole('region', { name: 'Awal periode' });
    await expect.element(start.getByRole('button', { name: /Bulan keuangan dimulai/ })).toHaveTextContent('Tanggal 25');
    await expect.element(start.getByText('Gaji PT Kinarya biasanya masuk tgl 1, bukan tgl 25')).toBeVisible();
    await expect.element(start.getByText('Tidak sejalan gajian')).toBeVisible();
    await expect.element(start.getByText('25 Sep – 24 Okt disebut “Oktober”')).toBeVisible();

    const preview = screen.getByRole('region', { name: 'Pratinjau' });
    await expect
      .poll(() => preview.element().textContent)
      .toBe('PratinjauOktober 20261 Okt – 31 OkttetapTransisi1 Nov – 24 Nov24 hariDesember 202625 Nov – 24 Des30 hari');
    const apply = screen.getByRole('group', { name: 'Terapkan perubahan' });
    await expect
      .element(apply.getByText(/^Oktober tetap/))
      .toHaveTextContent(
        'Oktober tetap 1–31 Okt, lalu transisi 1–24 Nov: batas anggaran Rp18.750.000 → Rp15.000.000 (24/30 hari).',
      );
    await expect
      .element(apply.getByText(/^Oktober jadi/))
      .toHaveTextContent('Oktober jadi 25 Sep – 24 Okt. Transaksi 25–30 Sep ikut pindah, mis. Tokopedia Rp449.000.');
    await expect.element(apply.getByRole('radio', { name: /Mulai periode berikutnya/ })).toBeChecked();
    await expect.element(screen.getByRole('status').last()).toHaveTextContent('Ada perubahan belum disimpan');

    await apply.getByRole('radio', { name: /Hitung ulang periode berjalan/ }).click();
    await expect.poll(() => preview.element().textContent).toContain('Oktober 202625 Sep – 24 Okt30 hari');
  });

  it('confirms a recalculation with its impact before saving it', async () => {
    previews();
    server.changePeriodStart.mockReturnValue(ok(RECALCULATE));
    const { screen, router } = await renderApp(<PeriodSection overview={OVERVIEW} payday={PAYDAY} />);
    const invalidate = vi.spyOn(router, 'invalidate');
    await screen.getByRole('button', { name: /Bulan keuangan dimulai/ }).click();
    await screen.getByRole('button', { name: 'Tanggal 25' }).click();
    await screen.getByRole('radio', { name: /Hitung ulang periode berjalan/ }).click();
    await screen.getByRole('button', { name: 'Simpan perubahan' }).click();

    const dialog = screen.getByRole('dialog', { name: 'Hitung ulang periode Oktober?' });
    await expect
      .element(dialog.getByText('Oktober jadi 25 Sep – 24 Okt mulai sekarang.', { exact: false }))
      .toBeVisible();
    expect(
      dialog
        .getByRole('listitem')
        .elements()
        .map((item) => item.textContent),
    ).toEqual([
      'Transaksi 25–30 Sep pindah ke Oktober, mis. Tokopedia — Sepatu lari Rp449.000 (27 Sep)',
      'Anggaran & saving rate Oktober dihitung ulang',
      'Laporan September yang sudah final tidak berubah',
      'Setoran rutin & tagihan tetap di tanggalnya',
    ]);
    await dialog.getByRole('button', { name: 'Batal' }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(server.changePeriodStart).not.toHaveBeenCalled();

    await screen.getByRole('button', { name: 'Simpan perubahan' }).click();
    await screen.getByRole('dialog').getByRole('button', { name: 'Hitung ulang' }).click();
    expect(server.changePeriodStart).toHaveBeenCalledWith({
      data: { day: 25, apply: 'recalculate', mode: 'fixed_day' },
    });
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
    expect(toasts.toast).toHaveBeenCalledWith({ title: 'Awal periode disimpan · tgl 25' });
    expect(invalidate).toHaveBeenCalled();
    await expect.element(screen.getByRole('radio', { name: /Mulai periode berikutnya/ })).toBeChecked();
  });

  it('saves from the next period, reports a refusal, and cancels back to the saved day', async () => {
    previews();
    server.changePeriodStart.mockReturnValue(Promise.resolve({ ok: false, code: 'PERIOD_CLOSED' }));
    const { screen } = await renderApp(<PeriodSection overview={OVERVIEW} payday={PAYDAY} />);
    await screen.getByRole('button', { name: /Bulan keuangan dimulai/ }).click();
    await screen.getByRole('button', { name: 'Tanggal 25' }).click();
    await screen.getByRole('button', { name: 'Simpan perubahan' }).click();
    expect(server.changePeriodStart).toHaveBeenCalledWith({
      data: { day: 25, apply: 'next_period', mode: 'fixed_day' },
    });
    expect(toasts.toast).toHaveBeenCalledWith({
      title: 'Awal periode gagal disimpan',
      description: 'Periode ini sudah ditutup dan hanya bisa dibaca.',
      tone: 'error',
    });
    await screen.getByRole('button', { name: 'Batal' }).click();
    await expect.element(screen.getByRole('button', { name: /Bulan keuangan dimulai/ })).toHaveTextContent('Tanggal 1');
    await expect.element(screen.getByText('Sudah sesuai')).toBeVisible();
  });

  it('follows the payday as a mode-only change without the apply options', async () => {
    server.changePeriodStart.mockReturnValue(ok(NEXT));
    const { screen } = await renderApp(<PeriodSection overview={OVERVIEW} payday={PAYDAY} />);
    await screen.getByRole('button', { name: /Bulan keuangan dimulai/ }).click();
    const follow = screen.getByRole('button', { name: 'Ikuti gajian · tgl 1' });
    await expect.element(follow).toHaveAttribute('aria-pressed', 'false');
    await follow.click();
    await expect.element(screen.getByRole('status').last()).toHaveTextContent('Ada perubahan belum disimpan');
    expect(screen.getByRole('group', { name: 'Terapkan perubahan' }).elements()).toHaveLength(0);
    expect(server.previewPeriodStart).not.toHaveBeenCalled();
    await screen.getByRole('button', { name: 'Simpan perubahan' }).click();
    expect(server.changePeriodStart).toHaveBeenCalledWith({
      data: { day: 1, apply: 'next_period', mode: 'follow_payday' },
    });
    await screen.getByRole('button', { name: /Bulan keuangan dimulai/ }).click();
    await expect
      .element(screen.getByRole('button', { name: 'Ikuti gajian · tgl 1' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('explains a missing payday', async () => {
    const { screen } = await renderApp(
      <PeriodSection overview={OVERVIEW} payday={{ day: null, merchant: null, count: 0 }} />,
    );
    await expect.element(screen.getByText('Belum ada pemasukan Gaji, jadi belum ada saran tanggal.')).toBeVisible();
    expect(screen.getByText(/Dihitung dari transaksi Gaji terakhir/).elements()).toHaveLength(0);
    await screen.getByRole('button', { name: /Bulan keuangan dimulai/ }).click();
    const follow = screen.getByRole('button', { name: 'Ikuti gajian' });
    await expect.element(follow).toBeDisabled();
    await expect.element(follow).toHaveAccessibleDescription('Butuh pemasukan Gaji yang sudah tercatat.');
  });

  it('words an unnamed salary', async () => {
    previews();
    const { screen } = await renderApp(
      <PeriodSection overview={OVERVIEW} payday={{ day: 1 as PeriodStartDay, merchant: null, count: 1 }} />,
    );
    await expect.element(screen.getByText('Gaji masuk tiap tgl 1 (1 bulan terakhir)')).toBeVisible();
    await screen.getByRole('button', { name: /Bulan keuangan dimulai/ }).click();
    await screen.getByRole('button', { name: 'Tanggal 25' }).click();
    await expect.element(screen.getByText('Gaji biasanya masuk tgl 1, bukan tgl 25')).toBeVisible();
  });

  it('shows the preview loading, drops a stale answer, and reports a failed preview', async () => {
    const pending: ((value: unknown) => void)[] = [];
    server.previewPeriodStart.mockImplementation(() => {
      const { promise, resolve } = Promise.withResolvers<unknown>();
      pending.push(resolve);
      return promise;
    });
    const { screen } = await renderApp(<PeriodSection overview={OVERVIEW} payday={PAYDAY} />);
    await screen.getByRole('button', { name: /Bulan keuangan dimulai/ }).click();
    await screen.getByRole('button', { name: 'Tanggal 25' }).click();
    await expect.element(screen.getByText('Menghitung pratinjau…')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Simpan perubahan' })).toBeDisabled();
    await screen.getByRole('button', { name: /Bulan keuangan dimulai/ }).click();
    await screen.getByRole('button', { name: 'Tanggal 5' }).click();
    for (const resolve of pending.splice(0, 2)) resolve({ ok: true, value: NEXT });
    await expect.element(screen.getByText('Menghitung pratinjau…')).toBeVisible();
    pending[0]?.({ ok: true, value: NEXT });
    pending[1]?.({ ok: false, code: 'INVALID_PERIOD' });
    await expect.element(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Terapkan perubahan' }).elements()).toHaveLength(0);
  });

  it('words a change without a budget and with transactions leaving the current period', async () => {
    const noBudget = preview({ transition: { period: TRANSITION, limitMinor: 0n, proratedMinor: 0n } });
    const later = preview({
      apply: 'recalculate',
      current: OCTOBER,
      periods: [period('2026-10-05', '2026-11-04', 31, 'transition')],
      transition: null,
      moved: {
        count: 1,
        largest: [
          {
            id: 'tx',
            localDate: '2026-10-02' as LocalDate,
            merchant: null,
            description: 'Parkir',
            amountMinor: 5_000n,
          },
        ],
      },
    });
    previews(noBudget, later);
    const overview = { ...OVERVIEW, periods: [OCTOBER] };
    const { screen } = await renderApp(<PeriodSection overview={overview} payday={PAYDAY} />);
    await screen.getByRole('button', { name: /Bulan keuangan dimulai/ }).click();
    await screen.getByRole('button', { name: 'Tanggal 5' }).click();
    const apply = screen.getByRole('group', { name: 'Terapkan perubahan' });
    await expect
      .element(apply.getByText(/^Oktober tetap/))
      .toHaveTextContent('Oktober tetap 1–31 Okt, lalu transisi 1–24 Nov (24 hari).');
    await expect
      .element(apply.getByText(/^November jadi/))
      .toHaveTextContent('November jadi 5 Okt – 4 Nov. Transaksi 1–4 Okt ikut pindah, mis. Parkir Rp5.000.');
    await expect.element(screen.getByText('Dipakai di judul & laporan')).toBeVisible();
    await apply.getByRole('radio', { name: /Hitung ulang periode berjalan/ }).click();
    await screen.getByRole('button', { name: 'Simpan perubahan' }).click();
    const dialog = screen.getByRole('dialog');
    await expect
      .element(dialog.getByText(/Transaksi 1–4 Okt keluar dari November/))
      .toHaveTextContent('Transaksi 1–4 Okt keluar dari November ke periode transisi, mis. Parkir Rp5.000 (2 Okt)');
    await expect.element(dialog.getByText('Laporan yang sudah final tidak berubah')).toBeVisible();
    await dialog.getByRole('button', { name: 'Batal' }).click();
  });

  it('words a change without a transition or moved transactions', async () => {
    previews(preview({ transition: null }), preview({ apply: 'recalculate', periods: [NEW_OCTOBER] }));
    const { screen } = await renderApp(<PeriodSection overview={OVERVIEW} payday={PAYDAY} />);
    await screen.getByRole('button', { name: /Bulan keuangan dimulai/ }).click();
    await screen.getByRole('button', { name: 'Tanggal 25' }).click();
    const options = screen.getByRole('group', { name: 'Terapkan perubahan' });
    await expect
      .element(options.getByText(/^Oktober tetap/))
      .toHaveTextContent('Oktober tetap 1–31 Okt; periode berikutnya mulai tgl 25.');
    await expect
      .element(options.getByText(/^Oktober jadi/))
      .toHaveTextContent('Oktober jadi 25 Sep – 24 Okt. Tidak ada transaksi yang pindah.');
    await options.getByRole('radio', { name: /Hitung ulang periode berjalan/ }).click();
    await screen.getByRole('button', { name: 'Simpan perubahan' }).click();
    await expect.element(screen.getByRole('dialog').getByText('Tidak ada transaksi yang pindah periode')).toBeVisible();
  });
});
