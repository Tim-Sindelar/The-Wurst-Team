import { useState, type ReactNode } from 'react';
import type { DayKey, Library, OccupancyData, OpeningHours, RoomRef, Seat, Table, TimeRange, WorkspaceKind } from '../domain/types';
import { DAY_KEYS } from '../domain/types';
import { DAY_LABELS, emptyHours } from '../domain/hours';
import { CAMPUSES, SEAT_STATUSES, WORKSPACE_KIND_LABELS, WORKSPACE_KINDS } from '../domain/types';
import { outlineAreaM2, seatsOfTable, tablesOf } from '../domain/operations';
import type { PlacingKind, Selection } from '../state';
import { libraryFloorLabel, levelName, roomName } from '../floors/floorData';

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
  pickingRooms: boolean;
  pickedRooms: RoomRef[];
  onTogglePicking: () => void;
  onUnpickRoom: (roomId: string) => void;
  onClearPicked: () => void;
  onAssignRooms: (libraryId: string) => void;
  onCreateFromRooms: (kind: WorkspaceKind) => void;
  onRemoveRoom: (libraryId: string, roomId: string) => void;
}

const PLACING_HINT: Record<PlacingKind, string> = {
  library: 'Click on the map to place the new workspace.',
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

      <RoomSelection {...p} />

      <section className="panel-section">
        <div className="section-head">
          <h2>Workspaces</h2>
          <button className="btn" onClick={() => p.onPlace('library')}>
            + Workspace
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
            Select a workspace…
          </option>
          <WorkspaceOptions libraries={data.libraries} />
        </select>
      </section>

      {library && (
        <section className="panel-section">
          <div className="section-head">
            <h3>Workspace details</h3>
            <button
              className="btn-danger"
              onClick={() => confirm(`Delete "${library.name}" with all its tables and seats?`) && p.onDeleteLibrary(library.id)}
            >
              Delete
            </button>
          </div>
          <div className="form">
            <label className="check">
              <input
                type="checkbox"
                checked={library.enabled}
                onChange={(e) => p.onUpdateLibrary(library.id, { enabled: e.target.checked })}
              />
              Show on the normal map
            </label>
            <Field label="Name">
              <input value={library.name} onChange={(e) => p.onUpdateLibrary(library.id, { name: e.target.value })} />
            </Field>
            <Field label="Type">
              <select
                value={library.kind}
                onChange={(e) => p.onUpdateLibrary(library.id, { kind: e.target.value as WorkspaceKind })}
              >
                {WORKSPACE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {WORKSPACE_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Address (from its first room)">
              <div className="readonly">{library.address ?? 'Add a room to set the address'}</div>
            </Field>
            <HoursEditor value={library.openingHours} onChange={(h) => p.onUpdateLibrary(library.id, { openingHours: h })} />
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
            <Field label="Conditional availability">
              <textarea
                rows={2}
                placeholder="e.g. only with a reservation, during exam period only"
                value={library.availabilityNote ?? ''}
                onChange={(e) => p.onUpdateLibrary(library.id, { availabilityNote: e.target.value || null })}
              />
            </Field>
            <label className="check">
              <input
                type="checkbox"
                checked={library.cardAccess24h}
                onChange={(e) => p.onUpdateLibrary(library.id, { cardAccess24h: e.target.checked })}
              />
              24h access with ETH card
            </label>
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
                ? `From PolyMaps: floor ${libraryFloorLabel({ floor: library.floor ?? 0, levelId: library.levelId })}${library.levelId ? ` (${levelName(library.levelId)})` : ''}`
                : library.floor !== null
                  ? `Shown on floor ${libraryFloorLabel({ floor: library.floor })}.`
                  : 'Not in PolyMaps: shown on every floor.'}
            </p>
          </div>

          <div className="section-head sub">
            <h3>Rooms ({library.rooms.length})</h3>
          </div>
          {library.rooms.length ? (
            <ul className="table-grid">
              {library.rooms.map((r) => (
                <li key={r}>
                  <span className="chip">
                    {roomName(r)}
                    <button
                      className="chip-remove"
                      title="Remove room from this workspace"
                      onClick={() => p.onRemoveRoom(library.id, r)}
                    >
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">No rooms yet. Use "Select rooms" above to add some.</p>
          )}

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
        <p className="hint">Select a workspace (list or map) to edit it and register tables and seats. All pins are draggable.</p>
      )}
    </>
  );
}

/** Picking rooms on the map and turning them into (part of) a workspace. */
function RoomSelection(p: Props) {
  const { data, selection, pickedRooms } = p;
  const [target, setTarget] = useState('');
  const [kind, setKind] = useState<WorkspaceKind>('study');
  const targetId = target || selection.libraryId || '';
  const owner = new Map(data.libraries.flatMap((l) => l.rooms.map((r) => [r, l] as const)));
  const taken = pickedRooms.filter((r) => owner.has(r.id) && owner.get(r.id)!.id !== targetId);
  const confirmTaken = () =>
    !taken.length ||
    confirm(
      `${taken.map((r) => `${r.name} (${owner.get(r.id)!.name})`).join(', ')} will be moved out of their current workspace. Continue?`,
    );

  return (
    <section className="panel-section">
      <div className="section-head">
        <h2>Rooms</h2>
        <button className={p.pickingRooms ? 'btn is-active' : 'btn'} onClick={p.onTogglePicking}>
          {p.pickingRooms ? 'Done selecting' : 'Select rooms'}
        </button>
      </div>
      {p.pickingRooms && (
        <p className="note">
          Click rooms on the map to select or deselect them. Zoom in to see rooms and use the floor picker to reach
          other floors. Press Esc when done.
        </p>
      )}
      {pickedRooms.length > 0 && (
        <>
          <ul className="table-grid">
            {pickedRooms.map((r) => (
              <li key={r.id}>
                <span className="chip chip-picked">
                  {r.name}
                  {owner.has(r.id) && <span className="muted"> · {owner.get(r.id)!.name}</span>}
                  <button className="chip-remove" title="Deselect" onClick={() => p.onUnpickRoom(r.id)}>
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="form">
            <div className="row">
              <select value={targetId} onChange={(e) => setTarget(e.target.value)} aria-label="Target workspace">
                <option value="" disabled>
                  Add to workspace…
                </option>
                <WorkspaceOptions libraries={data.libraries} />
              </select>
              <button className="btn" disabled={!targetId} onClick={() => confirmTaken() && p.onAssignRooms(targetId)}>
                Add
              </button>
            </div>
            <div className="row">
              <select value={kind} onChange={(e) => setKind(e.target.value as WorkspaceKind)} aria-label="New workspace type">
                {WORKSPACE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    New {WORKSPACE_KIND_LABELS[k].toLowerCase()}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={() => confirmTaken() && p.onCreateFromRooms(kind)}>
                Create
              </button>
            </div>
            <button className="btn-ghost" onClick={p.onClearPicked}>
              Clear selection ({pickedRooms.length})
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** Workspaces grouped by type, for <select>s. */
function WorkspaceOptions({ libraries }: { libraries: Library[] }) {
  return (
    <>
      {WORKSPACE_KINDS.map((k) => {
        const list = libraries.filter((l) => l.kind === k);
        return list.length ? (
          <optgroup key={k} label={WORKSPACE_KIND_LABELS[k]}>
            {list.map((l) => (
              <option key={l.id} value={l.id}>
                {l.enabled ? '● ' : '○ '}
                {l.name}
              </option>
            ))}
          </optgroup>
        ) : null;
      })}
    </>
  );
}

/** Whole week in one place: a row per day, copy buttons to fill the rest of the week from Monday. */
function HoursEditor({ value, onChange }: { value: OpeningHours | null; onChange: (h: OpeningHours | null) => void }) {
  const hours = value ?? emptyHours();
  const setDay = (day: DayKey, ranges: TimeRange[]) => onChange({ ...hours, [day]: ranges });
  const setRange = (day: DayKey, i: number, patch: Partial<TimeRange>) =>
    setDay(day, hours[day].map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const copyMonday = (days: readonly DayKey[]) =>
    onChange({ ...hours, ...Object.fromEntries(days.map((d) => [d, hours.mon.map((r) => ({ ...r }))])) });
  return (
    <div className="hours-editor">
      <div className="section-head">
        <span className="muted">Opening hours{value ? '' : ' (not published)'}</span>
        {value && (
          <button className="btn-ghost" onClick={() => onChange(null)} title="Mark as not published">
            Clear
          </button>
        )}
      </div>
      {DAY_KEYS.map((day) => (
        <div className="hours-day" key={day}>
          <span className="hours-label">{DAY_LABELS[day]}</span>
          <div className="hours-ranges">
            {hours[day].length === 0 && <span className="muted">closed</span>}
            {hours[day].map((r, i) => (
              <span className="hours-range" key={i}>
                <input type="time" value={r.from} onChange={(e) => setRange(day, i, { from: e.target.value })} />
                –
                <input type="time" value={r.to} onChange={(e) => setRange(day, i, { to: e.target.value })} />
                <button className="chip-remove" title="Remove" onClick={() => setDay(day, hours[day].filter((_, j) => j !== i))}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <button
            className="btn-ghost"
            title="Add a time range"
            onClick={() => setDay(day, [...hours[day], hours[day].length ? { from: '13:00', to: '18:00' } : { from: '08:00', to: '18:00' }])}
          >
            +
          </button>
          <button className="btn-ghost" title="Open all day" onClick={() => setDay(day, [{ from: '00:00', to: '23:59' }])}>
            24h
          </button>
        </div>
      ))}
      <div className="hours-copy">
        <span className="muted">Copy Monday to</span>
        <button className="btn-ghost" onClick={() => copyMonday(DAY_KEYS.slice(1, 5))}>
          Tue–Fri
        </button>
        <button className="btn-ghost" onClick={() => copyMonday(DAY_KEYS.slice(1))}>
          all days
        </button>
      </div>
    </div>
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
