// Campus datasets: one folder per dataset in ../datasets (repo root), served by server/datasetsApi.ts.

/** datasets/<id>/dataset.json */
export interface DatasetMeta {
  id: string;
  title: string;
  description: string;
  /** Character shown in the map pins. */
  glyph: string;
  color: string;
  /** The server runs the fetcher again when its last result is older than this. */
  ttlSeconds: number;
  /** Shown on the map when the page is opened for the first time. */
  defaultOn: boolean;
  /** How far the source can show another time than now (missing: live only). */
  time?: DatasetTime;
}

/** full: any time; partial: some times or some parts (see the note); live: always now. */
export type TimeSupport = 'full' | 'partial' | 'live';

export interface DatasetTime {
  support: TimeSupport;
  /** Times within one of these give the same data, so they share a request. */
  resolution?: 'day' | 'hour' | 'minute';
  /** What works and what doesn't, shown to the user. */
  note: string;
}

export interface DatasetItem<D = Record<string, unknown>> {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** The position is only known to building level or roughly. */
  approximate: boolean;
  category: string;
  campus: string | null;
  subtitle: string | null;
  url: string | null;
  details: D;
}

/** What datasets/<id>/fetch.py prints. */
export interface DatasetDocument<D = Record<string, unknown>> {
  dataset: string;
  fetchedAt: string;
  /** The Zurich time the data is for (fetch.py --at); null or missing: when it was fetched. */
  at?: string | null;
  sources: string[];
  /** Live parts that could not be loaded; the items are still there (from the checked-in locations). */
  errors: string[];
  items: DatasetItem<D>[];
}

export interface DatasetResponse<D = Record<string, unknown>> {
  meta: DatasetMeta;
  document: DatasetDocument<D>;
  /** The time asked for, YYYY-MM-DDTHH:MM (Zurich); null: now (also for live-only datasets asked for a time). */
  at: string | null;
  ageSeconds: number;
  /** A fetch is running; the next request will have newer data. */
  refreshing: boolean;
  /** The last run of the fetcher failed (the document is older data). */
  lastError: string | null;
}

// ---- dataset-specific details ----

export interface Meal {
  line: string | null;
  name: string;
  description: string;
  prices: { group: string | null; price: number | string | null }[];
  tags: string[];
  allergens: string[];
}

/** The mensa's PolyMaps rooms, from datasets/mensa/rooms.json (kept apart from the workspaces). */
export interface MensaPlace {
  /** Main room as ETH lists it, e.g. "MM B 79". */
  room: string;
  facilityId: string;
  levelId: string;
  /** Floor of the main room (0 = ground floor). */
  floor: number;
  /** PolyMaps unit ids, main room first. */
  rooms: string[];
  levels: string[];
}

export interface MensaDetails {
  provider: 'eth' | 'uzh';
  building: string | null;
  /** null: not located in PolyMaps (UZH, buildings without plans). Missing in documents fetched before rooms.json. */
  place?: MensaPlace | null;
  date: string;
  mealTimes: { name: string; from: string; to: string }[];
  /** null: the menu could not be loaded. */
  menus: { name: string | null; from: string | null; to: string | null; meals: Meal[] }[] | null;
  hours: { from: string | null; to: string | null }[] | null;
}

export interface Departure {
  time: string | null;
  expected: string | null;
  delay: number | null;
  platform: string | null;
  category: string | null;
  line: string | null;
  to: string | null;
}

export interface TransportDetails {
  kind: 'tram' | 'bus' | 'train' | 'shuttle';
  note: string | null;
  departures: Departure[] | null;
}

export interface Lesson {
  title: string | null;
  sport: string | null;
  from: string | null;
  to: string | null;
  facility: string | null;
  room: string | null;
  level: string | null;
  free: number | null;
  total: number | null;
  cancelled: boolean;
  url: string | null;
}

export interface AsvzDetails {
  lessons: Lesson[] | null;
}

export interface MobilityDetails {
  provider: string;
  vehicleTypes: string[];
  stationBased: boolean;
  available: boolean | null;
  count: number | null;
  docksAvailable: number | null;
  range: number | null;
}

export interface WeatherDetails {
  current: {
    temperature_2m?: number;
    apparent_temperature?: number;
    precipitation?: number;
    wind_speed_10m?: number;
    relative_humidity_2m?: number;
    weather_code?: number;
    text: string;
  } | null;
  hourly: { time: string; temp: number | null; precipProb: number | null; precip: number | null; code: number | null; text: string }[] | null;
}

export interface AmenityDetails {
  categoryLabel: string;
  tags: Record<string, string>;
}
