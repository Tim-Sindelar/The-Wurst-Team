import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Library, OccupancyData, RoomRef } from './domain/types';
import * as ops from './domain/operations';
import { repository } from './data/repository';
import { DETAIL_ZOOM, MapView, type FlyTarget } from './map/MapView';
import { outlineBounds } from './map/geo';
import { loadFloorIndex, type FloorIndex } from './floors/floorData';
import { AdminPanel } from './components/AdminPanel';
import { ViewerPanel } from './components/ViewerPanel';
import { RenderControls } from './map/RenderControls';
import { NavigationAdmin } from './components/NavigationAdmin';
import { defaultNavigation, homePositions, outlineCenter, type NavigationConfig } from './domain/navigation';
import { fetchNavigation, saveNavigation } from './data/navigationRepository';
import {
  clearLocalTweaks,
  DEFAULT_MINIMAL,
  fetchStandardStyles,
  loadMinimalStyles,
  saveLocalTweak,
  saveStandardStyles,
  type MinimalStyles,
  type RenderMode,
} from './map/minimalStyle';
import { EMPTY_SELECTION, type Mode, type PlacingKind, type SaveState, type Selection } from './state';
import { loadRoomFeatures, saveRoomFeatures, type RoomFeatures, type RoomInfo } from './roomFeatures';
import { roomStateAt, type RoomState } from './domain/ethRooms';
import { useEthRooms, useZurichClock } from './data/useEthRooms';
import { RoomModeButton, RoomPanel } from './components/RoomControls';
import { OccupancyLegend } from './components/OccupancyLegend';
import { RoomDetails } from './components/RoomDetails';
import { FreeRooms } from './components/FreeRooms';
import { UzhPanel } from './components/UzhPanel';

const SAVE_DEBOUNCE_MS = 400;
const NO_DATA: RoomState = { status: 'unknown', current: null, next: null, until: 1440 };

function filterEnabled(data: OccupancyData): OccupancyData {
  const libraries = data.libraries.filter((l) => l.enabled);
  const ids = new Set(libraries.map((l) => l.id));
  const tables = data.tables.filter((t) => ids.has(t.libraryId));
  const tableIds = new Set(tables.map((t) => t.id));
  return { ...data, libraries, tables, seats: data.seats.filter((s) => tableIds.has(s.tableId)) };
}

export default function App() {
  const [data, setData] = useState<OccupancyData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [placing, setPlacing] = useState<PlacingKind | null>(null);
  const [editingOutlineId, setEditingOutlineId] = useState<string | null>(null);
  const [pickingRooms, setPickingRooms] = useState(false);
  const [pickedRooms, setPickedRooms] = useState<RoomRef[]>([]);
  const pickedIds = useMemo(() => new Set(pickedRooms.map((r) => r.id)), [pickedRooms]);
  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);
  const [zoom, setZoom] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const saveTimer = useRef<number | undefined>(undefined);
  const saveChain = useRef(Promise.resolve());
  const [navigation, setNavigation] = useState<NavigationConfig | null>(null);
  const [selectedNavZoneId, setSelectedNavZoneId] = useState<string | null>(null);
  const [editingNavZoneId, setEditingNavZoneId] = useState<string | null>(null);
  const navSaveTimer = useRef<number | undefined>(undefined);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('theme', theme);
    } catch {}
  }, [theme]);

  const [renderMode, setRenderMode] = useState<RenderMode>(() => {
    try {
      if (localStorage.getItem('render-mode') === 'minimal') return 'minimal';
    } catch {}
    return 'detailed';
  });
  // Standard from data/map-style.json (built-in defaults until it loads), plus this browser's tweaks.
  const [standardStyles, setStandardStyles] = useState<MinimalStyles>(DEFAULT_MINIMAL);
  const [minimalStyles, setMinimalStyles] = useState(() => loadMinimalStyles());
  useEffect(() => {
    fetchStandardStyles().then(
      (standard) => {
        setStandardStyles(standard);
        setMinimalStyles(loadMinimalStyles(standard));
      },
      (err) => console.warn('Map style standard unavailable', err),
    );
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('render-mode', renderMode);
    } catch {}
  }, [renderMode]);

  const [floorIndex, setFloorIndex] = useState<FloorIndex | null>(null);
  const [floor, setFloor] = useState(0);

  // ---- live room mode (ETH room bookings) ----
  const [roomFeatures, setRoomFeaturesState] = useState<RoomFeatures>(loadRoomFeatures);
  const setRoomFeatures = (f: RoomFeatures) => {
    setRoomFeaturesState(f);
    saveRoomFeatures(f);
  };
  const [roomPanelOpen, setRoomPanelOpen] = useState(false);
  const rooms = roomFeatures.enabled;
  const { response: ethResponse, error: ethError } = useEthRooms(rooms);
  const clock = useZurichClock(rooms);
  // A time of today picked with the slider; null follows the clock.
  const [pickedMinute, setPickedMinute] = useState<number | null>(null);
  const live = !roomFeatures.timeSlider || pickedMinute === null;
  const minute = live ? clock.minute : pickedMinute!;
  const [selectedEthRoom, setSelectedEthRoom] = useState<string | null>(null);
  const snapshot = ethResponse?.snapshot ?? null;
  // Right after midnight the snapshot is still yesterday's until the next fetch.
  const dayMismatch = !!snapshot && snapshot.date !== clock.date;
  const roomInfos = useMemo<RoomInfo[]>(
    () =>
      snapshot
        ? snapshot.rooms.map((room) => ({ room, state: dayMismatch ? NO_DATA : roomStateAt(room, minute, roomFeatures.soonMinutes) }))
        : [],
    [snapshot, dayMismatch, minute, roomFeatures.soonMinutes],
  );
  const roomInfoById = useMemo(() => new Map(roomInfos.map((i) => [i.room.id, i])), [roomInfos]);
  /** PolyMaps unit id → ETH room, for drawing; null unless something on the map uses it. */
  const roomsOnPlan = useMemo(() => {
    if (!rooms || !ethResponse || !(roomFeatures.occupancy || roomFeatures.labels || roomFeatures.details)) return null;
    const byUnit = new Map<string, RoomInfo>();
    for (const info of roomInfos) for (const place of ethResponse.matches[info.room.id] ?? []) byUnit.set(place.unitId, info);
    return byUnit;
  }, [rooms, ethResponse, roomInfos, roomFeatures.occupancy, roomFeatures.labels, roomFeatures.details]);
  const placedRooms = useMemo(() => new Set(Object.keys(ethResponse?.matches ?? {})), [ethResponse]);

  useEffect(() => {
    repository.load().then(
      (loaded) => {
        setData(loaded);
        // Without a saved navigation.json (or if it can't be read), start with one area per campus.
        fetchNavigation().then(
          (nav) => setNavigation(nav ?? defaultNavigation(loaded.libraries)),
          (err) => {
            console.warn('Navigation config unavailable', err);
            setNavigation(defaultNavigation(loaded.libraries));
          },
        );
      },
      (err) => setLoadError(String(err)),
    );
    // The map still works without floor plans (e.g. extract_floors.py not run yet).
    loadFloorIndex().then(setFloorIndex, (err) => console.warn('Floor plans unavailable', err));
  }, []);

  // Esc cancels placement and room selection mode (the selected rooms are kept).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPlacing(null);
      setPickingRooms(false);
    };
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

  /** Same debounced, serialized saving as `commit`, for data/navigation.json. */
  const commitNavigation = useCallback((next: NavigationConfig) => {
    setNavigation(next);
    setSaveState('saving');
    window.clearTimeout(navSaveTimer.current);
    navSaveTimer.current = window.setTimeout(() => {
      saveChain.current = saveChain.current
        .then(() => saveNavigation(next))
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

  /** Opens a room's details (if that feature is on) and flies to it, on its floor. */
  const showEthRoom = (id: string) => {
    if (roomFeatures.details) setSelectedEthRoom(id);
    const place = ethResponse?.matches[id]?.[0];
    if (place) {
      setFloor(place.floor);
      flyTo({ lat: place.lat, lng: place.lng }, 20);
    }
  };
  const selectedRoomInfo = rooms && roomFeatures.details && selectedEthRoom ? roomInfoById.get(selectedEthRoom) ?? null : null;
  const roomStyle = minimalStyles[theme].occupancy;
  const legendNote = !snapshot
    ? ethResponse?.state === 'running'
      ? `Fetching today's bookings from ETH… ${ethResponse.done} / ${ethResponse.total || '?'}`
      : ethError || ethResponse?.error
        ? 'Room data unavailable, see Rooms ▾'
        : 'Loading room data…'
    : dayMismatch
      ? "Today's bookings are being fetched…"
      : null;

  const switchMode = (m: Mode) => {
    setMode(m);
    setPlacing(null);
    setEditingOutlineId(null);
    setPickingRooms(false);
    setEditingNavZoneId(null);
  };

  const togglePickedRoom = (room: RoomRef) =>
    setPickedRooms((prev) => (prev.some((r) => r.id === room.id) ? prev.filter((r) => r.id !== room.id) : [...prev, room]));

  const finishRoomAssignment = (libraryId: string) => {
    setPickedRooms([]);
    setPickingRooms(false);
    setSelection({ libraryId, tableId: null, seatId: null });
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

  // The normal map only shows workspaces an admin switched on; admin mode shows all.
  const visible: OccupancyData =
    mode === 'admin' ? data : filterEnabled(data);

  const totals = visible.libraries.reduce(
    (acc, l) => {
      const o = ops.occupancyOf(visible, l.id);
      return { free: acc.free + o.free, total: acc.total + o.total };
    },
    { free: 0, total: 0 },
  );

  return (
    <div className={`app mode-${mode}`}>
      <aside className="panel">
        <header className="panel-header">
          <div>
            <h1>ETH Workspace Occupancy</h1>
            <p className="muted">
              {visible.libraries.length} workspaces · {totals.free}/{totals.total} seats free
            </p>
          </div>
          <button
            className="theme-toggle"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title="Toggle theme"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '\u2600' : '\u263E'}
          </button>
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
          {selectedRoomInfo && (
            <RoomDetails
              info={selectedRoomInfo}
              buildingName={snapshot?.buildings[selectedRoomInfo.room.building] ?? null}
              minute={minute}
              colors={roomStyle}
              onClose={() => setSelectedEthRoom(null)}
              onShowOnMap={placedRooms.has(selectedRoomInfo.room.id) ? () => showEthRoom(selectedRoomInfo.room.id) : null}
            />
          )}
          {rooms && roomFeatures.freeList && snapshot && !dayMismatch && (
            <FreeRooms
              infos={roomInfos}
              minute={minute}
              live={live}
              colors={roomStyle}
              onMap={placedRooms}
              selectedId={selectedRoomInfo?.room.id ?? null}
              onSelect={showEthRoom}
            />
          )}
          {rooms && roomFeatures.uzh && <UzhPanel />}
          {mode === 'view' ? (
            <ViewerPanel
              data={visible}
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
                setPickingRooms(false);
                setEditingNavZoneId(null);
              }}
              onToggleOutline={() => {
                setPlacing(null);
                setPickingRooms(false);
                setEditingNavZoneId(null);
                setEditingOutlineId(editingOutlineId ? null : selection.libraryId);
              }}
              pickingRooms={pickingRooms}
              pickedRooms={pickedRooms}
              onTogglePicking={() => {
                setPlacing(null);
                setEditingOutlineId(null);
                setEditingNavZoneId(null);
                setPickingRooms(!pickingRooms);
              }}
              onUnpickRoom={(id) => setPickedRooms(pickedRooms.filter((r) => r.id !== id))}
              onClearPicked={() => setPickedRooms([])}
              onAssignRooms={(libraryId) => {
                commit(ops.assignRooms(data, libraryId, pickedRooms));
                finishRoomAssignment(libraryId);
              }}
              onCreateFromRooms={(kind) => {
                const [next, lib] = ops.addLibraryFromRooms(data, pickedRooms, kind);
                commit(next);
                finishRoomAssignment(lib.id);
              }}
              onRemoveRoom={(libraryId, roomId) => commit(ops.removeRoom(data, libraryId, roomId))}
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
          {mode === 'admin' && navigation && (
            <NavigationAdmin
              config={navigation}
              zoom={zoom}
              floorIndex={floorIndex}
              selectedId={selectedNavZoneId}
              onSelect={(id) => {
                setSelectedNavZoneId(id);
                setEditingNavZoneId(null);
              }}
              editingOutline={editingNavZoneId !== null}
              onToggleOutline={() => {
                setPlacing(null);
                setPickingRooms(false);
                setEditingOutlineId(null);
                setEditingNavZoneId(editingNavZoneId ? null : selectedNavZoneId);
              }}
              onChange={commitNavigation}
              onPreview={(zone) => flyTo(outlineCenter(zone.outline!), zone.zoom)}
            />
          )}
        </div>

        <footer className="legend">
          <span><i className="seat-dot seat-free" /> free</span>
          <span><i className="seat-dot seat-occupied" /> occupied</span>
          <span><i className="seat-dot seat-unknown" /> unknown</span>
          {floorIndex && (
            <span><i className="room-swatch room-library" /> workspace room</span>
          )}
          {mode === 'admin' && pickedRooms.length > 0 && (
            <span><i className="room-swatch room-picked" /> selected room</span>
          )}
          {zoom < DETAIL_ZOOM && <span className="muted">Zoom in to see rooms, tables &amp; seats</span>}
        </footer>
      </aside>

      <main className="map-wrap">
        <MapView
          theme={theme}
          data={visible}
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
          pickingRooms={mode === 'admin' && pickingRooms}
          pickedRooms={pickedIds}
          onPickRoom={togglePickedRoom}
          minimal={renderMode === 'minimal' ? minimalStyles[theme] : null}
          navigation={navigation}
          navEnabled={!(mode === 'admin' && (placing || pickingRooms || editingOutlineId || editingNavZoneId))}
          selectedNavZoneId={mode === 'admin' ? selectedNavZoneId : null}
          editingNavZone={(mode === 'admin' && navigation?.zones.find((z) => z.id === editingNavZoneId)) || null}
          onNavOutlineChange={(id, outline) =>
            navigation && commitNavigation({ zones: navigation.zones.map((z) => (z.id === id ? { ...z, outline } : z)) })
          }
          homePositions={homePositions(data.libraries)}
          ethRooms={roomsOnPlan}
          occupancyStyle={rooms && roomFeatures.occupancy ? roomStyle : null}
          roomLabels={rooms && roomFeatures.labels}
          selectedEthRoom={selectedRoomInfo?.room.id ?? null}
          onEthRoomClick={rooms && roomFeatures.details ? setSelectedEthRoom : null}
        />
        {rooms && (roomFeatures.occupancy || roomFeatures.timeSlider) && (
          <OccupancyLegend
            infos={roomInfos}
            colors={roomStyle}
            showColors={roomFeatures.occupancy}
            minute={minute}
            live={live}
            showSlider={roomFeatures.timeSlider}
            onMinute={setPickedMinute}
            note={legendNote}
          />
        )}
        <RenderControls
          theme={theme}
          mode={renderMode}
          onModeChange={setRenderMode}
          style={minimalStyles[theme]}
          onStyleChange={(s) => {
            setMinimalStyles({ ...minimalStyles, [theme]: s });
            saveLocalTweak(theme, s);
          }}
          isStandard={JSON.stringify(minimalStyles) === JSON.stringify(standardStyles)}
          onSaveStandard={async () => {
            await saveStandardStyles(minimalStyles);
            setStandardStyles(minimalStyles);
          }}
          onReset={() => {
            clearLocalTweaks(theme);
            setMinimalStyles({ ...minimalStyles, [theme]: standardStyles[theme] });
          }}
          occupancyActive={rooms && roomFeatures.occupancy}
          extraBar={
            <RoomModeButton
              features={roomFeatures}
              onChange={setRoomFeatures}
              open={roomPanelOpen}
              onOpen={setRoomPanelOpen}
              busy={ethResponse?.state === 'running'}
            />
          }
          extraPanel={
            rooms && roomPanelOpen ? (
              <RoomPanel features={roomFeatures} onChange={setRoomFeatures} response={ethResponse} error={ethError} floorPlans={floorIndex !== null} />
            ) : null
          }
        />
      </main>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const text = {
    idle: 'Changes are saved to data/overrides.json and data/navigation.json',
    saving: 'Saving…',
    saved: 'All changes saved',
    error: 'Save failed — check the dev server console',
  }[state];
  return <div className={`save save-${state}`}>{text}</div>;
}
