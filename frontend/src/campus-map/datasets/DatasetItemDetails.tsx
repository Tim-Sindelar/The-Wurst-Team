import { Fragment } from 'react';
import type {
  AmenityDetails,
  AsvzDetails,
  DatasetItem,
  DatasetMeta,
  Departure,
  Lesson,
  MensaDetails,
  MobilityDetails,
  TransportDetails,
  WeatherDetails,
} from './types';
import {
  glyphOf,
  mensaOpenAt,
  minutesUntil,
  showsNowOnly,
  type Clock,
} from './present';

const timeFmt = new Intl.DateTimeFormat('de-CH', {
  timeZone: 'Europe/Zurich',
  hour: '2-digit',
  minute: '2-digit',
});
const dayFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Zurich',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const parseIso = (iso: string) =>
  new Date(iso.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
const clockTime = (iso: string | null) =>
  iso ? timeFmt.format(parseIso(iso)) : '–';

/**
 * The popup of a campus data pin: what the item is and its live details. The
 * sheet around it already names the item; `nested` (a mensa shown inside a
 * workspace popup) names it again as a section heading.
 */
export function DatasetItemDetails({
  meta,
  item,
  clock,
  nested = false,
}: {
  meta: DatasetMeta;
  item: DatasetItem;
  clock: Clock;
  nested?: boolean;
}) {
  return (
    <section className="panel-section ds-details">
      <div className="ds-head">
        {nested ? (
          <h2>
            <span className="ds-swatch" style={{ background: meta.color }}>
              {glyphOf(meta, item)}
            </span>
            {item.name}
          </h2>
        ) : (
          <p className="ds-kind">
            <span className="ds-swatch" style={{ background: meta.color }}>
              {glyphOf(meta, item)}
            </span>
            {meta.title}
          </p>
        )}
        {/* A mensa's subtitle (room, meal times) is in its view already. */}
        {item.subtitle && meta.id !== 'mensa' && (
          <p className="note">{item.subtitle}</p>
        )}
        {item.approximate && (
          <p className="note">Position on the map is approximate.</p>
        )}
        {showsNowOnly(meta, clock) && (
          <p className="note error-text">
            Live data only: this is now, not {clock.label}.
          </p>
        )}
        {!clock.live && meta.time?.support === 'partial' && (
          <p className="note">
            At {clock.label}. {meta.time.note}
          </p>
        )}
      </div>
      {meta.id === 'mensa' && (
        <MensaView d={item.details as unknown as MensaDetails} clock={clock} />
      )}
      {meta.id === 'transport' && (
        <TransportView
          d={item.details as unknown as TransportDetails}
          clock={clock}
        />
      )}
      {meta.id === 'asvz' && (
        <AsvzView
          d={item.details as unknown as AsvzDetails}
          place={item.name}
          clock={clock}
        />
      )}
      {meta.id === 'shared-mobility' && (
        <MobilityView d={item.details as unknown as MobilityDetails} />
      )}
      {meta.id === 'weather' && (
        <WeatherView d={item.details as unknown as WeatherDetails} />
      )}
      {meta.id === 'amenities' && (
        <AmenityView d={item.details as unknown as AmenityDetails} />
      )}
      {![
        'mensa',
        'transport',
        'asvz',
        'shared-mobility',
        'weather',
        'amenities',
      ].includes(meta.id) && <GenericView d={item.details} />}
      {item.url && (
        <p className="note ds-more">
          <a href={item.url} target="_blank" rel="noreferrer">
            More information ↗
          </a>
        </p>
      )}
    </section>
  );
}

function MensaView({ d, clock }: { d: MensaDetails; clock: Clock }) {
  const open = mensaOpenAt(d, clock.minute, clock.weekday);
  const menus = d.menus?.filter((m) => m.meals.length > 0) ?? null;
  const date = dayFmt.format(parseIso(`${d.date}T12:00:00Z`));
  return (
    <>
      <p className="ds-status">
        <i className={`status-dot ${open ? 'is-open' : 'is-closed'}`} />
        <strong>{open ? 'Serving' : 'Not serving'}</strong>{' '}
        <span className="muted">
          {clock.live ? 'now' : `at ${clock.label}`}
        </span>
      </p>
      {/* The menu tables name their own meal times. */}
      {((!menus?.length && d.mealTimes.length > 0) || d.building) && (
        <dl className="ds-dl">
          {!menus?.length &&
            d.mealTimes.map((t) => (
              <Fragment key={t.name}>
                <dt>{t.name}</dt>
                <dd className="num">
                  {t.from}–{t.to}
                </dd>
              </Fragment>
            ))}
          {d.building && (
            <>
              <dt>Building</dt>
              <dd>{d.building}</dd>
            </>
          )}
        </dl>
      )}
      {menus === null && (
        <p className="note error-text">
          The menu of {date} could not be loaded.
        </p>
      )}
      {menus?.length === 0 && (
        <p className="note">No menu published for {date}.</p>
      )}
      {menus?.map((m, i) => (
        <MenuTable key={i} menu={m} />
      ))}
    </>
  );
}

type Menu = NonNullable<MensaDetails['menus']>[number];

/** One meal time's dishes, with a price column per customer group. */
function MenuTable({ menu }: { menu: Menu }) {
  const groups = [
    ...new Set(menu.meals.flatMap((m) => m.prices.map((p) => p.group ?? ''))),
  ];
  return (
    <table className="ds-table ds-menu-table">
      <caption>
        {menu.name ?? 'Menu'}
        {menu.from && (
          <span className="muted num">
            {' '}
            {menu.from}–{menu.to}
          </span>
        )}
      </caption>
      <thead>
        <tr>
          <th scope="col">Dish</th>
          {groups.map((g) => (
            <th key={g} scope="col" className="num">
              {g || 'Price'}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {menu.meals.map((meal, j) => (
          <tr key={j}>
            <td>
              {(meal.line || meal.tags.length > 0) && (
                <div className="ds-dish-tags">
                  {meal.line && <span className="ds-line">{meal.line}</span>}
                  {meal.tags.map((t) => (
                    <span key={t} className="ds-tag">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <strong className="ds-dish">{meal.name}</strong>
              {meal.description && (
                <p className="note">
                  {meal.description.split(' | ').join(' · ')}
                </p>
              )}
              {meal.allergens.length > 0 && (
                <p className="note ds-allergens">
                  Allergens: {meal.allergens.join(', ')}
                </p>
              )}
            </td>
            {groups.map((g) => (
              <td key={g} className="num">
                {formatPrice(
                  meal.prices.find((p) => (p.group ?? '') === g)?.price ?? null,
                ) || '–'}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {groups.length > 0 && (
        <tfoot>
          <tr>
            <td colSpan={groups.length + 1} className="note">
              Prices in CHF
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

const formatPrice = (p: number | string | null) => {
  const n = typeof p === 'string' ? Number(p) : p;
  return n == null || Number.isNaN(n) ? '' : n.toFixed(2);
};

function TransportView({ d, clock }: { d: TransportDetails; clock: Clock }) {
  if (d.kind === 'shuttle') return <p className="note">{d.note}</p>;
  if (!d.departures)
    return <p className="note error-text">Departures could not be loaded.</p>;
  const now = clock.ms;
  const upcoming = d.departures.filter(
    (x) => (minutesUntil(x.expected ?? x.time, now) ?? 0) >= -1,
  );
  if (!upcoming.length) return <p className="note">No departures listed.</p>;
  return (
    <table className="ds-table">
      <tbody>
        {upcoming.map((x, i) => (
          <DepartureRow key={i} x={x} now={now} />
        ))}
      </tbody>
    </table>
  );
}

function DepartureRow({ x, now }: { x: Departure; now: number }) {
  const inMin = minutesUntil(x.expected ?? x.time, now);
  return (
    <tr>
      <td>
        <span className="ds-line">{x.line}</span>
      </td>
      <td>{x.to}</td>
      <td className="num">
        {clockTime(x.time)}
        {x.delay ? <span className="error-text"> +{x.delay}</span> : null}
      </td>
      <td className="num muted">
        {inMin != null ? (inMin <= 0 ? 'now' : `${inMin}′`) : ''}
      </td>
      <td className="num muted">{x.platform ?? ''}</td>
    </tr>
  );
}

/** ASVZ writes the levels in German ("Einsteiger 2 + Mittlere"); "Alle" is every level. */
const LEVEL_WORDS: Record<string, string> = {
  Einsteiger: 'Beginner',
  Mittlere: 'Intermediate',
  Fortgeschrittene: 'Advanced',
  Wettkämpfer: 'Competitive',
};
const levelLabel = (level: string | null) =>
  !level
    ? null
    : level === 'Alle'
      ? 'All levels'
      : level.replace(/\p{L}+/gu, (w) => LEVEL_WORDS[w] ?? w);

function AsvzView({
  d,
  place,
  clock,
}: {
  d: AsvzDetails;
  /** The sport center, left out of the lesson rows when they repeat it. */
  place: string;
  clock: Clock;
}) {
  if (!d.lessons)
    return <p className="note error-text">ASVZ lessons could not be loaded.</p>;
  // The source starts at the hour asked for: drop what is already over.
  const lessons = d.lessons.filter(
    (l) => !l.to || parseIso(l.to).getTime() > clock.ms,
  );
  if (!lessons.length)
    return <p className="note">No upcoming lessons listed here.</p>;
  const days: [string, Lesson[]][] = [];
  for (const l of lessons) {
    const day = l.from ? dayFmt.format(parseIso(l.from)) : 'Date unknown';
    const last = days.at(-1);
    if (last?.[0] === day) last[1].push(l);
    else days.push([day, [l]]);
  }
  return (
    <table className="ds-table ds-lesson-table">
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Lesson</th>
          <th scope="col" className="num">
            Places
          </th>
        </tr>
      </thead>
      {days.map(([day, rows]) => (
        <tbody key={day}>
          <tr className="ds-day-row">
            <th scope="colgroup" colSpan={3}>
              {day}
            </th>
          </tr>
          {rows.map((l, i) => (
            <LessonRow key={i} l={l} place={place} now={clock.ms} />
          ))}
        </tbody>
      ))}
    </table>
  );
}

function LessonRow({
  l,
  place,
  now,
}: {
  l: Lesson;
  place: string;
  now: number;
}) {
  const running =
    !l.cancelled &&
    !!l.from &&
    !!l.to &&
    parseIso(l.from).getTime() <= now &&
    now < parseIso(l.to).getTime();
  const title = l.title ?? l.sport ?? 'Lesson';
  const extra = [
    l.sport && l.sport !== title ? l.sport : null,
    levelLabel(l.level),
    l.room && l.room !== place && l.room !== l.facility ? l.room : null,
  ].filter(Boolean);
  return (
    <tr className={l.cancelled ? 'is-cancelled' : undefined}>
      <td className="num">
        {clockTime(l.from)}
        <span className="muted ds-until">–{clockTime(l.to)}</span>
      </td>
      <td>
        {l.url ? (
          <a
            className="ds-lesson-title"
            href={l.url}
            target="_blank"
            rel="noreferrer"
          >
            {title}
          </a>
        ) : (
          <strong className="ds-lesson-title">{title}</strong>
        )}
        {(extra.length > 0 || running) && (
          <p className="note">
            {running && <span className="ds-now">Now</span>}
            {extra.join(' · ')}
          </p>
        )}
      </td>
      <td className="num">
        <Places l={l} />
      </td>
    </tr>
  );
}

/** Free places as words and a dot, never by colour alone. */
function Places({ l }: { l: Lesson }) {
  if (l.cancelled) return <span className="ds-places">Cancelled</span>;
  if (l.free == null)
    return (
      <span className="muted">
        {l.total != null ? `${l.total} places` : '–'}
      </span>
    );
  const level =
    l.free === 0
      ? 'is-full'
      : l.total && l.free / l.total < 0.2
        ? 'is-few'
        : 'is-free';
  return (
    <span className={`ds-places ${level}`}>
      <span className="ds-places-main">
        <i aria-hidden="true" />
        {l.free === 0 ? 'Full' : `${l.free} free`}
      </span>
      {l.total != null && <span className="ds-of muted">of {l.total}</span>}
    </span>
  );
}

function MobilityView({ d }: { d: MobilityDetails }) {
  return (
    <dl className="ds-dl">
      <dt>Provider</dt>
      <dd>{d.provider}</dd>
      <dt>Vehicles</dt>
      <dd>{d.vehicleTypes.join(', ') || '–'}</dd>
      {d.stationBased ? (
        <>
          <dt>Available</dt>
          <dd>{d.count ?? '–'}</dd>
          {d.docksAvailable != null && (
            <>
              <dt>Free docks</dt>
              <dd>{d.docksAvailable}</dd>
            </>
          )}
        </>
      ) : (
        <>
          <dt>Status</dt>
          <dd>{d.available === false ? 'In use' : 'Available'}</dd>
        </>
      )}
      {d.range != null && (
        <>
          <dt>Range</dt>
          <dd>{(d.range / 1000).toFixed(1)} km</dd>
        </>
      )}
    </dl>
  );
}

function WeatherView({ d }: { d: WeatherDetails }) {
  if (!d.current)
    return <p className="note error-text">Weather could not be loaded.</p>;
  const c = d.current;
  return (
    <>
      <p className="ds-weather-now">
        <strong>
          {c.temperature_2m != null ? `${Math.round(c.temperature_2m)}°C` : '–'}
        </strong>{' '}
        {c.text}
      </p>
      <p className="note">
        {c.apparent_temperature != null &&
          `Feels like ${Math.round(c.apparent_temperature)}° · `}
        {c.wind_speed_10m != null &&
          `Wind ${Math.round(c.wind_speed_10m)} km/h · `}
        {c.relative_humidity_2m != null &&
          `Humidity ${c.relative_humidity_2m}%`}
      </p>
      {d.hourly && (
        <div className="ds-hours">
          {d.hourly.map((h) => (
            <div key={h.time} title={h.text}>
              <span className="muted">{h.time.slice(11, 16)}</span>
              <strong>{h.temp != null ? `${Math.round(h.temp)}°` : '–'}</strong>
              <span className="muted">
                {h.precipProb != null ? `${h.precipProb}%` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const TAG_LABELS: Record<string, string> = {
  opening_hours: 'Opening hours',
  operator: 'Operator',
  brand: 'Brand',
  website: 'Website',
  phone: 'Phone',
  wheelchair: 'Wheelchair',
  indoor: 'Indoor',
  level: 'Floor',
  fee: 'Fee',
  description: 'Description',
  access: 'Access',
  'addr:street': 'Street',
  'addr:housenumber': 'No.',
  check_date: 'Checked',
};

function AmenityView({ d }: { d: AmenityDetails }) {
  const tags = Object.entries(d.tags);
  return (
    <>
      <p className="note">{d.categoryLabel} · from OpenStreetMap</p>
      {tags.length > 0 && (
        <dl className="ds-dl">
          {tags.map(([k, v]) => (
            <Fragment key={k}>
              <dt>{TAG_LABELS[k] ?? k}</dt>
              <dd>
                {k === 'website' ? (
                  <a href={v} target="_blank" rel="noreferrer">
                    {v}
                  </a>
                ) : (
                  v
                )}
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
    </>
  );
}

function GenericView({ d }: { d: Record<string, unknown> }) {
  return <pre className="note ds-raw">{JSON.stringify(d, null, 1)}</pre>;
}
