import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import geometry from '../src/features/admin/geometry.js';
import { rotationFromPointer } from '../src/features/admin/layoutRotation.ts';

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);
const item = { x: 240, y: 320, angle: 37 };
const pointerAt = (angle: number, distance = 100) => ({
  x: item.x + Math.cos((angle * Math.PI) / 180) * distance,
  y: item.y + Math.sin((angle * Math.PI) / 180) * distance,
});
const room = () =>
  geometry.roomFromCoordinates({
    id: 'rotation-room',
    coordinateUnit: 'm',
    boundary: [
      [0, 0],
      [12, 0],
      [12, 12],
      [0, 12],
    ],
  });

test('corner rotation starts at the existing angle without jumping to the pointer direction', () => {
  const start = pointerAt(140);
  close(rotationFromPointer(item, start, start, false), 37);
  close(rotationFromPointer(item, start, pointerAt(230), false), 127);
  // Changing distance while retaining direction must not rotate the table.
  close(rotationFromPointer(item, start, pointerAt(140, 50), false), 37);
});

test('rotation crosses the angle boundary in either direction', () => {
  close(
    rotationFromPointer(
      { ...item, angle: 350 },
      pointerAt(170),
      pointerAt(-170),
      false,
    ),
    10,
  );
  close(
    rotationFromPointer(
      { ...item, angle: 10 },
      pointerAt(-170),
      pointerAt(170),
      false,
    ),
    350,
  );
});

test('Shift snaps the resulting table angle to 15 degrees', () => {
  const start = pointerAt(20),
    point = pointerAt(26);
  close(rotationFromPointer(item, start, point, false), 43);
  close(rotationFromPointer(item, start, point, true), 45);
  close(rotationFromPointer({ ...item, angle: 358 }, start, start, true), 0);
});

test('a pointer at the centre retains the original angle', () => {
  close(rotationFromPointer(item, pointerAt(20), item, true), item.angle);
  close(rotationFromPointer(item, item, pointerAt(20), false), item.angle);
});

test('rotating every table shape retains attached seats and their backend identities', () => {
  const boundary = room();
  for (const tool of ['table', 'round', 'l', 'curved'] as const) {
    let objects = geometry.place(boundary, [], tool, 400, 400, 'table-a');
    const table = objects[0];
    const available = geometry.slots(table);
    for (const [index, slot] of [available[0], available.at(-1)!].entries()) {
      objects = geometry.place(
        boundary,
        objects,
        'seat',
        slot.x,
        slot.y,
        `seat-${index + 1}`,
      );
    }
    objects = objects.map((object) =>
      object.type === 'seat'
        ? {
            ...object,
            backendSeatId: `backend-${object.id}`,
            backendLabel: `Seat ${object.number}`,
          }
        : object,
    );
    const rotated = geometry.update(boundary, objects, table.id, {
      angle: 138.2,
    });
    geometry.assertLayout(boundary, rotated);
    assert.equal(rotated.length, objects.length);
    assert.equal(rotated.find((o) => o.id === table.id)!.label, table.label);
    for (const original of objects.filter((o) => o.type === 'seat')) {
      const seat = rotated.find((o) => o.id === original.id)!;
      const expected = geometry
        .slots(rotated.find((o) => o.id === table.id)!)
        .find((slot) => slot.slot === original.slot)!;
      assert.equal(seat.tableId, original.tableId);
      assert.equal(seat.slot, original.slot);
      assert.equal(seat.number, original.number);
      assert.equal(seat.backendSeatId, original.backendSeatId);
      assert.equal(seat.backendLabel, original.backendLabel);
      close(seat.x, expected.x);
      close(seat.y, expected.y);
      close(seat.angle, expected.angle);
    }
    // Pointer previews must leave the drag's initial document untouched.
    assert.equal(objects[0].angle, 0);
  }
});

test('rotation rejects overlaps and room-boundary violations without mutating the layout', () => {
  const boundary = room();
  let objects = geometry.place(boundary, [], 'table', 400, 400, 'table-a');
  objects = geometry.update(boundary, objects, 'table-a', { width: 176 });
  objects = geometry.place(boundary, objects, 'table', 400, 500, 'table-b');
  assert.throws(
    () => geometry.update(boundary, objects, 'table-a', { angle: 90 }),
    /cannot overlap/,
  );
  assert.equal(objects[0].angle, 0);
  const nearWall = geometry.place(boundary, [], 'table', 400, 52, 'near-wall');
  assert.throws(
    () => geometry.update(boundary, nearWall, 'near-wall', { angle: 90 }),
    /must fit inside the room/,
  );
  assert.equal(nearWall[0].angle, 0);
});
