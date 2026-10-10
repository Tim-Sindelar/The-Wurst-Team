import { lazy, Suspense, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  Alert,
  Button,
  Card,
  NativeSelect,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  loadFloorIndex,
  loadLevel,
  loadRoomOutline,
  roomName,
} from '../../campus-map/floors/floorData';
import { assertOccupancyData } from '../../campus-map/domain/validate';
import { outlineBounds } from '../../campus-map/map/geo';
import { Icon } from '../../components/Icon';
import * as api from '../../api/generated';
import * as q from '../../api/generated/@tanstack/react-query.gen';
import { AdminFeedback } from './AdminFeedback';
import { searchRooms } from './roomSearch';
const AdminRoomMap = lazy(() =>
  import('./AdminRoomMap').then((module) => ({ default: module.AdminRoomMap })),
);
import { adminHeaders, errorMessage, useAdminAction } from './useAdminAction';
import { projectRoom, documentFor } from './layoutDocument';
export function AdminNewSpacePage({
  existingSpaceId,
  existingMapRoomId,
}: {
  existingSpaceId?: string;
  existingMapRoomId?: string;
}) {
  const action = useAdminAction(),
    navigate = useNavigate();
  const index = useQuery({
    queryKey: ['campus-floor-index'],
    queryFn: loadFloorIndex,
    staleTime: Infinity,
  });
  const [facility, setFacility] = useState(
    existingMapRoomId?.split('.').slice(0, 2).join('.') || 'ETH.HG',
  );
  const [level, setLevel] = useState(
    existingMapRoomId?.split('.').slice(0, 3).join('.') || 'ETH.HG.E',
  );
  const [picked, setPicked] = useState<string | null>(
    existingMapRoomId || null,
  );
  const [search, setSearch] = useState(
    existingMapRoomId ? roomName(existingMapRoomId) : '',
  );
  const [activeResult, setActiveResult] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [timezone, setTimezone] = useState('Europe/Zurich');
  const [nonce, setNonce] = useState(0);
  const floor = useQuery({
    queryKey: ['campus-floor', level],
    queryFn: () => loadLevel(level),
    enabled: !!level,
    staleTime: Infinity,
  });
  const outline = useQuery({
    queryKey: ['campus-room-outline', picked],
    queryFn: () => loadRoomOutline(picked!),
    enabled: !!picked,
    staleTime: Infinity,
    retry: false,
  });
  const workspaces = useQuery({
    ...q.getMapWorkspacesOptions(),
    select: assertOccupancyData,
  });
  const spaces = useQuery(q.adminListSpacesOptions({ headers: adminHeaders }));
  const info = index.data?.levels.find((l) => l.id === level);
  const levels =
    index.data?.levels.filter((l) => l.facilityId === facility) || [];
  const registered = spaces.data?.spaces.find(
    (s) => s.map_room_id === picked && s.id !== existingSpaceId,
  );
  const usedRooms = new Set(
    spaces.data?.spaces
      .filter((s) => s.id !== existingSpaceId)
      .map((s) => s.map_room_id),
  );
  // An empty search lists the selected floor; a typed one searches every building.
  const term = search.trim();
  const found = useQuery({
    ...q.searchMapRoomsOptions({ query: { q: term } }),
    enabled: !!term && !picked && !existingMapRoomId,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
  const results = term ? found : floor;
  const matches = term
    ? found.data || []
    : searchRooms(
        (floor.data?.rooms || []).filter(
          (r) => !existingMapRoomId || r.id === existingMapRoomId,
        ),
        '',
        (r) => roomName(r.id),
      ).slice(0, 12);
  const target = useMemo(() => {
    const bounds =
      outline.data && picked
        ? outlineBounds(outline.data)
        : info
          ? ([
              [info.bbox[1], info.bbox[0]],
              [info.bbox[3], info.bbox[2]],
            ] as [[number, number], [number, number]])
          : null;
    if (!bounds) return null;
    return {
      ...(outline.data && picked ? { bounds } : {}),
      position: {
        lat: (bounds[0][0] + bounds[1][0]) / 2,
        lng: (bounds[0][1] + bounds[1][1]) / 2,
      },
      zoom: 18.25,
      nonce,
    };
  }, [outline.data, picked, info, nonce]);
  const geometry = useMemo(() => {
    if (!picked || !outline.data || !info) return null;
    try {
      return {
        room: projectRoom(
          {
            id: picked,
            name: roomName(picked),
            levelId: info.id,
            facilityId: info.facilityId,
            floor: info.floor,
            workspaceId: workspaces.data?.libraries.find((w) =>
              w.rooms.includes(picked),
            )?.id,
          },
          outline.data,
        ),
        error: null,
      };
    } catch (e) {
      return { room: null, error: errorMessage(e) };
    }
  }, [picked, outline.data, info, workspaces.data]);
  function clearSelection() {
    setPicked(null);
    setSearch('');
    setActiveResult(0);
  }
  function choose(room: { id: string }) {
    if (existingMapRoomId && room.id !== existingMapRoomId) return;
    setFacility(room.id.split('.').slice(0, 2).join('.'));
    setLevel(room.id.split('.').slice(0, 3).join('.'));
    setPicked(room.id);
    setSearch(roomName(room.id));
    setNonce((n) => n + 1);
    setSearchOpen(false);
  }
  async function create() {
    if (!picked || !geometry?.room || registered || !spaces.data) return;
    const room = geometry.room;
    await action.run(async () => {
      const body = {
        name: roomName(picked),
        timezone,
        layout: documentFor(room, []) as unknown as Record<string, unknown>,
      };
      const result = existingSpaceId
        ? await api.adminUpdateSpace({
            path: { space_id: existingSpaceId },
            headers: adminHeaders,
            body,
            throwOnError: true,
          })
        : await api.adminCreateSpace({
            headers: adminHeaders,
            body: { ...body, map_room_id: picked },
            throwOnError: true,
          });
      navigate('/admin/spaces/' + result.data.space.id + '/layout');
    }, 'Study place created.');
  }
  return (
    <div className="admin-page">
      {!existingSpaceId && (
        <Link to="/admin" className="admin-crumb">
          <Icon name="back" size="sm" />
          Spaces
        </Link>
      )}
      <header className="admin-page-header">
        <div>
          <Title order={existingSpaceId ? 2 : 1}>
            {existingSpaceId ? 'Link a room border' : 'Add space'}
          </Title>
          <Text c="dimmed">
            Choose a room, then arrange its tables and seats.
          </Text>
        </div>
      </header>
      <div className="admin-create-grid">
        <Card className="admin-room-picker grid gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Title order={2}>Select a room</Title>
            <Text size="sm" c="dimmed">
              {info
                ? info.facilityId.replace('ETH.', '') + ' · Floor ' + info.label
                : 'Campus map'}
            </Text>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NativeSelect
              label="Building"
              disabled={!!existingSpaceId || !index.data}
              data={
                index.data?.facilities.map((f) => ({
                  value: f.id,
                  label: f.name,
                })) || []
              }
              value={facility}
              onChange={(e) => {
                const id = e.currentTarget.value;
                setFacility(id);
                setLevel(
                  index.data?.levels.find(
                    (l) => l.facilityId === id && l.floor === 0,
                  )?.id ||
                    index.data?.levels.find((l) => l.facilityId === id)?.id ||
                    '',
                );
                clearSelection();
                setNonce((n) => n + 1);
              }}
            />
            <NativeSelect
              label="Floor"
              disabled={!!existingSpaceId || !index.data}
              data={levels.map((l) => ({ value: l.id, label: l.label }))}
              value={level}
              onChange={(e) => {
                setLevel(e.currentTarget.value);
                clearSelection();
                setNonce((n) => n + 1);
              }}
            />
          </div>
          {index.isPending || workspaces.isPending ? (
            <Text>Loading campus map…</Text>
          ) : index.isError || workspaces.isError ? (
            <Alert variant="danger">
              The campus map could not be loaded.{' '}
              <Button
                variant="quiet"
                onClick={() => {
                  void index.refetch();
                  void workspaces.refetch();
                }}
              >
                Retry campus map
              </Button>
            </Alert>
          ) : (
            <Suspense fallback={<Text>Loading campus map…</Text>}>
              <AdminRoomMap
                data={workspaces.data}
                index={index.data}
                floor={info?.floor ?? 0}
                target={target}
                selectedId={picked}
                levelId={level}
                onPick={choose}
                onFloorChange={(n) => {
                  setLevel(levels.find((l) => l.floor === n)?.id || '');
                  clearSelection();
                  setNonce((v) => v + 1);
                }}
              />
            </Suspense>
          )}
          <Text size="sm" c="dimmed" role="status">
            {picked
              ? outline.isFetching
                ? 'Loading ' + roomName(picked) + ' outline…'
                : geometry?.room
                  ? roomName(picked) +
                    ' selected · ' +
                    geometry.room.measurements.widthMeters.toFixed(1) +
                    ' × ' +
                    geometry.room.measurements.heightMeters.toFixed(1) +
                    ' m'
                  : roomName(picked) + ' selected'
              : 'No room selected.'}
          </Text>
        </Card>
        <form
          className="admin-form"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Title order={2}>Space details</Title>
          <div
            className="admin-room-search grid gap-2"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget))
                setSearchOpen(false);
            }}
          >
            <TextInput
              type="search"
              label="Search rooms"
              placeholder="Search room number or type"
              leftSection={<Icon name="search" />}
              value={search}
              disabled={!!existingMapRoomId}
              autoComplete="off"
              aria-controls="room-search-results"
              aria-expanded={searchOpen && !picked && matches.length > 0}
              onFocus={() => {
                if (!picked) setSearchOpen(true);
              }}
              aria-activedescendant={
                !picked && matches[activeResult]
                  ? 'room-result-' + matches[activeResult].id
                  : undefined
              }
              onChange={(e) => {
                setSearch(e.currentTarget.value);
                setSearchOpen(true);
                setPicked(null);
                setActiveResult(0);
              }}
              onKeyDown={(e) => {
                if (picked || !matches.length) return;
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActiveResult(
                    (v) =>
                      (v + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) %
                      matches.length,
                  );
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  choose(matches[activeResult] || matches[0]);
                }
              }}
            />
            {!picked && searchOpen && (
              <div
                id="room-search-results"
                className="admin-room-results"
                role="listbox"
                aria-label="Matching rooms"
              >
                {results.isPending ? (
                  <Text size="sm">Loading rooms…</Text>
                ) : results.isError ? (
                  <Alert variant="danger">
                    Room list unavailable.{' '}
                    <Button
                      variant="quiet"
                      onClick={() => void results.refetch()}
                    >
                      Retry rooms
                    </Button>
                  </Alert>
                ) : (
                  matches.map((r) => (
                    <button
                      key={r.id}
                      id={'room-result-' + r.id}
                      type="button"
                      role="option"
                      className="admin-room-choice"
                      aria-selected={matches[activeResult]?.id === r.id}
                      onClick={() => choose(r)}
                    >
                      <strong>{roomName(r.id)}</strong>
                      <span className="text-small text-text-muted">
                        {usedRooms.has(r.id)
                          ? 'Already registered'
                          : r.use +
                            (r.area ? ' · ' + Math.round(r.area) + ' m²' : '')}
                      </span>
                    </button>
                  ))
                )}
                {!results.isPending && !results.isError && !matches.length && (
                  <Text size="sm" c="dimmed">
                    {term ? 'No matching rooms.' : 'No rooms on this floor.'}
                  </Text>
                )}
              </div>
            )}
            <Text size="sm" c="dimmed">
              Search rooms in every building, or select one on the map.
            </Text>
            {picked && !existingMapRoomId && (
              <Button variant="quiet" onClick={clearSelection}>
                Choose another room
              </Button>
            )}
          </div>
          <NativeSelect
            label="Time zone"
            data={['Europe/Zurich', 'Europe/Berlin', 'UTC']}
            value={timezone}
            onChange={(e) => setTimezone(e.currentTarget.value)}
          />
          <Text size="sm" c="dimmed">
            Next, place tables, seats, windows and doors inside the room
            boundary.
          </Text>
          {(outline.isError || geometry?.error) && (
            <Alert variant="danger">
              {geometry?.error || 'The room outline could not be loaded.'}
              {outline.isError && (
                <Button variant="quiet" onClick={() => void outline.refetch()}>
                  Retry outline
                </Button>
              )}
            </Alert>
          )}
          {registered && (
            <Alert>
              This room is already registered
              {registered.is_archived
                ? ' and was deleted. Restore it from Spaces.'
                : '.'}
              <Button
                variant="quiet"
                component={Link}
                to={'/admin/spaces/' + registered.id + '/settings'}
              >
                {registered.is_archived
                  ? 'Restore study place'
                  : 'Manage study place'}
              </Button>
            </Alert>
          )}
          {spaces.isError && (
            <Alert variant="danger">
              Existing spaces could not be checked.{' '}
              <Button variant="quiet" onClick={() => void spaces.refetch()}>
                Retry
              </Button>
            </Alert>
          )}
          <div className="admin-form-actions">
            <Button variant="secondary" component={Link} to="/admin">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !geometry?.room ||
                outline.isFetching ||
                action.busy ||
                !!registered ||
                !spaces.data
              }
            >
              {action.busy
                ? 'Creating…'
                : existingSpaceId
                  ? 'Link room and edit layout'
                  : 'Create space'}
            </Button>
          </div>
          <AdminFeedback action={action} />
        </form>
      </div>
    </div>
  );
}
