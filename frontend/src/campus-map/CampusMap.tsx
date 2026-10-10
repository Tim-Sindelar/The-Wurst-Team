import {
  ActionIcon,
  Alert,
  Button,
  SegmentedControl,
  Switch,
  Text,
  Title,
  useComputedColorScheme,
} from '@mantine/core';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LatLngBoundsLiteral } from 'leaflet';
import { Link } from 'react-router';
import { cx } from '../components/cx';
import { Icon, type IconName } from '../components/Icon';
import { ThemeToggle } from '../components/ThemeToggle';
import { paths } from '../routes';
import { FreeRooms } from './components/FreeRooms';
import { OccupancyLegend } from './components/OccupancyLegend';
import { RoomPanel } from './components/RoomControls';
import { RoomDetails } from './components/RoomDetails';
import { TimePanel, timeLabel } from './components/TimeControls';
import { UzhPanel } from './components/UzhPanel';
import { ViewerPanel } from './components/ViewerPanel';
import { repository } from './data/repository';
import { fetchNavigation } from './data/navigationRepository';
import { useDebounced } from './data/useDebounced';
import { useEthRooms, useZurichClock } from './data/useEthRooms';
import { DatasetPanel } from './datasets/DatasetControls';
import { DatasetLayers, type DatasetSelection } from './datasets/DatasetLayers';
import { DatasetSidebar } from './datasets/DatasetSidebar';
import type { Clock } from './datasets/present';
import type { DatasetItem, DatasetMeta, MensaDetails } from './datasets/types';
import {
  loadDatasetSettings,
  saveDatasetSettings,
  useDatasetList,
  useDatasets,
  type DatasetSettings,
} from './datasets/useDatasets';
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
import {
  datasetAt,
  dayLabel,
  weekdayOf,
  zurichInstant,
  type ZurichTime,
} from './domain/viewTime';
import { loadFloorIndex, type FloorIndex } from './floors/floorData';
import type { MensaRoom } from './map/FloorLayer';
import { MapView, type FlyTarget } from './map/MapView';
import { outlineBounds } from './map/geo';
import {
  DEFAULT_MINIMAL,
  fetchStandardStyles,
  type MinimalStyles,
  type RenderMode,
} from './map/minimalStyle';
import { MapSheet } from './MapSheet';
import {
  loadRoomFeatures,
  saveRoomFeatures,
  type RoomFeatures,
  type RoomInfo,
} from './roomFeatures';
import { readStored, writeStored } from './storage';
import { sameTarget, type MapTarget } from './target';
import { EMPTY_SELECTION, type Selection } from './state';

const NO_DATA: RoomState = {
  status: 'unknown',
  current: null,
  next: null,
  until: 1440,
};

type Sheet = 'time' | 'rooms' | 'datasets' | 'map' | null;

/** Only workspaces switched on in the map editor are shown. */
function filterEnabled(data: OccupancyData): OccupancyData {
  const libraries = data.libraries.filter((l) => l.enabled);
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
   imported into the backend). Tapping a room, workspace or pin selects it and shows a
   short card; tapping it again opens the dashboard sheet with everything the
   preview's side panel showed. */
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

  const [renderMode, setRenderModeState] = useState<RenderMode>(() =>
    readStored('render-mode') === 'detailed' ? 'detailed' : 'minimal',
  );
  const setRenderMode = (mode: RenderMode) => {
    setRenderModeState(mode);
    writeStored('render-mode', mode);
  };
  const [view3d, setView3dState] = useState(
    () => readStored('view-3d') === '1',
  );
  const setView3d = (on: boolean) => {
    setView3dState(on);
    writeStored('view-3d', on ? '1' : '0');
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

  // ---- live room mode (ETH room bookings) ----
  const [roomFeatures, setRoomFeaturesState] =
    useState<RoomFeatures>(loadRoomFeatures);
  const setRoomFeatures = (f: RoomFeatures) => {
    setRoomFeaturesState(f);
    saveRoomFeatures(f);
  };
  const rooms = roomFeatures.enabled;

  // ---- the time shown: now, or a date and time picked (Zurich) ----
  const clock = useZurichClock(true);
  const [pickedTime, setPickedTime] = useState<ZurichTime | null>(null);
  const live = pickedTime === null;
  const view = pickedTime ?? clock;
  const minute = view.minute;
  const viewLabel = live ? 'now' : timeLabel(view, clock.date);

  const { response: ethResponse, error: ethError } = useEthRooms(
    rooms,
    view.date === clock.date ? null : view.date,
  );
  const snapshot = ethResponse?.snapshot ?? null;
  // Right after midnight the snapshot is still yesterday's until the next fetch.
  const dayMismatch = !!snapshot && snapshot.date !== view.date;
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

  // ---- campus datasets (mensas, transport, sport, weather, ...; served by the backend) ----
  const { list: datasetMetas, error: datasetListError } = useDatasetList();
  const [datasetSettings, setDatasetSettingsState] =
    useState<DatasetSettings>(loadDatasetSettings);
  const setDatasetSettings = (s: DatasetSettings) => {
    setDatasetSettingsState(s);
    saveDatasetSettings(s);
  };
  // Datasets are fetched for a picked time once it stops changing.
  const datasetTime = useDebounced(pickedTime, 500);
  const datasetAtOf = (meta: DatasetMeta) =>
    datasetAt(meta, datasetTime, clock);
  const { states: datasetStates, reload: reloadDataset } = useDatasets(
    datasetMetas,
    datasetSettings.enabled,
    datasetAtOf,
  );
  const datasetClock = useMemo<Clock>(
    () => ({
      minute: view.minute,
      weekday: weekdayOf(view.date),
      ms: live ? Date.now() : zurichInstant(view),
      live,
      label: viewLabel,
    }),
    [view.date, view.minute, live, viewLabel],
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
      if (!datasetSettings.enabled.includes(meta.id)) continue;
      const doc = datasetStates[meta.id]?.response?.document;
      if (!doc) continue;
      const hidden = new Set(datasetSettings.hiddenCategories[meta.id] ?? []);
      out.push({
        meta,
        items: doc.items.filter(
          (i) => !hidden.has(i.category) && nearArea(areaBoxes, i.lat, i.lng),
        ),
      });
    }
    return out;
  }, [datasetMetas, datasetStates, datasetSettings, areaBoxes]);
  // Mensa rooms (datasets/mensa/rooms.json) are drawn on the floor plans.
  const mensaLayer = datasetLayers.find((l) => l.meta.id === 'mensa') ?? null;
  const mensaRooms = useMemo(() => {
    const out = new Map<string, MensaRoom>();
    if (!mensaLayer) return out;
    for (const item of mensaLayer.items) {
      for (const roomId of mensaPlace(item)?.rooms ?? []) {
        out.set(roomId, {
          mensaId: item.id,
          name: item.name,
          color: mensaLayer.meta.color,
        });
      }
    }
    return out;
  }, [mensaLayer]);
  const datasetsBusy = Object.values(datasetStates).some(
    (s) => s.loading || s.response?.refreshing,
  );

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

  const visible = filterEnabled(data);
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

  /** A tap on the map: the first selects, a second on the same thing opens the dashboard. */
  const tap = (next: MapTarget) => {
    if (sameTarget(target, next)) {
      setDashboardOpen(true);
      return;
    }
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

  /* Choosing something from a list in the dashboard: select it, close the
     dashboard and fly there, so it shows on the map with its card. */
  const showLibrary = (id: string) => {
    const lib = data.libraries.find((l) => l.id === id);
    if (!lib) return;
    setTarget({ kind: 'library', id });
    setDashboardOpen(false);
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
    const place = ethResponse?.matches[id]?.[0];
    if (place) {
      setFloor(place.floor);
      flyTo({ lat: place.lat, lng: place.lng }, 20);
    }
  };
  const showDatasetItem = (sel: DatasetSelection, item: DatasetItem) => {
    setTarget({ kind: 'dataset', ...sel });
    setDashboardOpen(false);
    const place = sel.datasetId === 'mensa' ? mensaPlace(item) : null;
    if (place) setFloor(place.floor);
    flyTo({ lat: item.lat, lng: item.lng }, Math.max(zoom, place ? 19 : 17));
  };

  const selectedRoomInfo =
    rooms && selectedEthRoom
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

  const bookingsOf =
    view.date === clock.date
      ? "today's bookings"
      : `the bookings of ${dayLabel(view.date, clock.date)}`;
  const legendNote = !snapshot
    ? ethResponse?.state === 'running'
      ? `Fetching ${bookingsOf} from ETH… ${ethResponse.done} / ${ethResponse.total || '?'}`
      : ethResponse?.state === 'error' && !live
        ? ethResponse.error
        : ethError || ethResponse?.error
          ? 'Room data unavailable, see Rooms'
          : 'Loading room data…'
    : dayMismatch
      ? `Fetching ${bookingsOf}…`
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

  const toolbar: {
    id: Exclude<Sheet, null>;
    icon: IconName;
    label: string;
    active: boolean;
    busy?: boolean;
  }[] = [
    {
      id: 'rooms',
      icon: 'door',
      label: 'Live rooms',
      active: rooms,
      busy: ethResponse?.state === 'running',
    },
    {
      id: 'datasets',
      icon: 'pin',
      label: datasetSettings.enabled.length
        ? `Campus data (${datasetSettings.enabled.length})`
        : 'Campus data',
      active: datasetSettings.enabled.length > 0,
      busy: datasetsBusy,
    },
    // The time picker is a submenu of the map options.
    {
      id: 'map',
      icon: 'layers',
      label: live ? 'Map' : timeLabel(view, clock.date),
      active: view3d || !live,
    },
  ];

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
        minimal={renderMode === 'minimal' ? style : null}
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
        mensaRooms={mensaRooms}
        selectedMensaId={
          selectedDatasetItem?.datasetId === 'mensa'
            ? selectedDatasetItem.itemId
            : null
        }
        onSelectMensa={(itemId) =>
          tap({ kind: 'dataset', datasetId: 'mensa', itemId })
        }
      >
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
              label={live ? `Now ${hhmm(minute)}` : timeLabel(view, clock.date)}
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
                {peek.detail} · tap again for details
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

        <nav
          aria-label="Map controls"
          className="pointer-events-auto grid grid-cols-3 gap-1 rounded-card border border-border bg-surface p-1 shadow-card"
        >
          {toolbar.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-expanded={sheet === item.id}
              onClick={() => setSheet(sheet === item.id ? null : item.id)}
              className={cx(
                'relative flex min-h-14 min-w-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-control border-0 bg-transparent px-1 text-label text-text-muted hover:bg-hover',
                item.active && 'bg-surface-2 text-text',
              )}
            >
              <Icon name={item.icon} />
              <span className="max-w-full truncate">{item.label}</span>
              {(item.active || item.busy) && (
                <span
                  aria-hidden="true"
                  className={cx(
                    'live-dot absolute top-2 right-[calc(50%-18px)]',
                    item.active && 'is-on',
                    item.busy && 'is-busy',
                  )}
                />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Settings sheets (the preview's map overlay panels) */}
      <MapSheet
        opened={sheet === 'time'}
        onClose={() => setSheet(null)}
        onBack={() => setSheet('map')}
        title="Date and time"
      >
        <TimePanel
          view={pickedTime}
          now={clock}
          onChange={setPickedTime}
          metas={datasetMetas}
          enabledDatasets={datasetSettings.enabled}
          rooms={rooms}
          roomWindow={ethResponse?.window ?? null}
        />
      </MapSheet>

      <MapSheet
        opened={sheet === 'rooms'}
        onClose={() => setSheet(null)}
        title="Live rooms"
      >
        <div className="border-b border-border px-4 py-3">
          <Switch
            label="Show ETH room bookings on the map"
            checked={rooms}
            onChange={(e) =>
              setRoomFeatures({
                ...roomFeatures,
                enabled: e.currentTarget.checked,
              })
            }
          />
        </div>
        {rooms ? (
          <RoomPanel
            features={roomFeatures}
            onChange={setRoomFeatures}
            response={ethResponse}
            error={ethError}
            floorPlans={floorIndex !== null}
          />
        ) : (
          <p className="note px-4 py-3">
            Colors the lecture and seminar rooms by today's bookings: free,
            booked soon, in use or closed. Tap a room for its schedule.
          </p>
        )}
      </MapSheet>

      <MapSheet
        opened={sheet === 'datasets'}
        onClose={() => setSheet(null)}
        title="Campus data"
      >
        <DatasetPanel
          metas={datasetMetas}
          listError={datasetListError}
          settings={datasetSettings}
          onChange={setDatasetSettings}
          states={datasetStates}
          onReload={reloadDataset}
          picked={live ? null : viewLabel}
        />
      </MapSheet>

      <MapSheet
        opened={sheet === 'map'}
        onClose={() => setSheet(null)}
        title="Map"
      >
        <button
          type="button"
          onClick={() => setSheet('time')}
          className="flex min-h-14 w-full cursor-pointer items-center gap-3 border-0 border-b border-border bg-transparent px-4 text-left text-text hover:bg-hover"
        >
          <Icon name="clock" />
          <span className="grid min-w-0 flex-1">
            <span className="font-semibold">Date and time</span>
            <span className="truncate text-label text-text-muted">
              {live ? 'Now' : timeLabel(view, clock.date)}
            </span>
          </span>
          <Icon name="chevronRight" />
        </button>
        <div className="grid gap-4 px-4 py-4">
          <div className="grid gap-2">
            <Text size="sm" c="dimmed">
              Floor plans
            </Text>
            <SegmentedControl
              fullWidth
              value={renderMode}
              onChange={(v) => setRenderMode(v as RenderMode)}
              data={[
                { value: 'minimal', label: 'Simple' },
                { value: 'detailed', label: 'Detailed' },
              ]}
            />
          </div>
          <Switch
            label="3D: stack the floors of the building in focus"
            checked={view3d}
            onChange={(e) => setView3d(e.currentTarget.checked)}
          />
          <Text size="sm" c="dimmed">
            Switch the base map (clean, streets, satellite) with the layers
            button on the map. Pinch to zoom; the house button shows both
            campuses again.
          </Text>
          <Button variant="secondary" onClick={() => setSheet(null)}>
            Done
          </Button>
        </div>
      </MapSheet>

      {/* The dashboard: the preview's side panel, opened by tapping a selection twice */}
      <MapSheet
        tall
        opened={dashboardOpen}
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
        {target?.kind === 'library' && (
          <ViewerPanel
            data={visible}
            selection={selection}
            onSelectLibrary={(lib) => showLibrary(lib.id)}
            onSelectTable={(libraryId, tableId) => {
              setTarget({ kind: 'library', id: libraryId, tableId });
              setDashboardOpen(false);
              const t = data.tables.find((x) => x.id === tableId);
              if (t) flyTo(t.position, 21);
            }}
          />
        )}
        {datasetLayers.length > 0 && (
          <DatasetSidebar
            layers={datasetLayers}
            selected={selectedDatasetItem}
            clock={datasetClock}
            onSelect={showDatasetItem}
            onClose={clearTarget}
          />
        )}
        {rooms && roomFeatures.freeList && snapshot && !dayMismatch && (
          <FreeRooms
            infos={roomInfos}
            minute={minute}
            when={live ? 'now' : `at ${viewLabel}`}
            colors={roomStyle}
            onMap={placedRooms}
            selectedId={selectedRoomInfo?.room.id ?? null}
            onSelect={showEthRoom}
          />
        )}
        {rooms && roomFeatures.uzh && (
          <UzhPanel picked={live ? null : viewLabel} />
        )}
        {target?.kind !== 'library' && (
          <ViewerPanel
            data={visible}
            selection={EMPTY_SELECTION}
            onSelectLibrary={(lib) => showLibrary(lib.id)}
            onSelectTable={() => {}}
          />
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
