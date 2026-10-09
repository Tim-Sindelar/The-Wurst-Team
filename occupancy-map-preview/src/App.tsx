import { useCallback, useEffect, useRef, useState } from 'react';
import type { Library, OccupancyData } from './domain/types';
import * as ops from './domain/operations';
import { repository } from './data/repository';
import { DETAIL_ZOOM, MapView, type FlyTarget } from './map/MapView';
import { outlineBounds } from './map/geo';
import { loadFloorIndex, type FloorIndex } from './floors/floorData';
import { AdminPanel } from './components/AdminPanel';
import { ViewerPanel } from './components/ViewerPanel';
import { EMPTY_SELECTION, type Mode, type PlacingKind, type SaveState, type Selection } from './state';

const SAVE_DEBOUNCE_MS = 400;

export default function App() {
  const [data, setData] = useState<OccupancyData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [placing, setPlacing] = useState<PlacingKind | null>(null);
  const [editingOutlineId, setEditingOutlineId] = useState<string | null>(null);
  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);
  const [zoom, setZoom] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const saveTimer = useRef<number | undefined>(undefined);
  const saveChain = useRef(Promise.resolve());

  const [floorIndex, setFloorIndex] = useState<FloorIndex | null>(null);
  const [floor, setFloor] = useState(0);

  useEffect(() => {
    repository.load().then(setData, (err) => setLoadError(String(err)));
    // The map still works without floor plans (e.g. extract_floors.py not run yet).
    loadFloorIndex().then(setFloorIndex, (err) => console.warn('Floor plans unavailable', err));
  }, []);

  // Esc cancels placement mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPlacing(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Apply an edit locally and persist it (debounced, writes serialized). */
  const commit = useCallback((next: OccupancyData) => {
    setData(next);
    setSaveState('saving');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveChain.current = saveChain.current
        .then(() => repository.save(next))
        .then(
          () => setSaveState('saved'),
          (err) => {
            console.error(err);
            setSaveState('error');
          },
        );
    }, SAVE_DEBOUNCE_MS);
  }, []);

  if (loadError) return <div className="fatal">Could not load data: {loadError}</div>;
  if (!data) return <div className="fatal">Loading…</div>;

  const flyTo = (position: { lat: number; lng: number }, z: number) =>
    setFlyTarget({ position, zoom: z, nonce: Date.now() });

  const selectLibrary = (lib: Library) => {
    setSelection({ libraryId: lib.id, tableId: null, seatId: null });
    setPlacing(null);
    setEditingOutlineId(null);
    if (lib.floor !== null) setFloor(lib.floor);
    if (lib.outline) setFlyTarget({ position: lib.position, zoom: 19, bounds: outlineBounds(lib.outline), nonce: Date.now() });
    else flyTo(lib.position, lib.rooms.length ? 20 : 19);
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setPlacing(null);
    setEditingOutlineId(null);
  };

  const handleMapClick = (pos: { lat: number; lng: number }) => {
    if (mode !== 'admin' || !placing) return;
    if (placing === 'library') {
      const [next, lib] = ops.addLibrary(data, pos, floorIndex ? floor : null);
      commit(next);
      setSelection({ libraryId: lib.id, tableId: null, seatId: null });
      setPlacing(null);
    } else if (placing === 'table' && selection.libraryId) {
      const [next, table] = ops.addTable(data, selection.libraryId, pos);
      commit(next);
      setSelection({ libraryId: selection.libraryId, tableId: table.id, seatId: null });
      setPlacing(null);
    } else if (placing === 'seat' && selection.tableId) {
      // Seat placement stays active so several seats can be clicked in a row.
      const [next, seat] = ops.addSeat(data, selection.tableId, pos);
      commit(next);
      setSelection({ ...selection, seatId: seat.id });
    }
  };

  const totals = data.libraries.reduce(
    (acc, l) => {
      const o = ops.occupancyOf(data, l.id);
      return { free: acc.free + o.free, total: acc.total + o.total };
    },
    { free: 0, total: 0 },
  );

  return (
    <div className={`app mode-${mode}`}>
      <aside className="panel">
        <header className="panel-header">
          <div>
            <h1>ETH Library Occupancy</h1>
            <p className="muted">
              {data.libraries.length} libraries · {totals.free}/{totals.total} seats free
            </p>
          </div>
          <div className="mode-toggle" role="radiogroup" aria-label="Mode">
            <button role="radio" aria-checked={mode === 'view'} onClick={() => switchMode('view')}>
              View
            </button>
            <button role="radio" aria-checked={mode === 'admin'} onClick={() => switchMode('admin')}>
              Admin
            </button>
          </div>
        </header>

        {mode === 'admin' && <SaveIndicator state={saveState} />}

        <div className="panel-body">
          {mode === 'view' ? (
            <ViewerPanel
              data={data}
              selection={selection}
              onSelectLibrary={selectLibrary}
              onSelectTable={(libraryId, tableId) => {
                setSelection({ libraryId, tableId, seatId: null });
                const t = data.tables.find((x) => x.id === tableId);
                if (t) flyTo(t.position, 21);
              }}
            />
          ) : (
            <AdminPanel
              data={data}
              selection={selection}
              placing={placing}
              editingOutline={editingOutlineId !== null}
              onPlace={(kind) => {
                setPlacing(kind);
                setEditingOutlineId(null);
              }}
              onToggleOutline={() => {
                setPlacing(null);
                setEditingOutlineId(editingOutlineId ? null : selection.libraryId);
              }}
              onSelectLibrary={selectLibrary}
              onSelect={setSelection}
              onUpdateLibrary={(id, patch) => commit(ops.updateLibrary(data, id, patch))}
              onDeleteLibrary={(id) => {
                commit(ops.deleteLibrary(data, id));
                setSelection(EMPTY_SELECTION);
                setEditingOutlineId(null);
              }}
              onUpdateTable={(id, patch) => commit(ops.updateTable(data, id, patch))}
              onDeleteTable={(id) => {
                commit(ops.deleteTable(data, id));
                setSelection({ ...selection, tableId: null, seatId: null });
                setPlacing(null);
              }}
              onUpdateSeat={(id, patch) => commit(ops.updateSeat(data, id, patch))}
              onDeleteSeat={(id) => {
                commit(ops.deleteSeat(data, id));
                if (selection.seatId === id) setSelection({ ...selection, seatId: null });
              }}
            />
          )}
        </div>

        <footer className="legend">
          <span><i className="seat-dot seat-free" /> free</span>
          <span><i className="seat-dot seat-occupied" /> occupied</span>
          <span><i className="seat-dot seat-unknown" /> unknown</span>
          {floorIndex && (
            <span><i className="room-swatch room-library" /> library room</span>
          )}
          {zoom < DETAIL_ZOOM && <span className="muted">Zoom in to see rooms, tables &amp; seats</span>}
        </footer>
      </aside>

      <main className="map-wrap">
        <MapView
          data={data}
          mode={mode}
          selection={selection}
          placing={placing}
          editingOutlineId={editingOutlineId}
          flyTarget={flyTarget}
          floorIndex={floorIndex}
          floor={floor}
          onFloorChange={setFloor}
          onMapClick={handleMapClick}
          onSelect={(sel) => {
            // While placing or drawing, a stray click on a marker must not switch the target.
            if (placing || editingOutlineId) return;
            setSelection(sel);
            const lib = data.libraries.find((l) => l.id === sel.libraryId);
            if (lib && lib.floor !== null && sel.libraryId !== selection.libraryId) setFloor(lib.floor);
          }}
          onMoveLibrary={(id, pos) => commit(ops.updateLibrary(data, id, { position: pos }))}
          onMoveTable={(id, pos) => commit(ops.moveTable(data, id, pos))}
          onMoveSeat={(id, pos) => commit(ops.updateSeat(data, id, { position: pos }))}
          onZoomChange={setZoom}
          onOutlineChange={(id, outline) => commit(ops.updateLibrary(data, id, { outline }))}
        />
      </main>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const text = {
    idle: 'Changes are saved to data/occupancy.json',
    saving: 'Saving…',
    saved: 'All changes saved',
    error: 'Save failed — check the dev server console',
  }[state];
  return <div className={`save save-${state}`}>{text}</div>;
}
