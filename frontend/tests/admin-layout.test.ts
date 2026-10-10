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
