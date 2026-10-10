import type { DayKey, OpeningHours, TimeRange } from './types';
import { DAY_KEYS } from './types';

export const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

export const emptyHours = (): OpeningHours => ({ mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] });

export const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** Day of the given date as a DayKey (JS counts Sunday as 0). */
export const dayOf = (d: Date): DayKey => DAY_KEYS[(d.getDay() + 6) % 7];
export const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** Whether the workspace is open for the whole span [from, to] (minutes) on that day. */
export function isOpenDuring(hours: OpeningHours, day: DayKey, from: number, to: number = from): boolean {
  return hours[day].some((r) => toMinutes(r.from) <= from && to <= toMinutes(r.to));
}

const sortedRanges = (ranges: TimeRange[]) => [...ranges].sort((a, b) => toMinutes(a.from) - toMinutes(b.from));

export const formatRanges = (ranges: TimeRange[]) =>
  ranges.length ? sortedRanges(ranges).map((r) => `${r.from}–${r.to}`).join(', ') : 'closed';

/** Groups consecutive days with identical hours: [["Mon–Fri", "08:00–22:00"], ["Sat", "closed"], ...]. */
export function summarizeHours(hours: OpeningHours): { days: DayKey[]; label: string; text: string }[] {
  const out: { days: DayKey[]; text: string }[] = [];
  for (const day of DAY_KEYS) {
    const text = formatRanges(hours[day]);
    const last = out[out.length - 1];
    if (last && last.text === text) last.days.push(day);
    else out.push({ days: [day], text });
  }
  return out.map(({ days, text }) => ({
    days,
    text,
    label: days.length === 1 ? DAY_LABELS[days[0]] : `${DAY_LABELS[days[0]]}–${DAY_LABELS[days[days.length - 1]]}`,
  }));
}
