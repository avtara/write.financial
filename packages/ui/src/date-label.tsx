// SPDX-License-Identifier: AGPL-3.0-only
import type { Locale } from '@wf/domain/money';
import { addDays, type LocalDate } from '@wf/domain/period';
import { formatDate, formatTime, toLocalDate, type DateFormat } from './dates.ts';

/** Shows "Hari ini" / "Kemarin" instead of the date for today and yesterday (seen from `today`). */
export interface RelativeDayLabels {
  readonly today: LocalDate;
  readonly todayLabel: string;
  readonly yesterdayLabel: string;
}

interface CommonProps {
  locale: Locale;
  /** Default `date` (`15 Okt 2026`); see {@link DateFormat}. */
  format?: DateFormat;
  relative?: RelativeDayLabels;
  className?: string;
}

/** A calendar date (transaction dates, period bounds). */
interface CalendarDateProps extends CommonProps {
  date: LocalDate;
}

/** An instant (a timestamp), shown with its 24-hour time in the user's time zone: `15 Okt 2026, 19.30`. */
interface InstantProps extends CommonProps {
  instant: Date;
  timeZone: string;
}

export type DateLabelProps = CalendarDateProps | InstantProps;

/**
 * The one way dates reach the screen (plan §7): a `<time>` element whose text follows the locale (`Kamis, 15 Okt`,
 * `Thursday, Oct 15`) and whose `dateTime` is machine-readable.
 */
export function DateLabel(props: DateLabelProps) {
  const { locale, format = 'date', relative, className = '' } = props;
  const date = 'date' in props ? props.date : toLocalDate(props.instant, props.timeZone);
  let text = formatDate(date, locale, format);
  if (relative !== undefined && date === relative.today) text = relative.todayLabel;
  if (relative !== undefined && date === addDays(relative.today, -1)) text = relative.yesterdayLabel;
  return 'date' in props ? (
    <time dateTime={date} className={className}>
      {text}
    </time>
  ) : (
    <time dateTime={props.instant.toISOString()} className={className}>
      {`${text}, ${formatTime(props.instant, props.timeZone, locale)}`}
    </time>
  );
}
