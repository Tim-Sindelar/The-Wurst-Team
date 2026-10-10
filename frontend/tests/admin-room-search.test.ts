import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { searchRooms } from '../src/features/admin/roomSearch.ts';
const labelOf = (room: { name: string }) => room.name;
test('exact room remains reachable when more than twelve rooms share its prefix', () => {
  const rooms = Array.from({ length: 25 }, (_, i) => ({
    name: 'HG E 3' + (10 + i) + '.0001',
    use: 'Betriebsraum',
    kind: 'service',
  }));
  rooms.push({ name: 'HG E 3', use: 'Hörsaal', kind: 'teaching' });
  assert.equal(
    searchRooms(rooms, 'HG E 3', labelOf).slice(0, 12)[0].name,
    'HG E 3',
  );
});
test('room search normalizes case and repeated whitespace without losing room information', () => {
  const room = { name: 'HG EO 30.0065', use: 'Seminarraum', kind: 'teaching' };
  assert.deepEqual(searchRooms([room], ' hg   eo  30.0065 ', labelOf), [room]);
  assert.deepEqual(searchRooms([room], 'seminar', labelOf), [room]);
  assert.deepEqual(searchRooms([room], 'HG E 30.65', labelOf), []);
});
test('the initial choices prioritize study rooms and use numeric room order', () => {
  const rooms = [
    { name: 'HG E 1.0001', use: 'Schrank', kind: 'service' },
    { name: 'HG E 10', use: 'Bibliothek', kind: 'library' },
    { name: 'HG E 2', use: 'Hörsaal', kind: 'teaching' },
  ];
  assert.deepEqual(
    searchRooms(rooms, '', labelOf).map((r) => r.name),
    ['HG E 2', 'HG E 10', 'HG E 1.0001'],
  );
});
