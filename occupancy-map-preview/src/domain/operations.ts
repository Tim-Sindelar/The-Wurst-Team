import type { LatLng, Library, MultiPolygon, OccupancyData, RoomRef, Seat, Table, WorkspaceKind } from './types';

// Pure, immutable operations on the dataset. Every UI edit goes through here,
// so the same rules (cascading deletes, moving seats with their table) can be
// reused server-side later.

export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

const touch = (data: OccupancyData): OccupancyData => ({ ...data, updatedAt: new Date().toISOString() });

// ---- queries ---------------------------------------------------------------

export const tablesOf = (data: OccupancyData, libraryId: string) =>
  data.tables.filter((t) => t.libraryId === libraryId);

export const seatsOfTable = (data: OccupancyData, tableId: string) =>
  data.seats.filter((s) => s.tableId === tableId);

export function seatsOfLibrary(data: OccupancyData, libraryId: string): Seat[] {
  const tableIds = new Set(tablesOf(data, libraryId).map((t) => t.id));
  return data.seats.filter((s) => tableIds.has(s.tableId));
}

export function occupancyOf(data: OccupancyData, libraryId: string) {
  const seats = seatsOfLibrary(data, libraryId);
  return {
    total: seats.length,
    free: seats.filter((s) => s.status === 'free').length,
    occupied: seats.filter((s) => s.status === 'occupied').length,
  };
}

// ---- libraries -------------------------------------------------------------

const campusAt = (position: LatLng): Library['campus'] => (position.lat > 47.395 ? 'Hönggerberg' : 'Zentrum');

export function addLibrary(
  data: OccupancyData,
  position: LatLng,
  floor: number | null,
  kind: WorkspaceKind = 'library',
): [OccupancyData, Library] {
  const library: Library = {
    id: newId('lib'),
    name: kind === 'library' ? 'Neue Bibliothek' : 'Neuer Arbeitsplatz',
    kind,
    address: null,
    campus: campusAt(position),
    operator: kind === 'library' ? 'ETH-Bibliothek' : 'Weitere',
    openingHours: null,
    description: null,
    position,
    positionApproximate: false,
    sourceUrl: null,
    outline: null,
    facilityId: null,
    levelId: null,
    floor,
    rooms: [],
    levels: [],
  };
  return [touch({ ...data, libraries: [...data.libraries, library] }), library];
}

export const updateLibrary = (data: OccupancyData, id: string, patch: Partial<Omit<Library, 'id'>>) =>
  touch({ ...data, libraries: data.libraries.map((l) => (l.id === id ? { ...l, ...patch } : l)) });

export function deleteLibrary(data: OccupancyData, id: string): OccupancyData {
  const tableIds = new Set(tablesOf(data, id).map((t) => t.id));
  return touch({
    ...data,
    libraries: data.libraries.filter((l) => l.id !== id),
    tables: data.tables.filter((t) => t.libraryId !== id),
    seats: data.seats.filter((s) => !tableIds.has(s.tableId)),
  });
}

// ---- rooms -----------------------------------------------------------------

/** "ETH.HG.H.H_030.1" → "ETH.HG.H" (unit ids start with their level id). */
export const levelOfRoom = (roomId: string) => roomId.split('.').slice(0, 3).join('.');

const withRooms = (lib: Library, rooms: string[]): Library => {
  const sorted = [...new Set(rooms)].sort();
  return { ...lib, rooms: sorted, levels: [...new Set(sorted.map(levelOfRoom))].sort() };
};

/** Location fields of a workspace placed on its largest room. */
function locationFrom(rooms: RoomRef[]) {
  const main = rooms.reduce((a, b) => (b.area > a.area ? b : a));
  return {
    position: main.center,
    positionApproximate: false,
    campus: campusAt(main.center),
    facilityId: main.facilityId,
    levelId: main.levelId,
    floor: main.floor,
  };
}

/**
 * Adds rooms to a workspace. A room belongs to one workspace only, so rooms
 * are taken away from any other workspace that had them. A workspace that had
 * no rooms yet is moved onto the largest added room.
 */
export function assignRooms(data: OccupancyData, libraryId: string, rooms: RoomRef[]): OccupancyData {
  if (!rooms.length) return data;
  const ids = new Set(rooms.map((r) => r.id));
  return touch({
    ...data,
    libraries: data.libraries.map((l) => {
      if (l.id === libraryId) {
        const located = l.rooms.length ? {} : locationFrom(rooms);
        return withRooms({ ...l, ...located }, [...l.rooms, ...ids]);
      }
      return l.rooms.some((r) => ids.has(r)) ? withRooms(l, l.rooms.filter((r) => !ids.has(r))) : l;
    }),
  });
}

export const removeRoom = (data: OccupancyData, libraryId: string, roomId: string) =>
  touch({
    ...data,
    libraries: data.libraries.map((l) => (l.id === libraryId ? withRooms(l, l.rooms.filter((r) => r !== roomId)) : l)),
  });

/** Creates a workspace made of the given rooms, placed on the largest one. */
export function addLibraryFromRooms(
  data: OccupancyData,
  rooms: RoomRef[],
  kind: WorkspaceKind,
): [OccupancyData, Library] {
  const loc = locationFrom(rooms);
  const [withLib, lib] = addLibrary(data, loc.position, loc.floor, kind);
  const named = updateLibrary(withLib, lib.id, { name: rooms.map((r) => r.name).sort().join(', ') });
  const next = assignRooms(named, lib.id, rooms);
  return [next, next.libraries.find((l) => l.id === lib.id)!];
}

// ---- tables ----------------------------------------------------------------

export function addTable(data: OccupancyData, libraryId: string, position: LatLng): [OccupancyData, Table] {
  const n = tablesOf(data, libraryId).length + 1;
  const table: Table = { id: newId('tbl'), libraryId, label: `T${n}`, position };
  return [touch({ ...data, tables: [...data.tables, table] }), table];
}

export const updateTable = (data: OccupancyData, id: string, patch: Partial<Omit<Table, 'id' | 'libraryId'>>) =>
  touch({ ...data, tables: data.tables.map((t) => (t.id === id ? { ...t, ...patch } : t)) });

/** Moves a table and shifts its seats by the same offset. */
export function moveTable(data: OccupancyData, id: string, to: LatLng): OccupancyData {
  const table = data.tables.find((t) => t.id === id);
  if (!table) return data;
  const dLat = to.lat - table.position.lat;
  const dLng = to.lng - table.position.lng;
  return touch({
    ...data,
    tables: data.tables.map((t) => (t.id === id ? { ...t, position: to } : t)),
    seats: data.seats.map((s) =>
      s.tableId === id ? { ...s, position: { lat: s.position.lat + dLat, lng: s.position.lng + dLng } } : s,
    ),
  });
}

export const deleteTable = (data: OccupancyData, id: string) =>
  touch({
    ...data,
    tables: data.tables.filter((t) => t.id !== id),
    seats: data.seats.filter((s) => s.tableId !== id),
  });

// ---- seats -----------------------------------------------------------------

export function addSeat(data: OccupancyData, tableId: string, position: LatLng): [OccupancyData, Seat] {
  const table = data.tables.find((t) => t.id === tableId);
  const n = seatsOfTable(data, tableId).length + 1;
  const seat: Seat = { id: newId('seat'), tableId, label: `${table?.label ?? 'S'}-${n}`, position, status: 'free' };
  return [touch({ ...data, seats: [...data.seats, seat] }), seat];
}

export const updateSeat = (data: OccupancyData, id: string, patch: Partial<Omit<Seat, 'id' | 'tableId'>>) =>
  touch({ ...data, seats: data.seats.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

export const deleteSeat = (data: OccupancyData, id: string) =>
  touch({ ...data, seats: data.seats.filter((s) => s.id !== id) });

// ---- outlines --------------------------------------------------------------

/** Approximate area in m² (local equirectangular projection; fine at building scale). */
export function outlineAreaM2(outline: MultiPolygon): number {
  const ringArea = (ring: number[][]) => {
    const lat0 = (ring[0][1] * Math.PI) / 180;
    const kx = 111_320 * Math.cos(lat0);
    const ky = 110_540;
    let sum = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      sum += ring[i][0] * kx * (ring[i + 1][1] * ky) - ring[i + 1][0] * kx * (ring[i][1] * ky);
    }
    return Math.abs(sum) / 2;
  };
  return outline.coordinates.reduce(
    (total, [outer, ...holes]) => total + ringArea(outer) - holes.reduce((h, ring) => h + ringArea(ring), 0),
    0,
  );
}
