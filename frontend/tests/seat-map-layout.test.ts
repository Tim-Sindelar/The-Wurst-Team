import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import geometry from '../src/features/admin/geometry.js';
import type { LayoutDocument } from '../src/features/admin/models.ts';
import type { SeatAvailability } from '../src/api/generated/types.gen.ts';
import { layoutSeats } from '../src/domain/room.ts';

const seat = (id: string, label: string): SeatAvailability => ({
  id,
  label,
  is_active: true,
  reservable_at: null,
  state: 'free',
});

test('seats sit where the admin layout put them', () => {
  const room = geometry.roomFromCoordinates({
    id: 'room',
    label: 'HG E 1',
    coordinateUnit: 'm',
    coordinateAxis: 'cartesian',
    boundary: [
      [0, 0],
      [10, 0],
      [10, 8],
      [0, 8],
    ],
  });
  let objects = geometry.place(room, [], 'table', 240, 240, 'table-1');
  objects = geometry.place(room, objects, 'seat', 240, 196, 'seat-1');
  const layout: LayoutDocument = {
    schemaVersion: 1,
    unitsPerMeter: geometry.UNITS_PER_METER,
    room,
    objects: objects.map((item) =>
      item.type === 'seat'
        ? { ...item, backendSeatId: 'a', badges: ['outlet'] }
        : item,
    ),
  };
  const placed = layout.objects.find((item) => item.type === 'seat')!;

  const { plan, shown, hidden } = layoutSeats(
    [seat('a', '01'), seat('b', '02')],
    'a',
    layout,
  );

  assert.equal(plan?.room, layout.room);
  assert.deepEqual(
    plan?.furniture.map((item) => item.type),
    ['table'],
  );
  assert.equal(shown.length, 1);
  assert.deepEqual(
    {
      x: shown[0].x,
      y: shown[0].y,
      state: shown[0].state,
      badges: shown[0].badges,
    },
    { x: placed.x, y: placed.y, state: 'yours', badges: ['outlet'] },
  );
  assert.equal(hidden, 1);
});

test('without a layout seats fall back to the stand-in plan', () => {
  const { plan, shown } = layoutSeats([seat('a', '01')], null);
  assert.equal(plan, null);
  assert.equal(shown[0].angle, 0);
});
