import { useMemo, useState } from 'react';
import { Alert, Button, Switch, useComputedColorScheme } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { fetchNavigation } from '../../campus-map/data/navigationRepository';
import { defaultNavigation } from '../../campus-map/domain/navigation';
import type { OccupancyData, RoomRef } from '../../campus-map/domain/types';
import type { FloorIndex } from '../../campus-map/floors/floorData';
import { MapView, type FlyTarget } from '../../campus-map/map/MapView';
import {
  DEFAULT_MINIMAL,
  fetchStandardStyles,
} from '../../campus-map/map/minimalStyle';
import { EMPTY_SELECTION } from '../../campus-map/state';
import {
  alignedFloor,
  alignFloorIndex,
  buildGroups,
  facilityOfLevel,
  floorLift,
  letterOffsets,
} from '../../campus-map/map/buildingGroups';
import '../../campus-map/campus-map.css';
const NO_MENSA = new Map();
export function AdminRoomMap({
  data,
  index,
  floor,
  target,
  selectedId,
  levelId,
  onPick,
  onFloorChange,
}: {
  data: OccupancyData;
  index: FloorIndex;
  floor: number;
  target: FlyTarget | null;
  selectedId: string | null;
  levelId: string;
  onPick: (room: RoomRef) => void;
  onFloorChange: (floor: number) => void;
}) {
  const theme = useComputedColorScheme('dark');
  const [stacked, setStacked] = useState(true);
  const facilityId = facilityOfLevel(levelId);
  const offsets = useMemo(() => letterOffsets(index), [index]);
  const displayIndex = useMemo(
    () => alignFloorIndex(index, offsets),
    [index, offsets],
  );
  const displayFloor = alignedFloor(offsets, facilityId, floor);
  const groups = useMemo(() => buildGroups(displayIndex), [displayIndex]);
  const styles = useQuery({
    queryKey: ['campus-map-style'],
    queryFn: fetchStandardStyles,
  });
  const navigation = useQuery({
    queryKey: ['campus-map-navigation'],
    queryFn: fetchNavigation,
  });
  const visible = useMemo(
    () => ({
      ...data,
      libraries: data.libraries
        .filter((l) => l.enabled)
        .map((l) =>
          l.floor === null
            ? l
            : { ...l, floor: alignedFloor(offsets, l.facilityId, l.floor) },
        ),
      tables: [],
      seats: [],
    }),
    [data, offsets],
  );
  const minimal = (styles.data || DEFAULT_MINIMAL)[theme];
  const displayTarget = useMemo(() => {
    if (!target) return null;
    const group = [...groups.values()].find((g) =>
      g.facilityIds.has(facilityId),
    );
    const lift =
      stacked && group
        ? floorLift(group, displayFloor, minimal.view3d.spacing)
        : 0;
    return {
      ...target,
      position: { ...target.position, lat: target.position.lat + lift },
      ...(target.bounds
        ? {
            bounds: target.bounds.map(([lat, lng]) => [lat + lift, lng]) as [
              [number, number],
              [number, number],
            ],
          }
        : {}),
    };
  }, [
    target,
    groups,
    facilityId,
    stacked,
    displayFloor,
    minimal.view3d.spacing,
  ]);
  const start = useMemo(
    () =>
      displayTarget?.bounds
        ? displayTarget.bounds.map(([lat, lng]) => ({ lat, lng }))
        : displayTarget
          ? [displayTarget.position]
          : [],
    [displayTarget],
  );
  return (
    <>
      {(styles.isError || navigation.isError) && (
        <Alert>
          Map settings could not be loaded.{' '}
          <Button
            variant="quiet"
            onClick={() => {
              void styles.refetch();
              void navigation.refetch();
            }}
          >
            Retry map settings
          </Button>
        </Alert>
      )}
      <div className="flex justify-end">
        <Switch
          label="3D floors"
          checked={stacked}
          onChange={(event) => setStacked(event.currentTarget.checked)}
        />
      </div>
      <div className="admin-room-map" aria-label="Campus room map">
        <MapView
          theme={theme}
          data={visible}
          selection={EMPTY_SELECTION}
          flyTarget={displayTarget}
          floorIndex={displayIndex}
          floor={displayFloor}
          onFloorChange={(next) => {
            const nativeFloor = next - (offsets.get(facilityId) || 0);
            if (
              nativeFloor !== floor &&
              index.levels.some(
                (l) => l.facilityId === facilityId && l.floor === nativeFloor,
              )
            )
              onFloorChange(nativeFloor);
          }}
          onSelect={() => {}}
          onZoomChange={() => {}}
          minimal={minimal}
          navigation={navigation.data ?? defaultNavigation(data.libraries)}
          homePositions={start}
          ethRooms={null}
          occupancyStyle={null}
          roomLabels={false}
          selectedEthRoom={null}
          onEthRoomClick={null}
          mensaRooms={NO_MENSA}
          selectedMensaId={null}
          onSelectMensa={() => {}}
          view3d={stacked ? minimal.view3d : null}
          roomPicker={{ selectedId, levelId, onPick }}
        />
      </div>
    </>
  );
}
