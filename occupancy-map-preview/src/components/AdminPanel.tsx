import type { ReactNode } from 'react';
import type { Library, OccupancyData, Seat, Table } from '../domain/types';
import { CAMPUSES, SEAT_STATUSES } from '../domain/types';
import { outlineAreaM2, seatsOfTable, tablesOf } from '../domain/operations';
import type { PlacingKind, Selection } from '../state';
import { floorLabel, levelName, roomName } from '../floors/floorData';

interface Props {
  data: OccupancyData;
  selection: Selection;
  placing: PlacingKind | null;
  editingOutline: boolean;
  onPlace: (kind: PlacingKind | null) => void;
  onToggleOutline: () => void;
  onSelectLibrary: (lib: Library) => void;
  onSelect: (sel: Selection) => void;
  onUpdateLibrary: (id: string, patch: Partial<Library>) => void;
  onDeleteLibrary: (id: string) => void;
  onUpdateTable: (id: string, patch: Partial<Table>) => void;
  onDeleteTable: (id: string) => void;
  onUpdateSeat: (id: string, patch: Partial<Seat>) => void;
  onDeleteSeat: (id: string) => void;
}

const PLACING_HINT: Record<PlacingKind, string> = {
  library: 'Click on the map to place the new library.',
  table: 'Click on the map to place a table. Zoom in for precision.',
  seat: 'Click on the map to place seats around the table. Press Esc when done.',
};

export function AdminPanel(p: Props) {
  const { data, selection, placing } = p;
  const library = data.libraries.find((l) => l.id === selection.libraryId) ?? null;
  const table = data.tables.find((t) => t.id === selection.tableId) ?? null;

  return (
    <>
      {placing && (
        <div className="placing-banner">
          <span>{PLACING_HINT[placing]}</span>
          <button className="btn-ghost" onClick={() => p.onPlace(null)}>
            Cancel
          </button>
        </div>
      )}

      <section className="panel-section">
        <div className="section-head">
          <h2>Libraries</h2>
          <button className="btn" onClick={() => p.onPlace('library')}>
            + Library
          </button>
        </div>
        <select
          className="full"
          value={selection.libraryId ?? ''}
          onChange={(e) => {
            const lib = data.libraries.find((l) => l.id === e.target.value);
            if (lib) p.onSelectLibrary(lib);
          }}
        >
          <option value="" disabled>
            Select a library…
          </option>
          {data.libraries.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </section>

      {library && (
        <section className="panel-section">
          <div className="section-head">
            <h3>Library details</h3>
            <button
              className="btn-danger"
              onClick={() => confirm(`Delete "${library.name}" with all its tables and seats?`) && p.onDeleteLibrary(library.id)}
            >
              Delete
            </button>
          </div>
          <div className="form">
            <Field label="Name">
              <input value={library.name} onChange={(e) => p.onUpdateLibrary(library.id, { name: e.target.value })} />
            </Field>
            <Field label="Address">
              <input
                value={library.address ?? ''}
                onChange={(e) => p.onUpdateLibrary(library.id, { address: e.target.value || null })}
              />
            </Field>
            <Field label="Opening hours">
              <input
                value={library.openingHours ?? ''}
                onChange={(e) => p.onUpdateLibrary(library.id, { openingHours: e.target.value || null })}
              />
            </Field>
            <div className="row">
              <Field label="Campus">
                <select
                  value={library.campus}
                  onChange={(e) => p.onUpdateLibrary(library.id, { campus: e.target.value as Library['campus'] })}
                >
                  {CAMPUSES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Operator">
                <select
                  value={library.operator}
                  onChange={(e) => p.onUpdateLibrary(library.id, { operator: e.target.value as Library['operator'] })}
                >
                  <option>ETH-Bibliothek</option>
                  <option>Weitere</option>
                </select>
              </Field>
            </div>
            <Field label="Description">
              <textarea
                rows={2}
                value={library.description ?? ''}
                onChange={(e) => p.onUpdateLibrary(library.id, { description: e.target.value || null })}
              />
            </Field>
            <label className="check">
              <input
                type="checkbox"
                checked={library.positionApproximate}
                onChange={(e) => p.onUpdateLibrary(library.id, { positionApproximate: e.target.checked })}
              />
              Position is approximate (drag the pin to fix it)
            </label>
            <Coords pos={library.position} />
            <p className="note">
              {library.rooms.length
                ? `From PolyMaps: floor ${floorLabel(library.floor ?? 0)}${library.levelId ? ` (${levelName(library.levelId)})` : ''} · ${library.rooms.map(roomName).join(', ')}`
                : library.floor !== null
                  ? `Shown on floor ${floorLabel(library.floor)}.`
                  : 'Not in PolyMaps: shown on every floor.'}
            </p>
          </div>

          <div className="section-head sub">
            <h3>Outline</h3>
            <div className="icon-actions">
              {library.outline && !p.editingOutline && (
                <button
                  className="btn-danger"
                  onClick={() => confirm('Remove this outline?') && p.onUpdateLibrary(library.id, { outline: null })}
                >
                  Clear
                </button>
              )}
              <button className={p.editingOutline ? 'btn is-active' : 'btn'} onClick={p.onToggleOutline}>
                {p.editingOutline ? 'Done' : library.outline ? 'Edit outline' : 'Draw outline'}
              </button>
            </div>
          </div>
          {p.editingOutline ? (
            <p className="note">
              Use the toolbar at the top left of the map: draw polygons or rectangles, drag corners (click a midpoint
              to add one, right-click to delete one), move, rotate, cut holes or remove parts. Switch to the aerial
              layer to trace the building. Changes save automatically.
            </p>
          ) : (
            <p className="note">
              {library.outline
                ? `${library.outline.coordinates.length} part(s) · ≈ ${Math.round(outlineAreaM2(library.outline))} m²`
                : 'No outline yet.'}
            </p>
          )}

          <div className="section-head sub">
            <h3>Tables ({tablesOf(data, library.id).length})</h3>
            <button className="btn" onClick={() => p.onPlace('table')}>
              + Table
            </button>
          </div>
          <ul className="table-grid">
            {tablesOf(data, library.id).map((t) => (
              <li key={t.id}>
                <button
                  className={`chip${t.id === selection.tableId ? ' is-active' : ''}`}
                  onClick={() => p.onSelect({ libraryId: library.id, tableId: t.id, seatId: null })}
                >
                  {t.label} <span className="muted">{seatsOfTable(data, t.id).length}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {library && table && (
        <section className="panel-section">
          <div className="section-head">
            <h3>Table {table.label}</h3>
            <button
              className="btn-danger"
              onClick={() => confirm(`Delete table "${table.label}" and its seats?`) && p.onDeleteTable(table.id)}
            >
              Delete
            </button>
          </div>
          <div className="form">
            <Field label="Label">
              <input value={table.label} onChange={(e) => p.onUpdateTable(table.id, { label: e.target.value })} />
            </Field>
            <Coords pos={table.position} />
          </div>

          <div className="section-head sub">
            <h3>Seats ({seatsOfTable(data, table.id).length})</h3>
            <button
              className={placing === 'seat' ? 'btn is-active' : 'btn'}
              onClick={() => p.onPlace(placing === 'seat' ? null : 'seat')}
            >
              {placing === 'seat' ? 'Done' : '+ Seats'}
            </button>
          </div>
          <ul className="seat-list">
            {seatsOfTable(data, table.id).map((s) => (
              <li key={s.id} className={s.id === selection.seatId ? 'is-active' : ''}>
                <span className={`seat-dot seat-${s.status}`} />
                <input
                  value={s.label}
                  onFocus={() => p.onSelect({ libraryId: library.id, tableId: table.id, seatId: s.id })}
                  onChange={(e) => p.onUpdateSeat(s.id, { label: e.target.value })}
                  aria-label="Seat label"
                />
                <select
                  value={s.status}
                  onChange={(e) => p.onUpdateSeat(s.id, { status: e.target.value as Seat['status'] })}
                  aria-label="Seat status"
                >
                  {SEAT_STATUSES.map((st) => (
                    <option key={st}>{st}</option>
                  ))}
                </select>
                <button className="btn-icon" title="Delete seat" onClick={() => p.onDeleteSeat(s.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!library && (
        <p className="hint">Select a library (list or map) to edit it and register tables and seats. All pins are draggable.</p>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Coords({ pos }: { pos: { lat: number; lng: number } }) {
  return (
    <p className="coords">
      {pos.lat.toFixed(7)}, {pos.lng.toFixed(7)}
    </p>
  );
}
