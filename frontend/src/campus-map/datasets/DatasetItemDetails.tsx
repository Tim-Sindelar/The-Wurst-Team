import { Fragment } from 'react';
import type {
  AmenityDetails,
  AsvzDetails,
  DatasetItem,
  DatasetMeta,
  Departure,
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

/** The popup of a campus data pin: what the item is and its live details. */
export function DatasetItemDetails({
  meta,
  item,
  clock,
  onClose,
}: {
  meta: DatasetMeta;
  item: DatasetItem;
  clock: Clock;
  /** Shows a close button that clears the selection. */
  onClose?: () => void;
}) {
  return (
    <section className="panel-section ds-details">
      <div className="section-head">
        <div>
          <h2>
            <span className="ds-swatch" style={{ background: meta.color }}>
              {glyphOf(meta, item)}
            </span>{' '}
            {item.name}
          </h2>
          {item.subtitle && <p className="note">{item.subtitle}</p>}
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
        {onClose && (
          <button className="btn-icon" aria-label="Close" onClick={onClose}>
            ×
          </button>
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
        <AsvzView d={item.details as unknown as AsvzDetails} />
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
        <p className="note">
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
  return (
    <>
      <p className="note">
        <i className={`status-dot ${open ? 'is-open' : 'is-closed'}`} />{' '}
        {open ? 'Serving' : 'Not serving'}{' '}
        {clock.live ? 'now' : `at ${clock.label}`} ·{' '}
        {d.mealTimes.map((t) => `${t.name} ${t.from}–${t.to}`).join(', ')}
        {d.building ? ` · ${d.building}` : ''}
      </p>
      {d.menus === null && (
        <p className="note error-text">
          The menu of {d.date} could not be loaded.
        </p>
      )}
      {d.menus?.length === 0 && (
        <p className="note">No menu published for {d.date}.</p>
      )}
      {d.menus?.map((m, i) => (
        <div key={i} className="ds-menu">
          <h3>
            {m.name ?? 'Menu'}{' '}
            {m.from && (
              <span className="muted">
                {m.from}–{m.to}
              </span>
            )}
          </h3>
          {m.meals.length === 0 && <p className="note">Nothing listed.</p>}
          {m.meals.map((meal, j) => (
            <div key={j} className="ds-meal">
              <div className="ds-meal-head">
                <span>
                  {meal.line && <span className="ds-line">{meal.line}</span>}{' '}
                  <strong>{meal.name}</strong>
                </span>
                {meal.prices[0]?.price != null && (
                  <span className="ds-price">
                    {formatPrice(meal.prices[0].price)}
                  </span>
                )}
              </div>
              {meal.description && <p className="note">{meal.description}</p>}
              <p className="note">
                {meal.prices
                  .map((p) => `${p.group ?? ''} ${formatPrice(p.price)}`.trim())
                  .join(' · ')}
                {meal.tags.length > 0 && ` · ${meal.tags.join(', ')}`}
              </p>
              {meal.allergens.length > 0 && (
                <p className="note ds-allergens">
                  Allergens: {meal.allergens.join(', ')}
                </p>
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

const formatPrice = (p: number | string | null) => {
  const n = typeof p === 'string' ? Number(p) : p;
  return n == null || Number.isNaN(n) ? '' : `CHF ${n.toFixed(2)}`;
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

function AsvzView({ d }: { d: AsvzDetails }) {
  if (!d.lessons)
    return <p className="note error-text">ASVZ lessons could not be loaded.</p>;
  if (!d.lessons.length)
    return <p className="note">No upcoming lessons listed here.</p>;
  let lastDay = '';
  return (
    <ul className="ds-lessons">
      {d.lessons.map((l, i) => {
        const day = l.from ? dayFmt.format(parseIso(l.from)) : '';
        const head = day !== lastDay ? day : null;
        lastDay = day;
        return (
          <Fragment key={i}>
            {head && <li className="ds-day">{head}</li>}
            <li className={l.cancelled ? 'is-cancelled' : ''}>
              <span className="num">
                {clockTime(l.from)}–{clockTime(l.to)}
              </span>{' '}
              {l.url ? (
                <a href={l.url} target="_blank" rel="noreferrer">
                  {l.title}
                </a>
              ) : (
                l.title
              )}
              <span className="muted">
                {l.level ? ` · ${l.level}` : ''}
                {l.room ? ` · ${l.room}` : ''}
                {l.free != null
                  ? ` · ${l.free}${l.total != null ? `/${l.total}` : ''} free`
                  : ''}
                {l.cancelled ? ' · cancelled' : ''}
              </span>
            </li>
          </Fragment>
        );
      })}
    </ul>
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
