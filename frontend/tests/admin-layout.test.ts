import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import geometry from '../src/features/admin/geometry.js';
import { alignLayoutWalls } from '../src/features/admin/layoutOrientation.ts';
import { layoutSeatState } from '../src/features/admin/layoutSeatState.ts';
import type {
  LayoutDocument,
  LayoutItem,
} from '../src/features/admin/models.ts';

const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 0.000001, a + ' != ' + b);
function angledLayout(): LayoutDocument {
  const radians = (27 * Math.PI) / 180;
  const room = geometry.roomFromCoordinates({
    id: 'angled',
    label: 'HG E 3',
    coordinateUnit: 'm',
    coordinateAxis: 'cartesian',
    boundary: [
      [0, 0],
      [12, 0],
      [12, 9],
      [0, 9],
    ].map(([x, y]) => [
      x * Math.cos(radians) - y * Math.sin(radians),
      x * Math.sin(radians) + y * Math.cos(radians),
    ]),
  });
  let objects = geometry.place(
    room,
    [],
    'table',
    room.width / 2,
    room.height / 2,
    'table-a',
  );
  const slot = geometry.slots(objects[0])[0];
  objects = geometry.place(room, objects, 'seat', slot.x, slot.y, 'seat-1');
  objects = geometry.place(
    room,
    objects,
    'window',
    room.points[0][0],
    room.points[0][1],
    'window-1',
  );
  objects = geometry.place(
    room,
    objects,
    'door',
    room.points[1][0],
    room.points[1][1],
    'door-1',
  );
  return { schemaVersion: 1, unitsPerMeter: 64, room, objects };
}
test('room alignment keeps furniture, wall attachments and source coordinates intact', () => {
  const original = angledLayout();
  const aligned = alignLayoutWalls(original);
  geometry.assertLayout(aligned.room, aligned.objects);
  close(aligned.room.measurements.widthMeters, 12);
  close(aligned.room.measurements.heightMeters, 9);
  close(
    aligned.room.measurements.areaSquareMeters,
    original.room.measurements.areaSquareMeters,
  );
  for (let i = 0; i < aligned.room.points.length; i++) {
    const [x, y] = aligned.room.points[i];
    const [nx, ny] = aligned.room.points[(i + 1) % aligned.room.points.length];
    assert.ok(Math.abs(x - nx) < 0.000001 || Math.abs(y - ny) < 0.000001);
    const before = geometry.sourcePoint(
      original.room,
      ...original.room.points[i],
    );
    const after = geometry.sourcePoint(aligned.room, x, y);
    close(before.x, after.x);
    close(before.y, after.y);
  }
  for (const item of original.objects) {
    const after = aligned.objects.find((o) => o.id === item.id)!;
    const beforePoint = geometry.sourcePoint(original.room, item.x, item.y);
    const afterPoint = geometry.sourcePoint(aligned.room, after.x, after.y);
    close(beforePoint.x, afterPoint.x);
    close(beforePoint.y, afterPoint.y);
    assert.equal(after.tableId, item.tableId);
    assert.equal(after.number, item.number);
  }
  // A saved aligned room must not rotate again on reload.
  assert.equal(alignLayoutWalls(aligned), aligned);
});
test('wall features remain resizable after aligning an existing layout', () => {
  const layout = alignLayoutWalls(angledLayout());
  for (const type of ['window', 'door']) {
    const item = layout.objects.find((o) => o.type === type)!;
    for (const handle of ['w', 'e']) {
      const p = geometry.handlePoint(item, handle);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      const resized = geometry.resizeBy(
        layout.room,
        layout.objects,
        item.id,
        handle,
        16,
        16,
      );
      geometry.assertLayout(layout.room, resized);
      assert.notEqual(resized.find((o) => o.id === item.id)!.width, item.width);
    }
  }
});
test('new seats use the free colour while saved seats retain live availability', () => {
  const seat = { id: 'draft', type: 'seat', active: true } as LayoutItem;
  const live = [{ id: 'backend', state: 'reserved' }];
  assert.equal(layoutSeatState(seat, live), 'free');
  assert.equal(
    layoutSeatState({ ...seat, active: false }, live),
    'unavailable',
  );
  assert.equal(
    layoutSeatState({ ...seat, backendSeatId: 'backend' }, live),
    'reserved',
  );
  assert.equal(
    layoutSeatState({ ...seat, backendSeatId: 'missing' }, live),
    'unknown',
  );
});

test('doors open into the room for either native polygon winding', () => {
  const boundary = [
    [0, 0],
    [12, 0],
    [12, 9],
    [0, 9],
  ];
  for (const points of [boundary, [...boundary].reverse()]) {
    const room = geometry.roomFromCoordinates({
      id: 'door',
      coordinateUnit: 'm',
      boundary: points,
    });
    for (let i = 0; i < room.points.length; i++) {
      const [x, y] = room.points[i],
        [nx, ny] = room.points[(i + 1) % room.points.length];
      const [door] = geometry.place(
        room,
        [],
        'door',
        (x + nx) / 2,
        (y + ny) / 2,
        'door',
      );
      const angle = (door.angle * Math.PI) / 180;
      assert.ok(
        geometry.contains(
          room,
          door.x - (Math.sin(angle) * door.width) / 2,
          door.y + (Math.cos(angle) * door.width) / 2,
        ),
      );
    }
  }
});

test('rooms keep pillar holes through alignment and accept furniture over them', () => {
  // A 10 m square turned 27° with a 1 m pillar in the middle.
  const radians = (27 * Math.PI) / 180;
  const turn = (ring: number[][]) =>
    ring.map(([x, y]) => [
      x * Math.cos(radians) - y * Math.sin(radians),
      x * Math.sin(radians) + y * Math.cos(radians),
    ]);
  const square = (x0: number, size: number) =>
    turn([
      [x0, x0],
      [x0 + size, x0],
      [x0 + size, x0 + size],
      [x0, x0 + size],
    ]);
  const { room } = alignLayoutWalls({
    schemaVersion: 1,
    unitsPerMeter: 64,
    objects: [],
    room: geometry.roomFromCoordinates({
      id: 'pillar',
      label: 'HG E 1',
      coordinateUnit: 'm',
      coordinateAxis: 'cartesian',
      boundary: square(0, 10),
      holes: [square(4.5, 1)],
    }),
  });
  close(room.measurements.areaSquareMeters, 99);
  assert.equal(room.holes?.length, 1);
  const hole = room.holes![0];
  // Aligned to the walls, the pillar is an axis-parallel 1 m square in the middle.
  const xs = hole.map(([x]) => x),
    ys = hole.map(([, y]) => y);
  close(Math.max(...xs) - Math.min(...xs), 64);
  close(Math.max(...ys) - Math.min(...ys), 64);
  close((Math.max(...xs) + Math.min(...xs)) / 2, room.width / 2);
  close((Math.max(...ys) + Math.min(...ys)) / 2, room.height / 2);
  const objects = geometry.place(
    room,
    [],
    'table',
    room.width / 2,
    room.height / 2,
    'table-a',
  );
  assert.equal(objects.length, 1);
});
function squareRoom() {
  return geometry.roomFromCoordinates({
    id: 'square',
    label: 'Square',
    coordinateUnit: 'm',
    boundary: [
      [0, 0],
      [12, 0],
      [12, 12],
      [0, 12],
    ],
  });
}
test('furniture size scales tables, rows and their seats around their centres', () => {
  const room = squareRoom();
  let objects = geometry.place(room, [], 'table', 300, 300, 'table-a');
  for (const slot of geometry.slots(objects[0]).slice(0, 2))
    objects = geometry.place(room, objects, 'seat', slot.x, slot.y, slot.slot);
  objects = geometry.place(room, objects, 'row', 450, 600, 'row-a');
  const seats = objects.filter((o) => o.type === 'seat').length;
  const scaled = geometry.rescale(room, objects, 1.5);
  assert.equal(geometry.layoutScale(scaled), 1.5);
  assert.equal(scaled.filter((o) => o.type === 'seat').length, seats);
  geometry.assertLayout(room, scaled);
  const before = objects.find((o) => o.id === 'table-a')!;
  const after = scaled.find((o) => o.id === 'table-a')!;
  assert.equal(after.x, before.x);
  assert.equal(after.width, before.width);
  const seat = (items: LayoutItem[]) =>
    items.find((o) => o.type === 'seat' && o.tableId === 'table-a')!;
  close(seat(scaled).y - after.y, 1.5 * (seat(objects).y - before.y));
  // New furniture takes the layout's size.
  const placed = geometry.place(room, scaled, 'table', 300, 120, 'table-b');
  assert.equal(placed.find((o) => o.id === 'table-b')!.scale, 1.5);
  assert.throws(() => geometry.rescale(room, objects, 3));
});
test('scaled tables resize between presets from their scaled corners', () => {
  const room = squareRoom();
  const objects = geometry.rescale(
    room,
    geometry.place(room, [], 'table', 300, 300, 'table-a'),
    1.5,
  );
  const table = objects[0];
  const corner = geometry.handlePoint(table, 'se');
  close(corner.x - table.x, (1.5 * table.width) / 2);
  const resized = geometry.resizeBy(room, objects, 'table-a', 'se', 16, 0);
  assert.equal(resized[0].width, 176);
});
test('seat rows space rows and columns by their own percentages', () => {
  const room = squareRoom();
  let objects = geometry.place(room, [], 'row', 380, 300, 'row-a');
  objects = geometry.update(room, objects, 'row-a', { sweep: 0 });
  const gap = (items: LayoutItem[], a: string, b: string) => {
    const seat = (slot: string) =>
      items.find((o) => o.type === 'seat' && o.slot === slot)!;
    return Math.hypot(seat(a).x - seat(b).x, seat(a).y - seat(b).y);
  };
  close(gap(objects, 'row0:0', 'row0:1'), 48);
  close(gap(objects, 'row0:0', 'row1:0'), 64);
  objects = geometry.update(room, objects, 'row-a', {
    seatSpacing: 150,
    rowSpacing: 125,
  });
  close(gap(objects, 'row0:0', 'row0:1'), 72);
  close(gap(objects, 'row0:0', 'row1:0'), 80);
  assert.throws(() =>
    geometry.update(room, objects, 'row-a', { seatSpacing: 60 }),
  );
});
