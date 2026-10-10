import type { Library, OccupancyData, Seat, Table } from './types';

// Two-layer storage: the scraper pipeline owns `generated` (rebuilt from
// PolyMaps on every run), admin edits live in `overrides` as a diff against it.
// The UI only ever sees the merged result; saving diffs that result against
// the current generated data, so pipeline re-runs never clobber admin edits
// and admin edits never write into pipeline output.

interface Entity {
  id: string;
}

export interface CollectionOverrides<T extends Entity> {
  /** Entities that don't exist in the generated data (created in admin mode). */
  added: T[];
  /** Field-level changes to generated entities, by id. */
  changed: Record<string, Partial<T>>;
  /** Generated entities removed in admin mode. */
  deleted: string[];
}

export interface AdminOverrides {
  schemaVersion: 1;
  updatedAt: string;
  libraries: CollectionOverrides<Library>;
  tables: CollectionOverrides<Table>;
  seats: CollectionOverrides<Seat>;
}

const emptyCollection = <T extends Entity>(): CollectionOverrides<T> => ({ added: [], changed: {}, deleted: [] });

export const emptyOverrides = (): AdminOverrides => ({
  schemaVersion: 1,
  updatedAt: new Date(0).toISOString(),
  libraries: emptyCollection(),
  tables: emptyCollection(),
  seats: emptyCollection(),
});

export const emptyData = (): OccupancyData => ({
  schemaVersion: 1,
  updatedAt: new Date(0).toISOString(),
  libraries: [],
  tables: [],
  seats: [],
});

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

// ---- merge -----------------------------------------------------------------

function applyCollection<T extends Entity>(base: T[], ov: CollectionOverrides<T>): T[] {
  const deleted = new Set(ov.deleted);
  const added = new Map(ov.added.map((x) => [x.id, x]));
  const out = base
    .filter((x) => !deleted.has(x.id) && !added.has(x.id))
    .map((x) => (ov.changed[x.id] ? { ...x, ...ov.changed[x.id] } : x));
  return [...out, ...added.values()];
}

const levelsOf = (rooms: string[]) => [...new Set(rooms.map((r) => r.split('.').slice(0, 3).join('.')))].sort();

/** Pipeline output has no admin-only fields: workspaces are off until enabled, with no note and no card access. */
const withEnabled = (data: OccupancyData): OccupancyData => ({
  ...data,
  libraries: data.libraries.map((l) => ({ ...l, enabled: l.enabled === true, availabilityNote: l.availabilityNote ?? null, cardAccess24h: l.cardAccess24h === true })),
});

/**
 * Generated data with the admin overrides applied on top.
 *
 * A room belongs to one workspace only: rooms an admin assigned (added
 * workspaces, or a changed `rooms` list) are taken away from untouched
 * generated workspaces. An untouched generated workspace left without rooms
 * that way is dropped, it only existed because of those rooms.
 */
export function mergeOverrides(rawGenerated: OccupancyData, overrides: AdminOverrides): OccupancyData {
  const generated = withEnabled(rawGenerated);
  const ov = overrides.libraries;
  const owned = new Set([...ov.added.map((l) => l.id), ...Object.keys(ov.changed).filter((id) => ov.changed[id].rooms)]);
  const libraries = applyCollection(generated.libraries, ov);
  const claimed = new Set(libraries.filter((l) => owned.has(l.id)).flatMap((l) => l.rooms));
  const resolved = libraries.flatMap((l) => {
    if (owned.has(l.id) || !l.rooms.some((r) => claimed.has(r))) return [l];
    const rooms = l.rooms.filter((r) => !claimed.has(r));
    if (!rooms.length && !ov.changed[l.id]) return [];
    return [{ ...l, rooms, levels: levelsOf(rooms) }];
  });

  const libraryIds = new Set(resolved.map((l) => l.id));
  const tables = applyCollection(generated.tables, overrides.tables).filter((t) => libraryIds.has(t.libraryId));
  const tableIds = new Set(tables.map((t) => t.id));
  const seats = applyCollection(generated.seats, overrides.seats).filter((s) => tableIds.has(s.tableId));

  return {
    schemaVersion: 1,
    updatedAt: generated.updatedAt > overrides.updatedAt ? generated.updatedAt : overrides.updatedAt,
    libraries: resolved,
    tables,
    seats,
  };
}

// ---- diff ------------------------------------------------------------------

function diffCollection<T extends Entity>(base: T[], next: T[]): CollectionOverrides<T> {
  const baseById = new Map(base.map((x) => [x.id, x]));
  const ov = emptyCollection<T>();
  for (const item of next) {
    const orig = baseById.get(item.id);
    if (!orig) {
      ov.added.push(item);
      continue;
    }
    const patch: Partial<T> = {};
    for (const key of Object.keys(item) as (keyof T)[]) {
      if (key !== 'id' && !deepEqual(item[key], orig[key])) patch[key] = item[key];
    }
    if (Object.keys(patch).length) ov.changed[item.id] = patch;
  }
  return ov;
}

/**
 * Overrides that turn `generated` into `data` (the full dataset the admin UI
 * saved). Entries of `previous` that the UI couldn't see, e.g. changes to a
 * workspace the latest pipeline run didn't produce, are kept so they apply
 * again if it comes back.
 */
export function diffOverrides(
  rawGenerated: OccupancyData,
  data: OccupancyData,
  previous: AdminOverrides = emptyOverrides(),
): AdminOverrides {
  const generated = withEnabled(rawGenerated);
  const next: AdminOverrides = {
    schemaVersion: 1,
    updatedAt: data.updatedAt,
    libraries: diffCollection(generated.libraries, data.libraries),
    tables: diffCollection(generated.tables, data.tables),
    seats: diffCollection(generated.seats, data.seats),
  };

  // Deletions: generated entities that would show up with the other overrides
  // applied but are missing from `data`. Workspaces dropped because all their
  // rooms moved elsewhere aren't recorded as deleted.
  const undeleted = mergeOverrides(generated, next);
  const visibleBefore = mergeOverrides(generated, previous);
  for (const key of ['libraries', 'tables', 'seats'] as const) {
    const kept = new Set(data[key].map((x) => x.id));
    const coll = next[key] as CollectionOverrides<Entity>;
    coll.deleted = undeleted[key].map((x) => x.id).filter((id) => !kept.has(id));

    // Carry over what the UI never saw.
    const prev = previous[key] as CollectionOverrides<Entity>;
    const seen = new Set(visibleBefore[key].map((x) => x.id));
    const generatedIds = new Set(generated[key].map((x) => x.id));
    for (const id of prev.deleted) if (!generatedIds.has(id) && !coll.deleted.includes(id)) coll.deleted.push(id);
    for (const [id, patch] of Object.entries(prev.changed)) if (!seen.has(id) && !coll.changed[id]) coll.changed[id] = patch;
    for (const item of prev.added) if (!seen.has(item.id) && !kept.has(item.id)) coll.added.push(item);
  }
  return next;
}

// ---- validation ------------------------------------------------------------

export function validateOverrides(input: unknown): string[] {
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObj(input)) return ['root must be an object'];
  const errors: string[] = [];
  if (input.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  for (const key of ['libraries', 'tables', 'seats']) {
    const c = input[key];
    if (!isObj(c) || !Array.isArray(c.added) || !isObj(c.changed) || !Array.isArray(c.deleted)) {
      errors.push(`${key} must have added[], changed{} and deleted[]`);
    }
  }
  return errors;
}
