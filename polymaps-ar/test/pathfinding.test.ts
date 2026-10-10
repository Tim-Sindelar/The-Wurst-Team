import { describe, expect, it } from 'vitest';
import { distance } from '../src/geo';
import { search } from '../src/pathfinding/astar';
import { BLOCKED, CIRCULATION, ROOM, NavData, cellCenter, decodeGrid, type NavIndex, type NavLevelInfo } from '../src/pathfinding/navData';
import { findRoute, lineOfSight, straighten } from '../src/pathfinding/route';

const CELL = 0.25;

/** Encode a class grid the way build_navigation.py does: u32 n, n × u16 run, n × u8 class. */
function encode(cls: Uint8Array): ArrayBuffer {
  const runs: number[] = [], values: number[] = [];
  for (let k = 0; k < cls.length; ) {
    let e = k;
    while (e < cls.length && cls[e] === cls[k] && e - k < 65535) e++;
    runs.push(e - k);
    values.push(cls[k]);
    k = e;
  }
  const buf = new ArrayBuffer(4 + 2 * runs.length + values.length + 1);
  new DataView(buf).setUint32(0, runs.length, true);
  new Uint16Array(buf, 4, runs.length).set(runs);
  new Uint8Array(buf, 4 + 2 * runs.length, values.length).set(values);
  return buf;
}

/**
 * Two 20 m × 10 m floors. Each: a corridor along the bottom (rows 0-7), and above it a wall
 * (row 8) with a door at x = 2 m into a meeting room that also has a second door at x = 18 m.
 * Stairs at the right end link the floors.
 */
function testNav() {
  const w = 80, h = 40;
  const level = (id: string, vo: number): NavLevelInfo => ({ id, facility: 'ETH.TST', vo, lng0: 8.5, lat1: 47.4, kx: 75_300, w, h });
  const grid = () => {
    const cls = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (j >= 32) cls[k] = CIRCULATION; // corridor: bottom 2 m (rows are counted from the top)
      else if (j === 31) cls[k] = i === 8 || i === 9 || i === 72 || i === 73 ? CIRCULATION : BLOCKED; // wall + 2 doors
      else cls[k] = ROOM; // meeting room
    }
    return cls;
  };
  const levels = [level('ETH.TST.E', 0), level('ETH.TST.F', 1)];
  const grids = new Map(levels.map((l) => [l.id, encode(grid())]));
  const index: NavIndex = {
    cell: CELL,
    levels,
    links: [['ETH.TST.E', 78, 36, 'ETH.TST.F', 78, 36, 'stairs', 15]],
    rooms: [['TST E 1', 'Sitzungszimmer', 'ETH.TST.E', 40, 10], ['TST F 1', 'Büro', 'ETH.TST.F', 40, 10]],
  };
  return new NavData(index, async (id) => grids.get(id)!);
}

describe('navigation grid', () => {
  it('decodes the run-length encoded classes', async () => {
    const nav = testNav();
    const g = await nav.grid('ETH.TST.E');
    expect(g.walk[35 * 80 + 10]).toBe(CIRCULATION);
    expect(g.walk[31 * 80 + 20]).toBe(BLOCKED);
    expect(g.walk[10 * 80 + 20]).toBe(ROOM);
  });

  it('rejects a grid of the wrong size', () => {
    const info = testNav().index.levels[0];
    expect(() => decodeGrid({ ...info, w: 10 }, encode(new Uint8Array(80 * 40)))).toThrow();
  });
});

describe('A*', () => {
  it('goes around a wall through the door', async () => {
    const nav = testNav();
    const res = await search(nav, { levelId: 'ETH.TST.E', i: 40, j: 36 }, { levelId: 'ETH.TST.E', i: 40, j: 10 });
    expect(res).not.toBeNull();
    // Must pass a door cell (row 31, x 8-9 or 72-73).
    expect(res!.steps.some((s) => s.j === 31 && [8, 9, 72, 73].includes(s.i))).toBe(true);
  });

  it('does not cut through a meeting room from door to door', async () => {
    const nav = testNav();
    // Corridor, near door 1, to corridor, near door 2: through the room would be no shorter here,
    // so make the corridor detour obvious by checking every step stays out of the room.
    const res = await search(nav, { levelId: 'ETH.TST.E', i: 9, j: 33 }, { levelId: 'ETH.TST.E', i: 72, j: 33 });
    expect(res!.steps.every((s) => s.j >= 31)).toBe(true);
  });

  it('changes floor by the stairs', async () => {
    const nav = testNav();
    const res = await search(nav, { levelId: 'ETH.TST.E', i: 10, j: 36 }, { levelId: 'ETH.TST.F', i: 10, j: 36 });
    expect(res!.steps.find((s) => s.via === 'stairs')?.levelId).toBe('ETH.TST.F');
    expect(res!.cost).toBeGreaterThan(15 + 2 * (78 - 10) * CELL - 1);
  });
});

describe('route', () => {
  it('straightens a staircase-shaped cell path in open space', async () => {
    const nav = testNav();
    const g = await nav.grid('ETH.TST.E');
    const cells: [number, number][] = [];
    for (let i = 10; i <= 30; i++) cells.push([i, 34 + (i % 2)]);
    expect(straighten(g, cells)).toEqual([cells[0], cells[cells.length - 1]]);
    expect(lineOfSight(g, 10, 36, 10, 10)).toBe(false); // through the wall
  });

  it('describes a two-floor route', async () => {
    const nav = testNav();
    const info = nav.level('ETH.TST.E')!;
    const route = await findRoute(nav, { ...cellCenter(info, CELL, 10, 36), levelId: 'ETH.TST.E' }, { ...cellCenter(info, CELL, 40, 10), levelId: 'ETH.TST.F' });
    expect(route.legs.map((l) => l.levelId)).toEqual(['ETH.TST.E', 'ETH.TST.F']);
    expect(route.legs[0].next?.kind).toBe('stairs');
    const total = route.legs.reduce((a, l) => a + l.length, 0);
    expect(route.length).toBeCloseTo(total, 6);
    expect(distance(route.legs[1].points[route.legs[1].points.length - 1], cellCenter(info, CELL, 40, 10))).toBeLessThan(0.5);
  });

  it('finds rooms by name', () => {
    const nav = testNav();
    expect(nav.searchRooms('tst f')[0][0]).toBe('TST F 1');
    expect(nav.searchRooms('TSTE1')[0][0]).toBe('TST E 1');
  });
});
