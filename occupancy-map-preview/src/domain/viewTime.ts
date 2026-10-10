import { zurichClock } from './ethRooms';
import type { DatasetMeta } from '../datasets/types';

// The time the map shows: now, or a date and time picked by the user. Always
// Zurich wall time, where room bookings, menus and timetables are given.

export interface ZurichTime {
  /** YYYY-MM-DD */
  date: string;
  /** Minutes after midnight. */
  minute: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The instant (ms since epoch) of a Zurich wall time. */
export function zurichInstant({ date, minute }: ZurichTime): number {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, Math.floor(minute / 60), minute % 60);
  // Start from CET and correct by what Zurich's clock shows then (twice, for DST).
  let t = wall - 3_600_000;
  for (let i = 0; i < 2; i++) {
    const shown = zurichClock(new Date(t));
    const [sy, sm, sd] = shown.date.split('-').map(Number);
    t += wall - Date.UTC(sy, sm - 1, sd, Math.floor(shown.minute / 60), shown.minute % 60);
  }
  return t;
}

/** 0 = Sunday, like Date.getDay(). */
export const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** "YYYY-MM-DDTHH:MM", the form fetch.py --at and <input type="datetime-local"> use. */
export const isoMinute = ({ date, minute }: ZurichTime) => `${date}T${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const yearFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** "Tue 20 Oct" (with the year when it isn't `today`'s), "Today", "Tomorrow", "Yesterday". */
export function dayLabel(date: string, today: string) {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  if (date === addDays(today, -1)) return 'Yesterday';
  const d = new Date(`${date}T12:00:00Z`);
  return (date.slice(0, 4) === today.slice(0, 4) ? dayFmt : yearFmt).format(d);
}

/**
 * The time to ask a dataset for, rounded to what makes a difference to its
 * source, or null for now: live-only sources, and times that round to the same
 * as now (no need to fetch the same data twice).
 */
export function datasetAt(meta: DatasetMeta, view: ZurichTime | null, now: ZurichTime): string | null {
  const time = meta.time;
  if (!view || !time || time.support === 'live') return null;
  const round = (t: ZurichTime): ZurichTime => {
    switch (time.resolution) {
      case 'day':
        return { date: t.date, minute: 0 };
      case 'hour':
        return { date: t.date, minute: t.minute - (t.minute % 60) };
      default:
        return { date: t.date, minute: t.minute - (t.minute % 15) };
    }
  };
  const at = isoMinute(round(view));
  return at === isoMinute(round(now)) ? null : at;
}
