// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { ReportView } from '@wf/db/reports';
import { FINAL_VIEW, PROVISIONAL_VIEW } from '../../../test/report-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { NotesSection, SubsSection } from './reports-subs.tsx';

describe('SubsSection', () => {
  it('shows the active count, the monthly and yearly totals, and the share', async () => {
    const { screen } = await renderApp(<SubsSection view={FINAL_VIEW} locale="id" />);
    const section = screen.getByRole('region', { name: 'Langganan' });
    await expect.element(section).toMatchTextContent('5 aktif · Rp845.900/bulan ≈ Rp10.150.800/tahun');
    await expect.element(section).toMatchTextContent('4,62%');
    await expect.element(section).toMatchTextContent('1 langganan tanpa kurs pada akhir periode.');
  });

  it('keeps quiet without an unconverted subscription and without expenses', async () => {
    const noShare = {
      ...FINAL_VIEW,
      sections: {
        ...FINAL_VIEW.sections,
        subscriptions: { ...FINAL_VIEW.sections.subscriptions, shareBps: null, unconverted: 0 },
      },
    } satisfies ReportView;
    const { screen } = await renderApp(<SubsSection view={noShare} locale="id" />);
    const section = screen.getByRole('region', { name: 'Langganan' });
    await expect.element(section).toMatchTextContent('5 aktif · Rp845.900/bulan ≈ Rp10.150.800/tahun');
    await expect.element(section).not.toMatchTextContent('%');
    await expect.element(section).not.toMatchTextContent('tanpa kurs');
  });

  it('uses the English copy', async () => {
    const { screen } = await renderApp(<SubsSection view={PROVISIONAL_VIEW} locale="en" />, {
      preferences: { locale: 'en' },
    });
    const section = screen.getByRole('region', { name: 'Subscriptions' });
    await expect.element(section).toMatchTextContent('5 active · Rp845,900/month ≈ Rp10,150,800/year');
    await expect.element(section).toMatchTextContent('4.62%');
  });
});

describe('NotesSection', () => {
  it('lists the facts the next period should watch', async () => {
    const { screen } = await renderApp(<NotesSection view={FINAL_VIEW} locale="id" />);
    await expect.element(screen.getByText('Catatan untuk periode berikutnya')).toBeVisible();
    await expect.element(screen.getByText('Belanja Online lewat Rp600.000')).toBeVisible();
    await expect.element(screen.getByText('1 langganan tanpa kurs pada akhir periode.')).toBeVisible();
    await expect
      .element(screen.getByText('USD tidak dihitung karena tidak ada kurs pada akhir periode.'))
      .toBeVisible();
  });

  it('names the uncategorized line when it runs over', async () => {
    const line = FINAL_VIEW.sections.categories[2] as (typeof FINAL_VIEW.sections.categories)[number];
    const uncategorized = {
      ...FINAL_VIEW,
      sections: { ...FINAL_VIEW.sections, categories: [{ ...line, overMinor: 50_000n, name: null }] },
    } satisfies ReportView;
    const { screen } = await renderApp(<NotesSection view={uncategorized} locale="id" />);
    await expect.element(screen.getByText('Tanpa kategori lewat Rp50.000')).toBeVisible();
  });

  it('renders nothing for a clean report', async () => {
    const clean = {
      ...FINAL_VIEW,
      sections: {
        ...FINAL_VIEW.sections,
        categories: [],
        subscriptions: { ...FINAL_VIEW.sections.subscriptions, unconverted: 0 },
        netWorth: null,
      },
    } satisfies ReportView;
    await renderApp(<NotesSection view={clean} locale="id" />);
    expect(document.querySelectorAll('section').length).toBe(0);
  });

  it('uses the English copy', async () => {
    const { screen } = await renderApp(<NotesSection view={FINAL_VIEW} locale="en" />, {
      preferences: { locale: 'en' },
    });
    await expect.element(screen.getByText('Notes for the next period')).toBeVisible();
    await expect.element(screen.getByText('USD are excluded because no rate covers the period end.')).toBeVisible();
  });
});
