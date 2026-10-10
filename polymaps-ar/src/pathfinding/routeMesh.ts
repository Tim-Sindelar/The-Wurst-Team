/** The route of the current floor as a glowing ribbon on the floor of the AR scene, with chevrons. */
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from 'three';
import { toLocal, type LngLat } from '../geo';
import type { Route } from './route';

const WIDTH = 0.5;
const HEIGHT = 0.06;
const CHEVRON_EVERY = 2.5; // m

/** Quads along a polyline (plan metres x east, y north) at height y, in world frame (z = -north). */
function ribbon(points: { x: number; y: number }[], width: number, y: number): BufferGeometry {
  const pos: number[] = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k], b = points[k + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-3) continue;
    const nx = (-(b.y - a.y) / len) * (width / 2), ny = ((b.x - a.x) / len) * (width / 2);
    const p = [
      [a.x + nx, a.y + ny], [a.x - nx, a.y - ny], [b.x - nx, b.y - ny], [b.x + nx, b.y + ny],
    ].map(([x, yy]) => [x, y, -yy]);
    pos.push(...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

/** Arrow-head triangles every CHEVRON_EVERY metres, pointing along the path. */
function chevrons(points: { x: number; y: number }[], y: number): BufferGeometry {
  const pos: number[] = [];
  let carry = CHEVRON_EVERY / 2;
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k], b = points[k + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-3) continue;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    for (let d = carry; d < len; d += CHEVRON_EVERY) {
      const cx = a.x + ux * d, cy = a.y + uy * d;
      const tip = [cx + ux * 0.3, cy + uy * 0.3];
      const l = [cx - ux * 0.15 - uy * 0.22, cy - uy * 0.15 + ux * 0.22];
      const r = [cx - ux * 0.15 + uy * 0.22, cy - uy * 0.15 - ux * 0.22];
      pos.push(tip[0], y, -tip[1], l[0], y, -l[1], r[0], y, -r[1]);
    }
    carry = ((carry - len) % CHEVRON_EVERY + CHEVRON_EVERY) % CHEVRON_EVERY;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

/** Route legs on `levelId`, relative to the AR anchor. */
export function buildRouteMesh(route: Route, levelId: string, anchor: LngLat): Group {
  const group = new Group();
  group.name = 'route';
  for (const leg of route.legs) {
    if (leg.levelId !== levelId || leg.points.length < 2) continue;
    const pts = leg.points.map((p) => toLocal(p, anchor));
    const band = new Mesh(ribbon(pts, WIDTH, HEIGHT), new MeshBasicMaterial({ color: 0x1f8fff, transparent: true, opacity: 0.55, side: DoubleSide, depthWrite: false }));
    const arrows = new Mesh(chevrons(pts, HEIGHT + 0.01), new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide, depthWrite: false }));
    band.renderOrder = 5;
    arrows.renderOrder = 6;
    group.add(band, arrows);
  }
  return group;
}
