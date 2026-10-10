/**
 * Routes between two positions (or a position and a room): snap both ends to the walkable grid,
 * search, then straighten each floor's part of the path (string pulling with grid line of sight)
 * and describe the floor changes.
 */
import { distance, type LngLat } from '../geo';
import { nearestWalkable, search, type GridPoint } from './astar';
import { cellCenter, cellOf, type LinkKind, type NavData, type NavGrid } from './navData';

export interface RoutePoint extends LngLat {
  levelId: string;
}

export interface RouteLeg {
  levelId: string;
  points: LngLat[];
  /** Walking distance of this leg in metres. */
  length: number;
  /** How the route continues after this leg (null for the last one). */
  next: { kind: LinkKind; toLevelId: string } | null;
}

export interface Route {
  from: RoutePoint;
  to: RoutePoint;
  legs: RouteLeg[];
  /** Walking distance in metres (outdoor parts included, floor changes not). */
  length: number;
  /** Search cost: walking distance plus floor change penalties. */
  cost: number;
  /** Rough walking time in seconds (1.2 m/s, plus stairs and lifts). */
  seconds: number;
  expanded: number;
}

export class RouteError extends Error {}

/** Snap a position to the nearest walkable cell of its level (within ~10 m). */
export async function snap(nav: NavData, p: RoutePoint): Promise<GridPoint> {
  const info = nav.level(p.levelId);
  if (!info) throw new RouteError(`No navigation data for ${p.levelId}`);
  const grid = await nav.grid(p.levelId);
  const [i, j] = cellOf(info, nav.cell, p);
  const near = nearestWalkable(grid, i, j, Math.round(10 / nav.cell));
  if (!near) throw new RouteError(`No walkable space within 10 m of the point on ${p.levelId}`);
  return { levelId: p.levelId, i: near[0], j: near[1] };
}

/**
 * Whether the straight segment between two cells stays on walkable cells (supercover line). Between
 * two corridor cells the line must stay in the corridor, so straightening doesn't cut through rooms.
 */
export function lineOfSight(grid: NavGrid, i0: number, j0: number, i1: number, j1: number): boolean {
  const { w } = grid.info;
  const cls = grid.walk;
  const max = Math.max(cls[j0 * w + i0], cls[j1 * w + i1]);
  const ok = (k: number) => cls[k] !== 0 && cls[k] <= max;
  let x = i0, y = j0;
  const dx = Math.abs(i1 - i0), dy = Math.abs(j1 - j0);
  const sx = i1 > i0 ? 1 : -1, sy = j1 > j0 ? 1 : -1;
  let err = dx - dy;
  for (let n = dx + dy; n > 0; n--) {
    const e2 = 2 * err;
    if (e2 > -dy && e2 < dx) {
      // Diagonal step: both side cells must be free, like the search's no-corner-cutting rule.
      if (!ok(y * w + x + sx) || !ok((y + sy) * w + x)) return false;
      err += -dy + dx;
      x += sx;
      y += sy;
      n--;
    } else if (e2 > -dy) {
      err -= dy;
      x += sx;
    } else {
      err += dx;
      y += sy;
    }
    if (!ok(y * w + x)) return false;
  }
  return true;
}

/** Greedy string pulling: keep only the cells where the straight line of sight breaks. */
export function straighten(grid: NavGrid, cells: [number, number][]): [number, number][] {
  if (cells.length <= 2) return cells;
  const out: [number, number][] = [cells[0]];
  let anchor = 0;
  while (anchor < cells.length - 1) {
    let next = anchor + 1;
    // Furthest visible cell first; the cap keeps very long paths from going quadratic.
    for (let k = Math.min(cells.length - 1, anchor + 400); k > anchor + 1; k--) {
      if (lineOfSight(grid, cells[anchor][0], cells[anchor][1], cells[k][0], cells[k][1])) {
        next = k;
        break;
      }
    }
    out.push(cells[next]);
    anchor = next;
  }
  return out;
}

const WALK_SPEED = 1.2;
const LINK_SECONDS: Record<LinkKind, number> = { stairs: 15, lift: 45, outdoor: 0, passage: 0 };

export async function findRoute(nav: NavData, from: RoutePoint, to: RoutePoint): Promise<Route> {
  const [a, b] = await Promise.all([snap(nav, from), snap(nav, to)]);
  const result = await search(nav, a, b);
  if (!result) throw new RouteError('No route found: one end may be in a room the floor plan does not connect (see nav/report.json).');

  // Split into legs at floor changes / outdoor hops.
  const legs: RouteLeg[] = [];
  let cells: [number, number][] = [];
  let levelId = result.steps[0].levelId;
  const flush = (next: RouteLeg['next']) => {
    const info = nav.level(levelId)!;
    return nav.grid(levelId).then((grid) => {
      const pts = straighten(grid, cells).map(([i, j]) => cellCenter(info, nav.cell, i, j));
      let length = 0;
      for (let k = 1; k < pts.length; k++) length += distance(pts[k - 1], pts[k]);
      legs.push({ levelId, points: pts, length, next });
    });
  };
  for (const step of result.steps) {
    if (step.via !== 'walk') {
      await flush({ kind: step.via, toLevelId: step.levelId });
      cells = [];
      levelId = step.levelId;
    }
    cells.push([step.i, step.j]);
  }
  await flush(null);

  // Outdoor hops are straight lines between entrances; count them as walking.
  let length = 0;
  let seconds = 0;
  legs.forEach((leg, k) => {
    length += leg.length;
    if (leg.next) {
      seconds += LINK_SECONDS[leg.next.kind];
      if (leg.next.kind === 'outdoor') {
        const hop = distance(leg.points[leg.points.length - 1], legs[k + 1].points[0]);
        length += hop;
      }
    }
  });
  seconds += length / WALK_SPEED;
  return { from, to, legs, length, cost: result.cost, seconds, expanded: result.expanded };
}

export function describe(route: Route, levelLabel: (id: string) => string): string[] {
  const out: string[] = [];
  route.legs.forEach((leg) => {
    out.push(`${levelLabel(leg.levelId)}: walk ${Math.round(leg.length)} m`);
    if (leg.next) {
      const to = levelLabel(leg.next.toLevelId);
      out.push(
        leg.next.kind === 'outdoor' ? `Go outside to ${to}` : leg.next.kind === 'passage' ? `Continue into ${to}` : `Take the ${leg.next.kind} to ${to}`,
      );
    }
  });
  return out;
}
