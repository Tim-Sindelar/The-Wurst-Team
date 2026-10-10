/** Small geodesy helpers. Everything at ETH scale (< 100 km) works in a local tangent plane. */

export interface LngLat {
  lng: number;
  lat: number;
}

const M_PER_DEG_LAT = 111_132;
const M_PER_DEG_LNG_EQUATOR = 111_320;

/** Metres east / north of `origin`. */
export function toLocal(p: LngLat, origin: LngLat): { x: number; y: number } {
  return {
    x: (p.lng - origin.lng) * M_PER_DEG_LNG_EQUATOR * Math.cos((origin.lat * Math.PI) / 180),
    y: (p.lat - origin.lat) * M_PER_DEG_LAT,
  };
}

export function fromLocal(x: number, y: number, origin: LngLat): LngLat {
  return {
    lng: origin.lng + x / (M_PER_DEG_LNG_EQUATOR * Math.cos((origin.lat * Math.PI) / 180)),
    lat: origin.lat + y / M_PER_DEG_LAT,
  };
}

/** Horizontal distance in metres (equirectangular, exact enough below a few km). */
export function distance(a: LngLat, b: LngLat): number {
  const { x, y } = toLocal(b, a);
  return Math.hypot(x, y);
}

/** Ray casting on a flat [x0, y0, x1, y1, ...] ring. */
export function inFlatRing(x: number, y: number, ring: ArrayLike<number>): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ray casting on a GeoJSON ring [[lng, lat], ...]. */
export function inRing(p: LngLat, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inMultiPolygon(p: LngLat, coordinates: number[][][][]): boolean {
  return coordinates.some((poly) => inRing(p, poly[0]) && !poly.slice(1).some((hole) => inRing(p, hole)));
}

/** Standard normal sample (Box-Muller). `rand` is injectable for reproducible simulations. */
export function gaussian(rand: () => number = Math.random): number {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Small seeded PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
