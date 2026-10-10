import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  Alert,
  Button,
  NativeSelect,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, Polygon, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  loadFloorIndex,
  loadLevel,
  roomName,
  type Room,
} from '../../campus-map/floors/floorData';
import * as api from '../../api/generated';
import * as q from '../../api/generated/@tanstack/react-query.gen';
import { AdminFeedback } from './AdminFeedback';
import { adminHeaders, errorMessage, useAdminAction } from './useAdminAction';
import { projectRoom, documentFor } from './layoutDocument';
function FitFloor({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length) map.fitBounds(points, { padding: [20, 20] });
  }, [map, points]);
  return null;
}
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
    queryKey: ['admin-floor-index'],
    queryFn: loadFloorIndex,
    staleTime: Infinity,
  });
  const [facility, setFacility] = useState(
      existingMapRoomId?.split('.').slice(0, 2).join('.') || 'ETH.HG',
    ),
    [level, setLevel] = useState(
      existingMapRoomId?.split('.').slice(0, 3).join('.') || 'ETH.HG.E',
    ),
    [search, setSearch] = useState(''),
    [picked, setPicked] = useState<Room | null>(null),
    [timezone, setTimezone] = useState('Europe/Zurich');
  const floor = useQuery({
    queryKey: ['admin-floor', level],
    queryFn: () => loadLevel(level),
    enabled: !!level,
    staleTime: Infinity,
  });
  useEffect(() => {
    if (existingMapRoomId && floor.data)
      setPicked(
        floor.data.rooms.find((r) => r.id === existingMapRoomId) || null,
      );
  }, [existingMapRoomId, floor.data]);
  const workspaces = useQuery(q.getMapWorkspacesOptions());
  const spaces = useQuery(q.adminListSpacesOptions({ headers: adminHeaders }));
  const levels =
    index.data?.levels.filter((l) => l.facilityId === facility) || [];
  const rooms =
    floor.data?.rooms.filter(
      (r) =>
        (!existingMapRoomId || r.id === existingMapRoomId) &&
        (roomName(r.id) + ' ' + r.use)
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) || [];
  const points =
    floor.data?.rooms.flatMap((r) => r.rings.flatMap((poly) => poly.flat())) ||
    [];
  async function create() {
    if (!picked) return;
    const info = index.data?.levels.find((l) => l.id === level);
    if (!info) return;
    let room;
    try {
      room = projectRoom(
        {
          id: picked.id,
          name: roomName(picked.id),
          levelId: level,
          facilityId: facility,
          floor: info.floor,
          workspaceId: workspaces.data?.libraries.find((w) =>
            w.rooms.includes(picked.id),
          )?.id,
        },
        {
          type: 'MultiPolygon',
          coordinates: picked.rings.map((poly) =>
            poly.map((ring) => {
              const pairs = ring.map(([lat, lng]) => [lng, lat]);
              if (pairs.length && String(pairs[0]) !== String(pairs.at(-1)))
                pairs.push(pairs[0]);
              return pairs;
            }),
          ),
        },
      );
    } catch (e) {
      await action.run(() => Promise.reject(e), '');
      return;
    }
    await action.run(async () => {
      const body = {
        name: roomName(picked.id),
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
            body: { ...body, map_room_id: picked.id },
            throwOnError: true,
          });
      navigate('/admin/spaces/' + result.data.space.id + '/layout');
    }, 'Study place created.');
  }
  const registered =
    picked &&
    spaces.data?.spaces.some(
      (s) => s.map_room_id === picked.id && s.id !== existingSpaceId,
    );
  return (
    <div className="grid gap-4">
      <Title order={1}>
        {existingSpaceId ? 'Link a room border' : 'Add study place'}
      </Title>
      <Text c="dimmed">
        Choose a room from the campus floor plans. Its real outline and scale
        will be used in the layout editor.
      </Text>
      {index.isError && (
        <Alert variant="danger">
          {errorMessage(index.error)}
          <Button variant="quiet" onClick={() => void index.refetch()}>
            Retry floor plans
          </Button>
        </Alert>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <NativeSelect
          label="Building"
          disabled={!!existingSpaceId}
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
              index.data?.levels.find((l) => l.facilityId === id)?.id || '',
            );
            setPicked(null);
          }}
        />
        <NativeSelect
          label="Floor"
          disabled={!!existingSpaceId}
          data={levels.map((l) => ({ value: l.id, label: l.label }))}
          value={level}
          onChange={(e) => {
            setLevel(e.currentTarget.value);
            setPicked(null);
          }}
        />
      </div>
      <TextInput
        label="Find room"
        placeholder="HG E 1.1"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      {floor.isPending ? (
        <Text>Loading room borders…</Text>
      ) : floor.isError ? (
        <Alert variant="danger">
          {errorMessage(floor.error)}
          <Button variant="quiet" onClick={() => void floor.refetch()}>
            Retry
          </Button>
        </Alert>
      ) : (
        <div className="admin-picker-grid">
          <div className="admin-room-map">
            <MapContainer
              center={[47.376, 8.548]}
              zoom={18}
              className="h-full w-full"
              attributionControl={false}
            >
              <FitFloor points={points} />
              {floor.data.rooms.map((r) => (
                <Polygon
                  key={r.id}
                  positions={r.rings}
                  pathOptions={{
                    color:
                      r.id === picked?.id
                        ? 'var(--color-accent)'
                        : 'var(--color-border-strong)',
                    fillColor:
                      r.id === picked?.id
                        ? 'var(--color-accent)'
                        : 'var(--color-surface-2)',
                    fillOpacity: 0.7,
                    weight: 1,
                  }}
                  eventHandlers={{
                    click: () => {
                      if (!existingMapRoomId || r.id === existingMapRoomId)
                        setPicked(r);
                    },
                  }}
                >
                  <Tooltip>
                    {roomName(r.id)} · {r.use}
                  </Tooltip>
                </Polygon>
              ))}
            </MapContainer>
          </div>
          <div className="admin-room-results">
            {rooms.map((r) => (
              <button
                type="button"
                key={r.id}
                className="admin-room-choice"
                aria-pressed={r.id === picked?.id}
                onClick={() => setPicked(r)}
              >
                <strong>{roomName(r.id)}</strong>
                <span className="text-small text-text-muted">
                  {r.use} · {Math.round(r.area)} m²
                </span>
              </button>
            ))}
            {!rooms.length && <Text>No matching rooms.</Text>}
          </div>
        </div>
      )}
      <NativeSelect
        label="Time zone"
        data={['Europe/Zurich', 'Europe/Berlin', 'UTC']}
        value={timezone}
        onChange={(e) => setTimezone(e.currentTarget.value)}
      />
      <Text>
        {picked ? roomName(picked.id) + ' selected' : 'No room selected'}
      </Text>
      {registered && (
        <Alert>
          This room is already registered. Restore its study place if it was
          deleted.
        </Alert>
      )}
      <div className="flex gap-3">
        <Button variant="secondary" onClick={() => navigate('/admin')}>
          Cancel
        </Button>
        <Button
          disabled={!picked || action.busy || !!registered}
          onClick={() => void create()}
        >
          {existingSpaceId
            ? 'Link room and edit layout'
            : 'Create space and edit layout'}
        </Button>
      </div>
      <AdminFeedback action={action} />
    </div>
  );
}
