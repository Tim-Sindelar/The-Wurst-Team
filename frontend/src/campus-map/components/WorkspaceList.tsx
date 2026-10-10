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
  toMinutes,
} from '../domain/hours';
import { occupancyOf } from '../domain/operations';
import { OccupancyBar } from './OccupancyBar';
import { libraryFloorLabel, type LevelInfo } from '../floors/floorData';

interface Props {
  data: OccupancyData;
  selectedId: string | null;
  /** The floor plan levels, for the floor letters; empty while loading. */
  levels: LevelInfo[];
  onSelectLibrary: (lib: Library) => void;
}

/** The workspace search of the map's bottom menu: name search, filters and the matching workspaces. */
export function WorkspaceList({
  data,
  selectedId,
  levels,
  onSelectLibrary,
}: Props) {
  const [query, setQuery] = useState('');
  const [campus, setCampus] = useState<Campus | 'all'>('all');
  const [kind, setKind] = useState<WorkspaceKind | 'all'>('all');
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

  const q = query.trim().toLowerCase();
  const libraries = data.libraries.filter(
    (l) =>
      (!q ||
        `${l.name} ${l.address ?? ''} ${l.campus}`.toLowerCase().includes(q)) &&
      (campus === 'all' || l.campus === campus) &&
      (kind === 'all' || l.kind === kind) &&
      matchesTime(l),
  );
  const kinds = WORKSPACE_KINDS.filter((k) =>
    data.libraries.some((l) => l.kind === k),
  );

  return (
    <section className="panel-section">
      <input
        type="search"
        className="workspace-search"
        placeholder="Search workspaces"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search workspaces"
      />
      <div className="section-head">
        <h2>
          Workspaces <span className="muted">({libraries.length})</span>
        </h2>
        <div className="icon-actions">
          {kinds.length > 1 && (
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as WorkspaceKind | 'all')}
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
      {libraries.length === 0 && <p className="muted">No workspace matches.</p>}
      <ul className="list">
        {libraries.map((lib) => {
          const occ = occupancyOf(data, lib.id);
          return (
            <li key={lib.id}>
              <button
                className={`list-item${lib.id === selectedId ? ' is-active' : ''}`}
                onClick={() => onSelectLibrary(lib)}
              >
                <span className="list-title">{lib.name}</span>
                <span className="list-meta">
                  {lib.kind !== 'library' &&
                    `${WORKSPACE_KIND_LABELS[lib.kind]} · `}
                  {lib.campus}
                  {lib.floor !== null &&
                    ` · ${libraryFloorLabel({ floor: lib.floor, levelId: lib.levelId, facilityId: lib.facilityId }, levels)}`}
                </span>
                <OccupancyBar free={occ.free} total={occ.total} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
