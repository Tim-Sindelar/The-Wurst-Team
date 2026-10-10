/**
 * The PolyMaps (ArcGIS IPS) radio map, as written by scraper/extract_ips.py: for ~135 000 points on
 * a 0.75 m grid, the mean and spread of the RSSI of every iBeacon heard there. Tiles are loaded on
 * demand around the beacons a phone hears.
 */
import { toLocal, type LngLat } from '../geo';

export interface RadioMapIndex {
  uuid: string[];
  tileDeg: number;
  /** LEVEL_IDs referenced by tile points (by index). */
  levels: string[];
  /** LEVEL_ID -> [FACILITY_ID, VERTICAL_ORDER] for every PolyMaps level. */
  levelInfo: Record<string, [string, number]>;
  /** Tile key -> number of points. */
  tiles: Record<string, number>;
  /** [major, minor, lng, lat, level index]; position is a rough estimate (null if never heard). */
  beacons: [number, number, number | null, number | null, number | null][];
  source: string;
}

export interface Tile {
  key: string;
  count: number;
  lng: Float64Array;
  lat: Float64Array;
  level: Uint16Array;
  /** Fingerprint of point i is entries offsets[i] .. offsets[i + 1] - 1. */
  offsets: Uint32Array;
  beacon: Uint16Array;
  mean: Float32Array;
  std: Float32Array;
  /** Beacon index -> points of this tile that heard it. */
  byBeacon: Map<number, number[]>;
}

export type TileLoader = (key: string) => Promise<ArrayBuffer>;

export function parseTile(key: string, buf: ArrayBuffer): Tile {
  const view = new DataView(buf);
  const count = view.getUint32(0, true);
  const lng = new Float64Array(count);
  const lat = new Float64Array(count);
  const level = new Uint16Array(count);
  const offsets = new Uint32Array(count + 1);
  // First pass for the number of entries, so the typed arrays can be allocated once.
  let pos = 4;
  let entries = 0;
  for (let i = 0; i < count; i++) {
    const n = view.getUint16(pos + 18, true);
    entries += n;
    pos += 20 + 6 * n;
  }
  const beacon = new Uint16Array(entries);
  const mean = new Float32Array(entries);
  const std = new Float32Array(entries);
  const byBeacon = new Map<number, number[]>();
  pos = 4;
  let e = 0;
  for (let i = 0; i < count; i++) {
    lng[i] = view.getFloat64(pos, true);
    lat[i] = view.getFloat64(pos + 8, true);
    level[i] = view.getUint16(pos + 16, true);
    const n = view.getUint16(pos + 18, true);
    pos += 20;
    offsets[i] = e;
    for (let j = 0; j < n; j++, e++, pos += 6) {
      const b = view.getUint16(pos, true);
      beacon[e] = b;
      mean[e] = view.getInt16(pos + 2, true) / 10;
      std[e] = view.getUint16(pos + 4, true) / 10;
      let list = byBeacon.get(b);
      if (!list) byBeacon.set(b, (list = []));
      list.push(i);
    }
  }
  offsets[count] = e;
  return { key, count, lng, lat, level, offsets, beacon, mean, std, byBeacon };
}

export class RadioMap {
  readonly index: RadioMapIndex;
  private readonly loader: TileLoader;
  private readonly tiles = new Map<string, Tile>();
  private readonly pending = new Map<string, Promise<Tile>>();
  private readonly beaconByKey = new Map<number, number>();
  private readonly uuids: Set<string>;

  constructor(index: RadioMapIndex, loader: TileLoader) {
    this.index = index;
    this.loader = loader;
    this.uuids = new Set(index.uuid.map((u) => u.toUpperCase()));
    index.beacons.forEach(([major, minor], i) => this.beaconByKey.set(major * 65536 + minor, i));
  }

  static async load(baseUrl = 'ips'): Promise<RadioMap> {
    const res = await fetch(`${baseUrl}/index.json`);
    if (!res.ok) throw new Error(`radio map index: HTTP ${res.status} (run scraper/extract_ips.py)`);
    const index = (await res.json()) as RadioMapIndex;
    return new RadioMap(index, async (key) => {
      const tile = await fetch(`${baseUrl}/tiles/${key}.bin`);
      if (!tile.ok) throw new Error(`radio map tile ${key}: HTTP ${tile.status}`);
      return tile.arrayBuffer();
    });
  }

  get beaconCount(): number {
    return this.index.beacons.length;
  }

  /** Index of the beacon, or undefined if it is not part of the PolyMaps system. */
  beaconIndex(uuid: string, major: number, minor: number): number | undefined {
    if (!this.uuids.has(uuid.toUpperCase())) return undefined;
    return this.beaconByKey.get(major * 65536 + minor);
  }

  beaconPosition(b: number): (LngLat & { level: number }) | null {
    const [, , lng, lat, level] = this.index.beacons[b];
    return lng == null || lat == null || level == null ? null : { lng, lat, level };
  }

  levelId(levelIndex: number): string {
    return this.index.levels[levelIndex];
  }

  levelIndexOf(levelId: string): number {
    return this.index.levels.indexOf(levelId);
  }

  tileKey(p: LngLat): string {
    const d = this.index.tileDeg;
    return `${Math.floor(p.lng / d)}_${Math.floor(p.lat / d)}`;
  }

  /** Existing tile keys within `radius` metres of p. */
  tilesAround(p: LngLat, radius: number): string[] {
    const d = this.index.tileDeg;
    const dLat = radius / 111_132;
    const dLng = radius / (111_320 * Math.cos((p.lat * Math.PI) / 180));
    const keys: string[] = [];
    for (let i = Math.floor((p.lng - dLng) / d); i <= Math.floor((p.lng + dLng) / d); i++) {
      for (let j = Math.floor((p.lat - dLat) / d); j <= Math.floor((p.lat + dLat) / d); j++) {
        const key = `${i}_${j}`;
        if (key in this.index.tiles) keys.push(key);
      }
    }
    return keys;
  }

  getTile(key: string): Tile | undefined {
    return this.tiles.get(key);
  }

  loadedTiles(): Tile[] {
    return [...this.tiles.values()];
  }

  async ensureTiles(keys: Iterable<string>): Promise<Tile[]> {
    return Promise.all(
      [...new Set(keys)].map((key) => {
        const tile = this.tiles.get(key);
        if (tile) return tile;
        let pending = this.pending.get(key);
        if (!pending) {
          pending = this.loader(key).then((buf) => {
            const parsed = parseTile(key, buf);
            this.tiles.set(key, parsed);
            this.pending.delete(key);
            return parsed;
          });
          this.pending.set(key, pending);
        }
        return pending;
      }),
    );
  }

  /** Nearest fingerprint point on a level among the loaded tiles. */
  nearestPoint(p: LngLat, levelIndex: number): { tile: Tile; i: number; distance: number } | null {
    let best: { tile: Tile; i: number; distance: number } | null = null;
    for (const key of this.tilesAround(p, 60)) {
      const tile = this.tiles.get(key);
      if (!tile) continue;
      for (let i = 0; i < tile.count; i++) {
        if (tile.level[i] !== levelIndex) continue;
        const { x, y } = toLocal({ lng: tile.lng[i], lat: tile.lat[i] }, p);
        const dist = Math.hypot(x, y);
        if (!best || dist < best.distance) best = { tile, i, distance: dist };
      }
    }
    return best;
  }
}
