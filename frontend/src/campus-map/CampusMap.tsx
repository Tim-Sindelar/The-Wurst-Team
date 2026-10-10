import {
  ActionIcon,
  Alert,
  Button,
  Slider,
  Switch,
  Text,
  Title,
  useComputedColorScheme,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LatLngBoundsLiteral } from 'leaflet';
import { Link } from 'react-router';
import { listSpacesOptions } from '../api/generated/@tanstack/react-query.gen';
import { Icon } from '../components/Icon';
import { ThemeToggle } from '../components/ThemeToggle';
import { paths } from '../routes';
import { LiveRooms } from './components/LiveRooms';
import { OccupancyLegend } from './components/OccupancyLegend';
import { RoomDetails } from './components/RoomDetails';
import { RoomPhotos } from './components/RoomPhotos';
import { WorkspaceDetails } from './components/WorkspaceDetails';
import { WorkspaceList } from './components/WorkspaceList';
import { guessEthId } from './data/ethRoomsRepository';
import { repository } from './data/repository';
import { fetchNavigation } from './data/navigationRepository';
import { useEthRooms, useZurichClock } from './data/useEthRooms';
import { DatasetItemDetails } from './datasets/DatasetItemDetails';
import { DatasetLayers, type DatasetSelection } from './datasets/DatasetLayers';
import type { Clock } from './datasets/present';
import type { DatasetItem, DatasetMeta, MensaDetails } from './datasets/types';
import { useDatasetList, useDatasets } from './datasets/useDatasets';
import { useMensaItems } from './datasets/useMensaItems';
import {
  hhmm,
  ROOM_STATUS_LABELS,
  roomStateAt,
  type RoomState,
} from './domain/ethRooms';
import {
  defaultNavigation,
  forPhones,
  homePositions,
  type NavigationConfig,
} from './domain/navigation';
import { occupancyOf } from './domain/operations';
import { WORKSPACE_KIND_LABELS, type OccupancyData } from './domain/types';
import { datasetAt, weekdayOf } from './domain/viewTime';
import { loadFloorIndex, type FloorIndex } from './floors/floorData';
import type { MensaRoom } from './map/FloorLayer';
import { MapView, type FlyTarget } from './map/MapView';
import { ModeControl } from './map/ModeControl';
import { outlineBounds } from './map/geo';
import {
  DEFAULT_MINIMAL,
  fetchStandardStyles,
  type MinimalStyles,
} from './map/minimalStyle';
import { MapSheet } from './MapSheet';
import {
  bookableLibraryIds,
  load3d,
  loadMapMode,
  MAP_MODE_LABELS,
  MAP_MODES,
  MODE_DATASETS,
  save3d,
  saveMapMode,
  type MapMode,
} from './mapMode';
import { DEFAULT_ROOM_FEATURES, type RoomInfo } from './roomFeatures';
import { sameTarget, type MapTarget } from './target';
import { EMPTY_SELECTION, type Selection } from './state';

const NO_DATA: RoomState = {
  status: 'unknown',
  current: null,
  next: null,
  until: 1440,
};

type Sheet = 'workspaces' | 'mode' | null;

/** From this zoom on the map shows workspaces closely enough to color the mensa ones. */
const MENSA_ZOOM = 16;

/** Live rooms show everything but the UZH libraries (no longer switchable). */
const ROOM_FEATURES = { ...DEFAULT_ROOM_FEATURES, enabled: true };

const NO_MENSAS: ReadonlyMap<string, MensaRoom> = new Map();

/** Only the workspaces `keep` lets through, with their tables and seats. */
function keepLibraries(
  data: OccupancyData,
  keep: (lib: OccupancyData['libraries'][number]) => boolean,
): OccupancyData {
  const libraries = data.libraries.filter(keep);
  const ids = new Set(libraries.map((l) => l.id));
  const tables = data.tables.filter((t) => ids.has(t.libraryId));
  const tableIds = new Set(tables.map((t) => t.id));
  return {
    ...data,
    libraries,
    tables,
    seats: data.seats.filter((s) => tableIds.has(s.tableId)),
  };
}

/** How far outside a campus area's bounding box pins still show, in degrees (~300 m). */
const AREA_PAD_LAT = 0.0027;
const AREA_PAD_LNG = 0.004;

/** Whether a point lies near one of the campus areas (Hönggerberg, Zentrum). */
function nearArea(boxes: LatLngBoundsLiteral[], lat: number, lng: number) {
  return boxes.some(
    ([[south, west], [north, east]]) =>
      lat >= south - AREA_PAD_LAT &&
      lat <= north + AREA_PAD_LAT &&
      lng >= west - AREA_PAD_LNG &&
      lng <= east + AREA_PAD_LNG,
  );
}

/** The rooms of a mensa item, if datasets/mensa/rooms.json locates it. */
function mensaPlace(item: DatasetItem) {
  return (item.details as unknown as MensaDetails).place ?? null;
}

/* The campus map, full screen. Ported from the view mode of
   occupancy-map-preview (that app keeps the admin tools; their output is
   imported into the backend). Tapping a room, workspace or pin selects it and
   opens its popup (the details sheet); once closed, a short card above the
   toolbar brings it back. */
export function CampusMap() {
  const theme = useComputedColorScheme('dark');

  const [data, setData] = useState<OccupancyData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [navigation, setNavigation] = useState<NavigationConfig | null>(null);
  const [floorIndex, setFloorIndex] = useState<FloorIndex | null>(null);
  const [floor, setFloor] = useState(0);
  const [zoom, setZoom] = useState(0);
  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);
  const [styles, setStyles] = useState<MinimalStyles>(DEFAULT_MINIMAL);

  // What the map shows (the slider behind the layers button); all else stays off.
  const [mode, setModeState] = useState<MapMode>(loadMapMode);
  // The 3D floor stack, switched in the same sheet; on by default.
  const [view3d, setView3dState] = useState(load3d);
  const setView3d = (on: boolean) => {
    setView3dState(on);
    save3d(on);
  };

  const [sheet, setSheet] = useState<Sheet>(null);
  const [target, setTarget] = useState<MapTarget | null>(null);
  const [dashboardOpen, setDashboardOpen] = useState(false);

  useEffect(() => {
    repository.load().then(
      (loaded) => {
        setData(loaded);
        // Without navigation.json, start with one area per campus.
        fetchNavigation().then(
          (nav) =>
            setNavigation(
              forPhones(nav ?? defaultNavigation(loaded.libraries)),
            ),
          (err) => {
            console.warn('Navigation config unavailable', err);
            setNavigation(forPhones(defaultNavigation(loaded.libraries)));
          },
        );
      },
      (err) => setLoadError(String(err)),
    );
    // The map still works without floor plans (extract_floors.py not run yet).
    loadFloorIndex().then(setFloorIndex, (err) =>
      console.warn('Floor plans unavailable', err),
    );
    fetchStandardStyles().then(setStyles, (err) =>
      console.warn('Map style unavailable, using the built-in one', err),
    );
  }, []);

  // ---- the bookable study spaces (the home screen's), for the study mode ----
  const spacesQuery = useQuery(listSpacesOptions());
  const bookable = useMemo(
    () =>
      data && spacesQuery.data
        ? bookableLibraryIds(
            spacesQuery.data.spaces,
            data.libraries.filter((l) => l.enabled),
          )
        : null,
    [data, spacesQuery.data],
  );

  // ---- live rooms (ETH room bookings), on outside the study mode ----
  const roomFeatures = ROOM_FEATURES;
  const rooms = mode !== 'study';

  /* Workspace and mensa popups show the booking status and photos of their ETH
     rooms even with live rooms off: the room data is fetched the first time
     one is opened. */
  const [ethWanted, setEthWanted] = useState(false);
  useEffect(() => {
    if (
      target?.kind === 'library' ||
      (target?.kind === 'dataset' && target.datasetId === 'mensa')
    )
      setEthWanted(true);
  }, [target]);

  // ---- the time shown: always now (Zurich) ----
  const clock = useZurichClock(true);
  const minute = clock.minute;

  const { response: ethResponse, error: ethError } = useEthRooms(
    rooms || ethWanted,
    null,
  );
  const snapshot = ethResponse?.snapshot ?? null;
  // Right after midnight the snapshot is still yesterday's until the next fetch.
  const dayMismatch = !!snapshot && snapshot.date !== clock.date;
  const roomInfos = useMemo<RoomInfo[]>(
    () =>
      snapshot
        ? snapshot.rooms.map((room) => ({
            room,
            state: dayMismatch
              ? NO_DATA
              : roomStateAt(room, minute, roomFeatures.soonMinutes),
          }))
        : [],
    [snapshot, dayMismatch, minute, roomFeatures.soonMinutes],
  );
  const roomInfoById = useMemo(
    () => new Map(roomInfos.map((i) => [i.room.id, i])),
    [roomInfos],
  );
  /** PolyMaps unit id → ETH room, for drawing; null unless something on the map uses it. */
  const roomsOnPlan = useMemo(() => {
    if (
      !rooms ||
      !ethResponse ||
      !(roomFeatures.occupancy || roomFeatures.labels || roomFeatures.details)
    )
      return null;
    const byUnit = new Map<string, RoomInfo>();
    for (const info of roomInfos)
      for (const place of ethResponse.matches[info.room.id] ?? [])
        byUnit.set(place.unitId, info);
    return byUnit;
  }, [
    rooms,
    ethResponse,
    roomInfos,
    roomFeatures.occupancy,
    roomFeatures.labels,
    roomFeatures.details,
  ]);
  const placedRooms = useMemo(
    () => new Set(Object.keys(ethResponse?.matches ?? {})),
    [ethResponse],
  );
  /** PolyMaps unit id → ETH room id. */
  const ethIdOfUnit = useMemo(() => {
    const out = new Map<string, string>();
    for (const [ethId, places] of Object.entries(ethResponse?.matches ?? {}))
      for (const place of places) out.set(place.unitId, ethId);
    return out;
  }, [ethResponse]);
  /** The ETH rooms some PolyMaps rooms are; guessed from their ids until the room list is in. */
  const ethIdsOf = (unitIds: string[]) => {
    const ids = snapshot
      ? unitIds.map((u) => ethIdOfUnit.get(u))
      : unitIds.map(guessEthId);
    return [...new Set(ids.filter((id): id is string => !!id))];
  };

  // ---- campus datasets (ASVZ sport and mensas in the campus mode; served by the backend) ----
  const { list: datasetMetas } = useDatasetList();
  const enabledDatasets = MODE_DATASETS[mode];
  const datasetAtOf = (meta: DatasetMeta) => datasetAt(meta, null, clock);
  const { states: datasetStates } = useDatasets(
    datasetMetas,
    enabledDatasets,
    datasetAtOf,
  );
  const datasetClock = useMemo<Clock>(
    () => ({
      minute: clock.minute,
      weekday: weekdayOf(clock.date),
      ms: Date.now(),
      live: true,
      label: 'now',
    }),
    [clock.date, clock.minute],
  );
  // Pins only show near the campus areas, so far-off scooters and stops don't clutter the map.
  const areaBoxes = useMemo(
    () =>
      (navigation?.zones ?? [])
        .filter((z) => z.kind === 'area' && z.outline)
        .map((z) => outlineBounds(z.outline!)),
    [navigation],
  );
  const datasetLayers = useMemo(() => {
    const out: { meta: DatasetMeta; items: DatasetItem[] }[] = [];
    for (const meta of datasetMetas ?? []) {
      if (!enabledDatasets.includes(meta.id)) continue;
      const doc = datasetStates[meta.id]?.response?.document;
      if (!doc) continue;
      out.push({
        meta,
        items: doc.items.filter((i) => nearArea(areaBoxes, i.lat, i.lng)),
      });
    }
    return out;
  }, [datasetMetas, datasetStates, enabledDatasets, areaBoxes]);
  // Mensa rooms (datasets/mensa/rooms.json) are drawn on the floor plans.
  const mensaLayer = datasetLayers.find((l) => l.meta.id === 'mensa') ?? null;
  /* Workspaces that are also a mensa get the mensa's color with the mensa
     layer off too (not in the study mode), so the mensa items are fetched
     (once) when the map is zoomed in or something is selected. */
  const lazyMensaItems = useMensaItems(
    mode !== 'study' && (zoom >= MENSA_ZOOM || target !== null),
  );
  const mensaMeta = datasetMetas?.find((m) => m.id === 'mensa') ?? null;
  const mensaItems =
    datasetStates.mensa?.response?.document?.items ?? lazyMensaItems;
  const mensaOfRoom = useMemo(() => {
    const out = new Map<string, MensaRoom>();
    if (!mensaMeta || !mensaItems) return out;
    for (const item of mensaItems)
      for (const roomId of mensaPlace(item)?.rooms ?? [])
        out.set(roomId, {
          mensaId: item.id,
          name: item.name,
          color: mensaMeta.color,
        });
    return out;
  }, [mensaMeta, mensaItems]);
  /** Library id → the mensa it is also. */
  const mensaWorkspaces = useMemo(() => {
    const out = new Map<string, MensaRoom>();
    for (const lib of data?.libraries ?? []) {
      const mensa = lib.rooms
        .map((r) => mensaOfRoom.get(r))
        .find((m) => m !== undefined);
      if (mensa) out.set(lib.id, mensa);
    }
    return out;
  }, [data, mensaOfRoom]);
  /** Rooms drawn as mensa rooms: all of the mensa layer's, plus those of mensa workspaces. */
  const mensaRooms = useMemo(() => {
    const out = new Map<string, MensaRoom>();
    for (const item of mensaLayer?.items ?? [])
      for (const roomId of mensaPlace(item)?.rooms ?? [])
        out.set(roomId, {
          mensaId: item.id,
          name: item.name,
          color: mensaLayer!.meta.color,
        });
    for (const lib of data?.libraries ?? [])
      if (mensaWorkspaces.has(lib.id))
        for (const roomId of lib.rooms) {
          const mensa = mensaOfRoom.get(roomId);
          if (mensa) out.set(roomId, mensa);
        }
    return out;
  }, [mensaLayer, data, mensaWorkspaces, mensaOfRoom]);

  if (loadError)
    return (
      <FullScreenNote>
        <Alert variant="danger" title="Could not load the campus map">
          {loadError}
        </Alert>
      </FullScreenNote>
    );
  if (!data)
    return (
      <FullScreenNote>
        <Text c="dimmed">Loading the campus map…</Text>
      </FullScreenNote>
    );

  // The study mode shows only the workspaces of the bookable study spaces.
  const visible = keepLibraries(
    data,
    (l) => l.enabled && (mode !== 'study' || !!bookable?.has(l.id)),
  );
  const style = styles[theme];
  const roomStyle = style.occupancy;

  const flyTo = (position: { lat: number; lng: number }, z: number) =>
    setFlyTarget({ position, zoom: z, nonce: Date.now() });

  // ---- what is selected, and the tap-twice dashboard ----
  const selection: Selection =
    target?.kind === 'library'
      ? { libraryId: target.id, tableId: target.tableId ?? null, seatId: null }
      : EMPTY_SELECTION;
  const selectedEthRoom = target?.kind === 'room' ? target.id : null;
  const selectedDatasetItem: DatasetSelection | null =
    target?.kind === 'dataset'
      ? { datasetId: target.datasetId, itemId: target.itemId }
      : null;
  const datasetItem = (sel: DatasetSelection) =>
    datasetLayers
      .find((l) => l.meta.id === sel.datasetId)
      ?.items.find((i) => i.id === sel.itemId) ?? null;

  /** A tap on the map selects it and opens its popup. */
  const tap = (next: MapTarget) => {
    setDashboardOpen(true);
    if (sameTarget(target, next)) return;
    setTarget(next);
    if (next.kind === 'library') {
      const lib = data.libraries.find((l) => l.id === next.id);
      if (lib && lib.floor !== null) setFloor(lib.floor);
    } else if (next.kind === 'dataset' && next.datasetId === 'mensa') {
      const item = datasetItem(next);
      const place = item && mensaPlace(item);
      if (place) setFloor(place.floor);
    }
  };
  const clearTarget = () => {
    setTarget(null);
    setDashboardOpen(false);
  };
  const setMode = (next: MapMode) => {
    if (next === mode) return;
    setModeState(next);
    saveMapMode(next);
    clearTarget();
  };

  /* Choosing something from a list in a menu: select it, close the menu and
     fly there, so it shows on the map with its card. */
  const showLibrary = (id: string) => {
    const lib = data.libraries.find((l) => l.id === id);
    if (!lib) return;
    setTarget({ kind: 'library', id });
    setDashboardOpen(false);
    setSheet(null);
    if (lib.floor !== null) setFloor(lib.floor);
    if (lib.outline)
      setFlyTarget({
        position: lib.position,
        zoom: 19,
        bounds: outlineBounds(lib.outline),
        nonce: Date.now(),
      });
    else flyTo(lib.position, lib.rooms.length ? 20 : 19);
  };
  const showEthRoom = (id: string) => {
    setTarget({ kind: 'room', id });
    setDashboardOpen(false);
    setSheet(null);
    const place = ethResponse?.matches[id]?.[0];
    if (place) {
      setFloor(place.floor);
      flyTo({ lat: place.lat, lng: place.lng }, 20);
    }
  };
  // A room opened from a workspace popup has its details with live rooms off too.
  const selectedRoomInfo = selectedEthRoom
    ? (roomInfoById.get(selectedEthRoom) ?? null)
    : null;
  const selectedLibrary =
    target?.kind === 'library'
      ? (visible.libraries.find((l) => l.id === target.id) ?? null)
      : null;
  const selectedItem = selectedDatasetItem
    ? datasetItem(selectedDatasetItem)
    : null;
  const selectedMeta = selectedDatasetItem
    ? (datasetMetas?.find((m) => m.id === selectedDatasetItem.datasetId) ??
      null)
    : null;
  const selectedMensaPlace =
    selectedItem && selectedMeta?.id === 'mensa'
      ? mensaPlace(selectedItem)
      : null;
  // A workspace that is also a mensa shows the mensa's menu too.
  const workspaceMensaId = selectedLibrary
    ? mensaWorkspaces.get(selectedLibrary.id)?.mensaId
    : undefined;
  const selectedWorkspaceMensa = workspaceMensaId
    ? (mensaItems?.find((i) => i.id === workspaceMensaId) ?? null)
    : null;

  const legendNote = !snapshot
    ? ethResponse?.state === 'running'
      ? `Fetching today's bookings from ETH… ${ethResponse.done} / ${ethResponse.total || '?'}`
      : ethError || ethResponse?.error
        ? 'Room data unavailable right now'
        : 'Loading room data…'
    : dayMismatch
      ? "Fetching today's bookings…"
      : null;

  // ---- the card for the current selection ----
  let peek: { title: string; detail: string; dot?: string } | null = null;
  if (target?.kind === 'room' && selectedRoomInfo) {
    const { room, state } = selectedRoomInfo;
    peek = {
      title: room.id,
      detail: `${ROOM_STATUS_LABELS[state.status]}${state.status === 'free' || state.status === 'soon' ? (state.until >= 1440 ? ' for the rest of the day' : ` until ${hhmm(state.until)}`) : ''} · ${room.type}`,
      dot: roomStyle[state.status],
    };
  } else if (selectedLibrary) {
    const occ = occupancyOf(visible, selectedLibrary.id);
    peek = {
      title: selectedLibrary.name,
      detail: `${WORKSPACE_KIND_LABELS[selectedLibrary.kind]} · ${occ.total === 0 ? 'no seats registered' : `${occ.free} of ${occ.total} seats free`}`,
    };
  } else if (selectedItem && selectedMeta) {
    peek = {
      title: `${selectedMeta.glyph} ${selectedItem.name}`,
      detail: selectedItem.subtitle ?? selectedMeta.title,
    };
  }

  const showLegend = rooms && roomFeatures.occupancy;

  return (
    <div className="campus-map relative h-dvh w-full overflow-hidden bg-bg">
      <MapView
        theme={theme}
        data={visible}
        selection={selection}
        flyTarget={flyTarget}
        floorIndex={floorIndex}
        floor={floor}
        onFloorChange={setFloor}
        onSelect={(sel) => {
          if (sel.libraryId)
            tap({
              kind: 'library',
              id: sel.libraryId,
              tableId: sel.tableId ?? undefined,
            });
        }}
        onZoomChange={setZoom}
        minimal={style}
        view3d={view3d ? style.view3d : null}
        navigation={navigation}
        homePositions={homePositions(data.libraries)}
        ethRooms={roomsOnPlan}
        occupancyStyle={rooms && roomFeatures.occupancy ? roomStyle : null}
        roomLabels={rooms && roomFeatures.labels}
        selectedEthRoom={selectedRoomInfo?.room.id ?? null}
        onEthRoomClick={
          rooms && roomFeatures.details
            ? (id) => tap({ kind: 'room', id })
            : null
        }
        mensaRooms={mode === 'study' ? NO_MENSAS : mensaRooms}
        mensaWorkspaces={mode === 'study' ? NO_MENSAS : mensaWorkspaces}
        selectedMensaId={
          selectedDatasetItem?.datasetId === 'mensa'
            ? selectedDatasetItem.itemId
            : null
        }
        onSelectMensa={(itemId) =>
          tap({ kind: 'dataset', datasetId: 'mensa', itemId })
        }
      >
        <ModeControl onOpen={() => setSheet('mode')} />
        <DatasetLayers
          layers={datasetLayers}
          clock={datasetClock}
          selected={selectedDatasetItem}
          onSelect={(sel) => tap({ kind: 'dataset', ...sel })}
        />
      </MapView>

      {/* Top bar: back, title, theme */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-1100 px-3 pt-[calc(--spacing(3)+env(safe-area-inset-top))]">
        <div className="pointer-events-auto flex min-h-13 items-center gap-1 rounded-card border border-border bg-surface pr-1 pl-1 shadow-card">
          <ActionIcon
            component={Link}
            to={paths.home}
            aria-label="Back to study spaces"
          >
            <Icon name="back" />
          </ActionIcon>
          <Title
            order={1}
            className="min-w-0 flex-1 truncate text-title font-bold"
          >
            Campus map
          </Title>
          <ThemeToggle />
        </div>
      </header>

      {/* Bottom: legend, selection card, toolbar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-1100 grid gap-2 px-3 pb-[calc(--spacing(3)+env(safe-area-inset-bottom))]">
        {showLegend && (
          <div className="pointer-events-auto mr-16">
            <OccupancyLegend
              infos={roomInfos}
              colors={roomStyle}
              showColors={roomFeatures.occupancy}
              label={`Now ${hhmm(minute)}`}
              note={legendNote}
            />
          </div>
        )}

        {peek && (
          <div className="pointer-events-auto flex items-center gap-1 rounded-card border border-border bg-surface py-1 pr-1 pl-4 shadow-card">
            <button
              type="button"
              className="grid min-h-13 min-w-0 flex-1 cursor-pointer gap-0.5 border-0 bg-transparent p-0 text-left text-text"
              onClick={() => setDashboardOpen(true)}
            >
              <span className="flex min-w-0 items-center gap-2 font-semibold">
                {peek.dot && (
                  <span
                    aria-hidden="true"
                    className="size-2.5 flex-none rounded-full"
                    style={{ background: peek.dot }}
                  />
                )}
                <span className="truncate">{peek.title}</span>
              </span>
              <span className="truncate text-label text-text-muted">
                {peek.detail}
              </span>
            </button>
            <ActionIcon
              aria-label="Open details"
              onClick={() => setDashboardOpen(true)}
            >
              <Icon name="chevronRight" />
            </ActionIcon>
            <ActionIcon aria-label="Clear selection" onClick={clearTarget}>
              <Icon name="close" />
            </ActionIcon>
          </div>
        )}

        {mode === 'study' && spacesQuery.isError && (
          <div className="pointer-events-auto">
            <Alert variant="danger" title="Couldn't load the study spaces">
              The map shows them once they load again.
            </Alert>
          </div>
        )}

        <nav
          aria-label="Map controls"
          className="pointer-events-auto rounded-card border border-border bg-surface p-1 shadow-card"
        >
          <button
            type="button"
            aria-expanded={sheet === 'workspaces'}
            onClick={() =>
              setSheet(sheet === 'workspaces' ? null : 'workspaces')
            }
            className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-control border-0 bg-transparent px-3 text-body text-text hover:bg-hover"
          >
            <Icon name="search" />
            <span className="truncate">
              {mode === 'study' ? 'Study spaces' : 'Workspaces'}
            </span>
          </button>
        </nav>
      </div>

      {/* Map view: what the map shows */}
      <MapSheet
        opened={sheet === 'mode'}
        onClose={() => setSheet(null)}
        title="Map view"
      >
        <div className="grid gap-4 px-4 py-4">
          <Slider
            className="mx-10 mb-8"
            min={0}
            max={MAP_MODES.length - 1}
            step={1}
            value={MAP_MODES.indexOf(mode)}
            onChange={(i) => setMode(MAP_MODES[i])}
            thumbLabel="Map view"
            marks={MAP_MODES.map((m, i) => ({
              value: i,
              label: MAP_MODE_LABELS[m].label,
            }))}
          />
          <Text size="sm" c="dimmed">
            {MAP_MODE_LABELS[mode].hint}
          </Text>
          <Switch
            label="3D: stack the floors of the building in focus"
            checked={view3d}
            onChange={(e) => setView3d(e.currentTarget.checked)}
          />
          {mode === 'study' && spacesQuery.isError && (
            <Alert variant="danger" title="Couldn't load the study spaces">
              The map shows them once they load again.
            </Alert>
          )}
          <Button variant="secondary" onClick={() => setSheet(null)}>
            Done
          </Button>
        </div>
      </MapSheet>

      <MapSheet
        opened={sheet === 'workspaces'}
        onClose={() => setSheet(null)}
        title={mode === 'study' ? 'Study spaces' : 'Workspaces'}
      >
        <WorkspaceList
          data={visible}
          selectedId={selectedLibrary?.id ?? null}
          levels={floorIndex?.levels ?? []}
          onSelectLibrary={(lib) => showLibrary(lib.id)}
        />
      </MapSheet>

      {/* The popup of what is selected, opened by tapping it on the map */}
      <MapSheet
        opened={dashboardOpen && peek !== null}
        onClose={() => setDashboardOpen(false)}
        title={peek?.title ?? 'Campus'}
      >
        {selectedRoomInfo && (
          <RoomDetails
            info={selectedRoomInfo}
            buildingName={
              snapshot?.buildings[selectedRoomInfo.room.building] ?? null
            }
            minute={minute}
            colors={roomStyle}
            onClose={clearTarget}
            onShowOnMap={
              placedRooms.has(selectedRoomInfo.room.id)
                ? () => showEthRoom(selectedRoomInfo.room.id)
                : null
            }
          />
        )}
        {selectedLibrary && (
          <WorkspaceDetails
            data={visible}
            library={selectedLibrary}
            selection={selection}
            levels={floorIndex?.levels ?? []}
            onSelectTable={(libraryId, tableId) => {
              setTarget({ kind: 'library', id: libraryId, tableId });
              setDashboardOpen(false);
              const t = data.tables.find((x) => x.id === tableId);
              if (t) flyTo(t.position, 21);
            }}
          >
            <RoomPhotos
              roomIds={ethIdsOf(selectedLibrary.rooms)}
              title={selectedLibrary.name}
            />
            {selectedLibrary.rooms.length > 0 && (
              <LiveRooms
                infos={
                  snapshot && !dayMismatch
                    ? ethIdsOf(selectedLibrary.rooms)
                        .map((id) => roomInfoById.get(id))
                        .filter((i): i is RoomInfo => !!i)
                    : []
                }
                colors={roomStyle}
                note={
                  snapshot && !dayMismatch
                    ? null
                    : ethError || ethResponse?.state === 'error'
                      ? 'Room availability is unavailable right now.'
                      : 'Loading room availability…'
                }
                onSelect={(id) => setTarget({ kind: 'room', id })}
              />
            )}
          </WorkspaceDetails>
        )}
        {selectedLibrary && selectedWorkspaceMensa && mensaMeta && (
          <DatasetItemDetails
            meta={mensaMeta}
            item={selectedWorkspaceMensa}
            clock={datasetClock}
          />
        )}
        {selectedItem && selectedMeta && (
          <>
            <DatasetItemDetails
              meta={selectedMeta}
              item={selectedItem}
              clock={datasetClock}
              onClose={clearTarget}
            />
            {selectedMensaPlace && (
              <div className="panel-section">
                <RoomPhotos
                  roomIds={[
                    selectedMensaPlace.room,
                    ...ethIdsOf(selectedMensaPlace.rooms),
                  ]}
                  title={selectedItem.name}
                />
              </div>
            )}
          </>
        )}
      </MapSheet>
    </div>
  );
}

function FullScreenNote({ children }: { children: ReactNode }) {
  return (
    <div className="campus-map grid h-dvh place-items-center bg-bg p-4">
      <div className="grid w-full max-w-phone gap-4">
        {children}
        <Button component={Link} to={paths.home} variant="secondary">
          Back to study spaces
        </Button>
      </div>
    </div>
  );
}
