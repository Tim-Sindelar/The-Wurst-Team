import { TextInput } from '@mantine/core';
import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { SectionLabel } from '../../components/SectionLabel';
import { searchByName } from '../../domain/similarity';
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
  /** What the search box says it searches ("Search study spaces"). */
  placeholder: string;
  /** Rows shown above the list before anything is typed (favourites,
      recents, most popular); empty rows are hidden. */
  suggestions: WorkspaceSuggestion[];
}

export interface WorkspaceSuggestion {
  id: string;
  title: string;
  libraries: Library[];
}

/** The workspace search of the map's bottom menu: the home screen's search
    box, suggestions before anything is typed, filters and the matching
    workspaces. */
export function WorkspaceList({
  data,
  selectedId,
  levels,
  onSelectLibrary,
  placeholder,
  suggestions,
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

  const searching = query.trim() !== '';
  // The home screen's similarity search: forgiving, best match first.
  const libraries = searchByName(
    data.libraries.filter(
      (l) =>
        (campus === 'all' || l.campus === campus) &&
        (kind === 'all' || l.kind === kind) &&
        matchesTime(l),
    ),
    query,
    (l) => `${l.name} ${l.address ?? ''} ${l.campus}`,
  );
  const item = (lib: Library) => (
    <li key={lib.id}>
      <LibraryItem
        data={data}
        library={lib}
        active={lib.id === selectedId}
        levels={levels}
        onSelect={() => onSelectLibrary(lib)}
      />
    </li>
  );
  const kinds = WORKSPACE_KINDS.filter((k) =>
    data.libraries.some((l) => l.kind === k),
  );

  return (
    <section className="panel-section">
      <TextInput
        type="search"
        className="workspace-search"
        placeholder={placeholder}
        aria-label={placeholder}
        leftSection={<Icon name="search" />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        data-autofocus
      />
      {!searching &&
        suggestions.map(
          (row) =>
            row.libraries.length > 0 && (
              <section
                key={row.id}
                aria-labelledby={`workspace-row-${row.id}`}
                className="workspace-suggestions"
              >
                <SectionLabel id={`workspace-row-${row.id}`} as="h3">
                  {row.title}
                </SectionLabel>
                <ul className="list">{row.libraries.map(item)}</ul>
              </section>
            ),
        )}
      <div className="section-head">
        <h2>
          {searching ? 'Matches' : 'All workspaces'}{' '}
          <span className="muted">({libraries.length})</span>
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
      <ul className="list">{libraries.map(item)}</ul>
    </section>
  );
}

function LibraryItem({
  data,
  library: lib,
  active,
  levels,
  onSelect,
}: {
  data: OccupancyData;
  library: Library;
  active: boolean;
  levels: LevelInfo[];
  onSelect: () => void;
}) {
  const occ = occupancyOf(data, lib.id);
  return (
    <button
      className={`list-item${active ? ' is-active' : ''}`}
      onClick={onSelect}
    >
      <span className="list-title">{lib.name}</span>
      <span className="list-meta">
        {lib.kind !== 'library' && `${WORKSPACE_KIND_LABELS[lib.kind]} · `}
        {lib.campus}
        {lib.floor !== null &&
          ` · ${libraryFloorLabel({ floor: lib.floor, levelId: lib.levelId, facilityId: lib.facilityId }, levels)}`}
      </span>
      <OccupancyBar free={occ.free} total={occ.total} />
    </button>
  );
}
