import assert from 'node:assert/strict';
import test from 'node:test';
import {
  apiProblem,
  secondsBetween,
  toClientMs,
} from '../src/domain/booking.ts';
import { layoutSeats } from '../src/domain/room.ts';
import {
  describeAvailability,
  favouriteSpaces,
  recentSpaces,
  filterSpaces,
  type StudySpace,
} from '../src/domain/space.ts';
import { tokenize } from '../src/domain/similarity.ts';
import { secondsUntil } from '../src/hooks/useCountdown.ts';

test('countdowns round partial seconds up and stop at zero', () => {
  const deadline = 1_700_000_600_000;
  assert.equal(secondsUntil(deadline, deadline - 600_000), 600);
  assert.equal(secondsUntil(deadline, deadline - 599_001), 600);
  assert.equal(secondsUntil(deadline, deadline - 1), 1);
  assert.equal(secondsUntil(deadline, deadline), 0);
  assert.equal(secondsUntil(deadline, deadline + 60_000), 0);
});

test('server times are moved onto the local clock', () => {
  const server = '2030-01-01T10:00:00Z';
  const deadline = '2030-01-01T10:15:00Z';
  // The device clock is an hour off: only the 15 minute gap matters.
  const receivedAt = Date.parse(server) + 3_600_000;
  assert.equal(toClientMs(deadline, server, receivedAt), receivedAt + 900_000);
  assert.equal(secondsBetween(server, deadline), 900);
});

test('API problems become a code and a sentence', () => {
  assert.deepEqual(apiProblem({ code: 'too_early', detail: 'x' }), {
    code: 'too_early',
    message: "Your reservation hasn't started yet.",
  });
  assert.deepEqual(apiProblem({ code: 'new_code', detail: 'Server says no' }), {
    code: 'new_code',
    message: 'Server says no',
  });
  assert.deepEqual(apiProblem({ detail: 'Bad header' }), {
    code: null,
    message: 'Bad header',
  });
  assert.equal(apiProblem(new TypeError('Failed to fetch')).code, null);
  assert.equal(
    apiProblem(undefined).message,
    'Something went wrong. Try again.',
  );
});

test('availability reads closed, full, almost full and free', () => {
  assert.deepEqual(describeAvailability(5, 10, false), {
    availability: 'none',
    availabilityText: 'Closed',
  });
  assert.equal(
    describeAvailability(0, 10, true).availabilityText,
    '0 free · full',
  );
  assert.equal(describeAvailability(2, 10, true).availability, 'mid');
  assert.equal(describeAvailability(3, 10, true).availability, 'high');
  assert.equal(describeAvailability(4, 4, true).availabilityText, '4 free');
});

const seat = (id: string, label: string, state: string, active = true) =>
  ({ id, label, state, is_active: active, reservable_at: null }) as never;

test('the map skips out-of-service seats, orders by label and marks your seat', () => {
  const { shown, hidden } = layoutSeats(
    [
      seat('c', 'A-10', 'free'),
      seat('a', 'A-2', 'on_break'),
      seat('x', 'A-3', 'unavailable'),
      seat('y', 'A-4', 'free', false),
      seat('b', 'A-1', 'claimable'),
    ],
    'c',
  );
  assert.deepEqual(
    shown.map((item) => [item.label, item.state]),
    [
      ['A-1', 'bookable'],
      ['A-2', 'break'],
      ['A-10', 'yours'],
    ],
  );
  assert.equal(hidden, 0);
});

test('seats beyond the room plan are counted, not stacked', () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    seat(`s${i}`, `S-${i}`, 'free'),
  );
  const { shown, hidden } = layoutSeats(many, null);
  assert.equal(shown.length, 35);
  assert.equal(hidden, 5);
  assert.equal(new Set(shown.map((item) => `${item.x},${item.y}`)).size, 35);
});

const space = (name: string, favourite: boolean): StudySpace => ({
  id: name,
  name,
  freeSeats: 1,
  availability: 'high',
  availabilityText: '1 free',
  favourite,
});

test('search matches the name anywhere, ignoring case and padding', () => {
  const spaces = [space('Main Library', false), space('Annex', false)];
  assert.deepEqual(
    filterSpaces(spaces, '  LIB ').map((item) => item.name),
    ['Main Library'],
  );
  assert.equal(filterSpaces(spaces, '   ').length, 2);
  assert.equal(filterSpaces(spaces, 'zzz').length, 0);
});

test('search is forgiving: typos, word order, partial words, accents', () => {
  const spaces = [
    space('Demo: HG E 51', false),
    space('Demo: CAB E 11.1', false),
    space('Demo: Baubibliothek HIL E 2.1', false),
    space('Café Zürich', false),
  ];
  const find = (query: string) =>
    filterSpaces(spaces, query).map((item) => item.name);
  assert.deepEqual(find('bauibliothek'), ['Demo: Baubibliothek HIL E 2.1']);
  assert.deepEqual(find('baubib'), ['Demo: Baubibliothek HIL E 2.1']);
  assert.deepEqual(find('11 cab'), ['Demo: CAB E 11.1']);
  assert.deepEqual(find('cabe11'), ['Demo: CAB E 11.1']);
  assert.deepEqual(find('zurich cafe'), ['Café Zürich']);
  assert.deepEqual(find('xyzq'), []);
  assert.deepEqual(tokenize('A1b2 HG-E51'), [
    'a',
    '1',
    'b',
    '2',
    'hg',
    'e',
    '51',
  ]);
});

test('search ranks the closest match first', () => {
  const spaces = [
    space('Library annex', false),
    space('Main library', false),
    space('Libary', false),
  ];
  assert.deepEqual(
    filterSpaces(spaces, 'library').map((item) => item.name),
    ['Library annex', 'Main library', 'Libary'],
  );
  assert.deepEqual(
    filterSpaces(spaces, 'main lib').map((item) => item.name),
    ['Main library'],
  );
});

test('favourites keep their order', () => {
  const spaces = [
    space('A', false),
    space('B', true),
    space('C', false),
    space('D', true),
  ];
  assert.deepEqual(
    favouriteSpaces(spaces).map((item) => item.name),
    ['B', 'D'],
  );
});

test('recents list the known spaces, most recent first', () => {
  const spaces = [space('A', false), space('B', true), space('C', false)];
  assert.deepEqual(
    recentSpaces(spaces, ['C', 'gone', 'A']).map((item) => item.name),
    ['C', 'A'],
  );
});
