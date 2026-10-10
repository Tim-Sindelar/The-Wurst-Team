import { useEffect, useState } from 'react';
import type {
  Campus,
  DayKey,
  Library,
  OccupancyData,
  WorkspaceKind,
} from '../domain/types';
import {
  CAMPUSES,
  DAY_KEYS,
  WORKSPACE_KIND_LABELS,
  WORKSPACE_KINDS,
} from '../domain/types';
import {
  DAY_LABELS,
  dayOf,
  isOpenDuring,
  minutesOf,
  summarizeHours,
  toMinutes,
} from '../domain/hours';
import { occupancyOf, seatsOfTable, tablesOf } from '../domain/operations';
import type { Selection } from '../state';
import { OccupancyBar } from './OccupancyBar';
import { libraryFloorLabel, levelName, roomName } from '../floors/floorData';

interface Props {
  data: OccupancyData;
  selection: Selection;
  onSelectLibrary: (lib: Library) => void;
  onSelectTable: (libraryId: string, tableId: string) => void;
}

export function ViewerPanel({
  data,
  selection,
  onSelectLibrary,
  onSelectTable,
}: Props) {
  const [campus, setCampus] = useState<Campus | 'all'>('all');
  const [kind, setKind] = useState<WorkspaceKind | 'all'>('all');
  const selected =
    data.libraries.find((l) => l.id === selection.libraryId) ?? null;
  const [when, setWhen] = useState<'any' | 'now' | 'custom'>('any');
  const [day, setDay] = useState<DayKey>(() => dayOf(new Date()));
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('');
  const [includeUnknown, setIncludeUnknown] = useState(true);
  // "Now" is re-evaluated every minute.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (when !== 'now') return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [when]);

  const matchesTime = (l: Library) => {
    if (when === 'any') return true;
    if (!l.openingHours) return includeUnknown;
    if (when === 'now')
      return isOpenDuring(l.openingHours, dayOf(now), minutesOf(now));
    if (!from) return true;
    const start = toMinutes(from);
    return isOpenDuring(
      l.openingHours,
      day,
      start,
      to && toMinutes(to) > start ? toMinutes(to) : start,
    );
  };

  const libraries = data.libraries.filter(
    (l) =>
      (campus === 'all' || l.campus === campus) &&
      (kind === 'all' || l.kind === kind) &&
      matchesTime(l),
  );
  const kinds = WORKSPACE_KINDS.filter((k) =>
    data.libraries.some((l) => l.kind === k),
  );

  return (
    <>
      {selected && (
        <LibraryDetails
          data={data}
          library={selected}
          selection={selection}
          onSelectTable={onSelectTable}
        />
      )}

      <section className="panel-section">
        <div className="section-head">
          <h2>Workspaces</h2>
          <div className="icon-actions">
            {kinds.length > 1 && (
              <select
                value={kind}
                onChange={(e) =>
                  setKind(e.target.value as WorkspaceKind | 'all')
                }
                aria-label="Type filter"
              >
                <option value="all">All types</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {WORKSPACE_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            )}
            <select
              value={campus}
              onChange={(e) => setCampus(e.target.value as Campus | 'all')}
              aria-label="Campus filter"
            >
              <option value="all">All campuses</option>
              {CAMPUSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="time-search">
          <div className="row">
            <select
              value={when}
              onChange={(e) => setWhen(e.target.value as typeof when)}
              aria-label="Availability"
            >
              <option value="any">Open any time</option>
              <option value="now">Open now</option>
              <option value="custom">Open at…</option>
            </select>
            {when === 'custom' && (
              <>
                <select
                  value={day}
                  onChange={(e) => setDay(e.target.value as DayKey)}
                  aria-label="Day"
                >
                  {DAY_KEYS.map((d) => (
                    <option key={d} value={d}>
                      {DAY_LABELS[d]}
                    </option>
                  ))}
                </select>
                <input
                  type="time"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  aria-label="From"
                />
                until
                <input
                  type="time"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  aria-label="Until (optional)"
                />
              </>
            )}
          </div>
          {when !== 'any' && (
            <label className="check">
              <input
                type="checkbox"
                checked={includeUnknown}
                onChange={(e) => setIncludeUnknown(e.target.checked)}
              />
              Include workspaces without published hours
            </label>
          )}
        </div>
        {libraries.length === 0 && (
          <p className="muted">No workspace matches.</p>
        )}
        <ul className="list">
          {libraries.map((lib) => {
            const occ = occupancyOf(data, lib.id);
            return (
              <li key={lib.id}>
                <button
                  className={`list-item${lib.id === selection.libraryId ? ' is-active' : ''}`}
                  onClick={() => onSelectLibrary(lib)}
                >
                  <span className="list-title">{lib.name}</span>
                  <span className="list-meta">
                    {lib.kind !== 'library' &&
                      `${WORKSPACE_KIND_LABELS[lib.kind]} · `}
                    {lib.campus}
                    {lib.floor !== null &&
                      ` · ${libraryFloorLabel({ floor: lib.floor, levelId: lib.levelId })}`}
                  </span>
                  <OccupancyBar free={occ.free} total={occ.total} />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

function LibraryDetails({
  data,
  library,
  selection,
  onSelectTable,
}: {
  data: OccupancyData;
  library: Library;
  selection: Selection;
  onSelectTable: (libraryId: string, tableId: string) => void;
}) {
  const occ = occupancyOf(data, library.id);
  const tables = tablesOf(data, library.id);
  return (
    <section className="panel-section details">
      <h2>{library.name}</h2>
      <dl>
        <dt>Type</dt>
        <dd>{WORKSPACE_KIND_LABELS[library.kind]}</dd>
        <dt>Address</dt>
        <dd>{library.address ?? 'not published'}</dd>
        {library.floor !== null && (
          <>
            <dt>Floor</dt>
            <dd>
              {libraryFloorLabel({
                floor: library.floor,
                levelId: library.levelId,
              })}
              {library.levelId && ` · ${levelName(library.levelId)}`}
            </dd>
          </>
        )}
        {library.rooms.length > 0 && (
          <>
            <dt>Rooms</dt>
            <dd>{library.rooms.map(roomName).join(', ')}</dd>
          </>
        )}
        <dt>Hours</dt>
        <dd>
          {library.openingHours ? (
            <HoursTable hours={library.openingHours} />
          ) : (
            'not published'
          )}
        </dd>
        {library.cardAccess24h && (
          <>
            <dt>Access</dt>
            <dd>24h with ETH card</dd>
          </>
        )}
        {library.availabilityNote && (
          <>
            <dt>Availability</dt>
            <dd>{library.availabilityNote}</dd>
          </>
        )}
        {library.description && (
          <>
            <dt>About</dt>
            <dd>{library.description}</dd>
          </>
        )}
      </dl>
      <OccupancyBar free={occ.free} total={occ.total} large />
      {tables.length > 0 && (
        <ul className="table-grid">
          {tables.map((t) => {
            const seats = seatsOfTable(data, t.id);
            const free = seats.filter((s) => s.status === 'free').length;
            return (
              <li key={t.id}>
                <button
                  className={`chip${t.id === selection.tableId ? ' is-active' : ''}`}
                  onClick={() => onSelectTable(library.id, t.id)}
                >
                  {t.label}{' '}
                  <span className="muted">
                    {free}/{seats.length}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {library.sourceUrl && (
        <a
          className="source"
          href={library.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          Source ↗
        </a>
      )}
    </section>
  );
}

function HoursTable({
  hours,
}: {
  hours: NonNullable<Library['openingHours']>;
}) {
  const today = dayOf(new Date());
  const open = isOpenDuring(hours, today, minutesOf(new Date()));
  return (
    <>
      <strong>{open ? 'Open now' : 'Closed now'}</strong>
      <div className="hours-table">
        {summarizeHours(hours).map((g) => (
          <HoursRow
            key={g.label}
            label={g.label}
            text={g.text}
            isToday={g.days.includes(today)}
          />
        ))}
      </div>
    </>
  );
}

function HoursRow({
  label,
  text,
  isToday,
}: {
  label: string;
  text: string;
  isToday: boolean;
}) {
  return (
    <>
      <span className={isToday ? 'today' : undefined}>{label}</span>
      <span className={isToday ? 'today' : undefined}>{text}</span>
    </>
  );
}
