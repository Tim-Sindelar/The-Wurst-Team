import { useState } from 'react';
import type { Campus, Library, OccupancyData } from '../domain/types';
import { CAMPUSES } from '../domain/types';
import { occupancyOf, seatsOfTable, tablesOf } from '../domain/operations';
import type { Selection } from '../state';
import { OccupancyBar } from './OccupancyBar';
import { floorLabel, levelName, roomName } from '../floors/floorData';

interface Props {
  data: OccupancyData;
  selection: Selection;
  onSelectLibrary: (lib: Library) => void;
  onSelectTable: (libraryId: string, tableId: string) => void;
}

export function ViewerPanel({ data, selection, onSelectLibrary, onSelectTable }: Props) {
  const [campus, setCampus] = useState<Campus | 'all'>('all');
  const selected = data.libraries.find((l) => l.id === selection.libraryId) ?? null;
  const libraries = data.libraries.filter((l) => campus === 'all' || l.campus === campus);

  return (
    <>
      {selected && <LibraryDetails data={data} library={selected} selection={selection} onSelectTable={onSelectTable} />}

      <section className="panel-section">
        <div className="section-head">
          <h2>Libraries</h2>
          <select value={campus} onChange={(e) => setCampus(e.target.value as Campus | 'all')} aria-label="Campus filter">
            <option value="all">All campuses</option>
            {CAMPUSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
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
                    {lib.campus}
                    {lib.floor !== null && ` · ${floorLabel(lib.floor)}`}
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
        <dt>Address</dt>
        <dd>{library.address ?? 'not published'}</dd>
        {library.floor !== null && (
          <>
            <dt>Floor</dt>
            <dd>
              {floorLabel(library.floor)}
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
        <dd>{library.openingHours ?? 'not published'}</dd>
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
                  {t.label} <span className="muted">{free}/{seats.length}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {library.sourceUrl && (
        <a className="source" href={library.sourceUrl} target="_blank" rel="noreferrer">
          Source ↗
        </a>
      )}
    </section>
  );
}
