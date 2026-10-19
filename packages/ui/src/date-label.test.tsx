// SPDX-License-Identifier: AGPL-3.0-only
import { parseLocalDate as d } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { DateLabel } from './date-label.tsx';

const relative = { today: d('2026-10-15'), todayLabel: 'Hari ini', yesterdayLabel: 'Kemarin' };

describe('DateLabel', () => {
  it('renders a calendar date as <time> in the requested format', async () => {
    const screen = await render(<DateLabel date={d('2026-10-15')} locale="id" format="weekday" className="extra" />);
    const time = screen.container.querySelector('time');
    expect(time?.textContent).toBe('Kamis, 15 Okt');
    expect(time?.dateTime).toBe('2026-10-15');
    expect(time?.className).toBe('extra');
  });

  it('defaults to the date with its year', async () => {
    const screen = await render(<DateLabel date={d('2026-10-15')} locale="en" />);
    await expect.element(screen.getByText('Oct 15, 2026')).toBeVisible();
  });

  it('names today and yesterday, and dates further back as usual', async () => {
    const screen = await render(
      <>
        <DateLabel date={d('2026-10-15')} locale="id" relative={relative} />
        <DateLabel date={d('2026-10-14')} locale="id" relative={relative} />
        <DateLabel date={d('2026-10-13')} locale="id" format="day" relative={relative} />
      </>,
    );
    expect([...screen.container.querySelectorAll('time')].map((time) => time.textContent)).toEqual([
      'Hari ini',
      'Kemarin',
      '13 Okt',
    ]);
  });

  it('shows an instant with its time in the given time zone', async () => {
    // 15 Oct 2026 18:30 UTC is 16 Oct 01.30 in Jakarta.
    const instant = new Date(Date.UTC(2026, 9, 15, 18, 30));
    const screen = await render(
      <>
        <DateLabel instant={instant} timeZone="Asia/Jakarta" locale="id" />
        <DateLabel
          instant={instant}
          timeZone="Asia/Jakarta"
          locale="id"
          relative={{ ...relative, today: d('2026-10-16') }}
        />
      </>,
    );
    const times = [...screen.container.querySelectorAll('time')];
    expect(times.map((time) => time.textContent)).toEqual(['16 Okt 2026, 01.30', 'Hari ini, 01.30']);
    expect(times[0]?.dateTime).toBe('2026-10-15T18:30:00.000Z');
  });
});
