import { CAMPUSES, MAX_OUTLINE_VERTICES, SEAT_STATUSES, type OccupancyData } from './types';

// Dependency-free structural validation. Used by the dev API before writing
// to disk and by the client after loading, so a broken file fails loudly.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrOrNull = (v: unknown) => v === null || isStr(v);
const isLatLng = (v: unknown) =>
  isObj(v) && Number.isFinite(v.lat) && Number.isFinite(v.lng);

/** Validates a GeoJSON MultiPolygon; returns an error message or null. */
function checkMultiPolygon(g: unknown): string | null {
  if (!isObj(g) || g.type !== 'MultiPolygon' || !Array.isArray(g.coordinates)) {
    return 'must be null or a GeoJSON MultiPolygon';
  }
  let vertices = 0;
  for (const polygon of g.coordinates as unknown[]) {
    if (!Array.isArray(polygon) || polygon.length === 0) return 'has an empty polygon';
    for (const ring of polygon as unknown[]) {
      if (!Array.isArray(ring) || ring.length < 4) return 'has a ring with fewer than 4 positions';
      for (const pos of ring as unknown[]) {
        if (!Array.isArray(pos) || pos.length < 2 || !pos.every(Number.isFinite)) return 'has an invalid position';
      }
      const [first, last] = [ring[0] as number[], ring[ring.length - 1] as number[]];
      if (first[0] !== last[0] || first[1] !== last[1]) return 'has a ring that is not closed';
      vertices += ring.length;
    }
  }
  return vertices > MAX_OUTLINE_VERTICES ? `exceeds ${MAX_OUTLINE_VERTICES} vertices` : null;
}

export function validateOccupancyData(input: unknown): string[] {
  const errors: string[] = [];
  if (!isObj(input)) return ['root must be an object'];
  if (input.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  for (const key of ['libraries', 'tables', 'seats'] as const) {
    if (!Array.isArray(input[key])) errors.push(`${key} must be an array`);
  }
  if (errors.length) return errors;

  const libraryIds = new Set<string>();
  const tableIds = new Set<string>();

  (input.libraries as unknown[]).forEach((l, i) => {
    const at = `libraries[${i}]`;
    if (!isObj(l) || !isStr(l.id) || !isStr(l.name)) return errors.push(`${at}: id and name required`);
    if (libraryIds.has(l.id)) errors.push(`${at}: duplicate id ${l.id}`);
    libraryIds.add(l.id);
    if (!CAMPUSES.includes(l.campus as never)) errors.push(`${at}: invalid campus`);
    if (!isLatLng(l.position)) errors.push(`${at}: invalid position`);
    for (const f of ['address', 'openingHours', 'description', 'sourceUrl']) {
      if (!isStrOrNull(l[f])) errors.push(`${at}: ${f} must be string or null`);
    }
    const outlineError = l.outline === null ? null : checkMultiPolygon(l.outline);
    if (outlineError) errors.push(`${at}: outline ${outlineError}`);
  });

  (input.tables as unknown[]).forEach((t, i) => {
    const at = `tables[${i}]`;
    if (!isObj(t) || !isStr(t.id) || !isStr(t.label)) return errors.push(`${at}: id and label required`);
    if (tableIds.has(t.id)) errors.push(`${at}: duplicate id ${t.id}`);
    tableIds.add(t.id);
    if (!libraryIds.has(t.libraryId as string)) errors.push(`${at}: unknown libraryId`);
    if (!isLatLng(t.position)) errors.push(`${at}: invalid position`);
  });

  const seatIds = new Set<string>();
  (input.seats as unknown[]).forEach((s, i) => {
    const at = `seats[${i}]`;
    if (!isObj(s) || !isStr(s.id) || !isStr(s.label)) return errors.push(`${at}: id and label required`);
    if (seatIds.has(s.id)) errors.push(`${at}: duplicate id ${s.id}`);
    seatIds.add(s.id);
    if (!tableIds.has(s.tableId as string)) errors.push(`${at}: unknown tableId`);
    if (!isLatLng(s.position)) errors.push(`${at}: invalid position`);
    if (!SEAT_STATUSES.includes(s.status as never)) errors.push(`${at}: invalid status`);
  });

  return errors;
}

export function assertOccupancyData(input: unknown): OccupancyData {
  const errors = validateOccupancyData(input);
  if (errors.length) throw new Error(`Invalid occupancy data:\n${errors.join('\n')}`);
  return input as OccupancyData;
}
