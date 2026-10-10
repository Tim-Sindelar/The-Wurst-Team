import { useState } from 'react';
import { duration, hhmm } from '../domain/ethRooms';
import type { OccupancyStyle } from '../map/minimalStyle';
import type { RoomInfo } from '../roomFeatures';

const PAGE = 30;

/** Side panel list of ETH rooms that are free at the time shown, the longest free first. */
export function FreeRooms({ infos, minute, live, colors, onMap, selectedId, onSelect }: {
  infos: RoomInfo[];
  minute: number;
  live: boolean;
  colors: OccupancyStyle;
  /** ETH ids of the rooms found on the floor plans. */
  onMap: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (ethId: string) => void;
}) {
  const [campus, setCampus] = useState('all');
  const [minSeats, setMinSeats] = useState(0);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const campuses = [...new Set(infos.map((i) => i.room.campus).filter((c): c is string => !!c))].sort();
  const q = query.trim().toLowerCase();
  const capacity = (i: RoomInfo) => i.room.seats ?? i.room.workplaces ?? 0;
  const free = infos
    .filter(
      (i) =>
        (i.state.status === 'free' || i.state.status === 'soon') &&
        (campus === 'all' || i.room.campus === campus) &&
        capacity(i) >= minSeats &&
        (!q || `${i.room.id} ${i.room.type}`.toLowerCase().includes(q)),
    )
    .sort((a, b) => b.state.until - a.state.until || capacity(b) - capacity(a));

  return (
    <details className="panel-section collapsible" open>
      <summary>
        <h2>
          Free rooms {live ? 'now' : `at ${hhmm(minute)}`} <span className="muted">({free.length})</span>
        </h2>
      </summary>
      <div className="free-filters">
        <input type="search" placeholder="Room or type" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search rooms" />
        {campuses.length > 1 && (
          <select value={campus} onChange={(e) => setCampus(e.target.value)} aria-label="Campus">
            <option value="all">All sites</option>
            {campuses.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <label className="check" title="Minimum seats">
          ≥
          <input type="number" min={0} step={10} value={minSeats} onChange={(e) => setMinSeats(Math.max(0, Number(e.target.value) || 0))} aria-label="Minimum seats" />
          seats
        </label>
      </div>
      {free.length === 0 && <p className="muted">No free room matches.</p>}
      <ul className="list">
        {free.slice(0, limit).map((i) => (
          <li key={i.room.id}>
            <button className={`list-item${i.room.id === selectedId ? ' is-active' : ''}`} onClick={() => onSelect(i.room.id)}>
              <span className="list-title">
                <i className="status-dot" style={{ background: colors[i.state.status] }} /> {i.room.id}
              </span>
              <span className="list-meta">{capacity(i) ? `${capacity(i)} seats` : ''}</span>
              <span className="list-meta">
                {i.room.type}
                {!onMap.has(i.room.id) && ' · not on map'}
              </span>
              <span className="list-meta">
                {i.state.until >= 1440 ? 'rest of day' : `until ${hhmm(i.state.until)} · ${duration(i.state.until - minute)}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {free.length > limit && (
        <button className="btn-ghost more" onClick={() => setLimit(limit + PAGE)}>
          Show more ({free.length - limit})
        </button>
      )}
    </details>
  );
}
