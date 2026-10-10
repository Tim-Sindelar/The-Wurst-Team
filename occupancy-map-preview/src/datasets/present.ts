import type { DatasetItem, DatasetMeta, MensaDetails, MobilityDetails, TransportDetails, WeatherDetails } from './types';

// How dataset items look on the map: glyph, small badge, dimmed when closed.

const CATEGORY_GLYPHS: Record<string, string> = {
  // transport
  tram: '🚋',
  bus: '🚌',
  train: '🚆',
  shuttle: '🚐',
  // shared mobility
  Bike: '🚲',
  'E-Bike': '🚲',
  'E-Scooter': '🛴',
  'E-Moped': '🛵',
  Car: '🚗',
  'E-Car': '🚗',
  // amenities
  water: '🚰',
  toilets: '🚻',
  microwave: '♨',
  supermarket: '🛒',
  cafe: '☕',
  atm: '🏧',
  pharmacy: '💊',
  post: '✉',
  copyshop: '🖨',
  books: '📚',
  aed: '❤',
  'bike-repair': '🔧',
};

export const glyphOf = (meta: DatasetMeta, item: DatasetItem) => CATEGORY_GLYPHS[item.category] ?? meta.glyph;

export const toMinute = (hhmm: string | null | undefined) => {
  const m = /^(\d{1,2})[:.](\d{2})/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Is a mensa serving at this minute of the day (by its meal times; weekends count as closed)? */
export function mensaOpenAt(d: MensaDetails, minute: number, weekday: number): boolean {
  if (weekday === 0 || weekday === 6) return false;
  return d.mealTimes.some((t) => {
    const from = toMinute(t.from);
    const to = toMinute(t.to);
    return from !== null && to !== null && from <= minute && minute < to;
  });
}

/** Minutes until a departure, from its ISO time (the expected one if known). */
export function minutesUntil(iso: string | null, now = Date.now()) {
  if (!iso) return null;
  const t = Date.parse(iso.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(t) ? null : Math.round((t - now) / 60_000);
}

export interface PinLook {
  glyph: string;
  badge: string | null;
  dimmed: boolean;
  small: boolean;
}

export function pinLook(meta: DatasetMeta, item: DatasetItem, clock: { minute: number; weekday: number }): PinLook {
  const look: PinLook = { glyph: glyphOf(meta, item), badge: null, dimmed: false, small: false };
  switch (meta.id) {
    case 'weather': {
      const t = (item.details as unknown as WeatherDetails).current?.temperature_2m;
      if (t != null) look.badge = `${Math.round(t)}°`;
      break;
    }
    case 'mensa': {
      const d = item.details as unknown as MensaDetails;
      look.dimmed = !mensaOpenAt(d, clock.minute, clock.weekday);
      const meals = d.menus?.reduce((n, m) => n + m.meals.length, 0);
      if (meals) look.badge = String(meals);
      break;
    }
    case 'transport': {
      const d = item.details as unknown as TransportDetails;
      const next = d.departures?.map((x) => minutesUntil(x.expected ?? x.time)).find((m) => m !== null && m >= 0);
      if (next != null) look.badge = `${next}′`;
      break;
    }
    case 'shared-mobility': {
      const d = item.details as unknown as MobilityDetails;
      look.small = !d.stationBased;
      if (d.stationBased && d.count != null) {
        look.badge = String(d.count);
        look.dimmed = d.count === 0;
      }
      break;
    }
    case 'amenities':
      look.small = true;
      break;
  }
  return look;
}
