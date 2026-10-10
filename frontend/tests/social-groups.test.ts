import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  PartyResponse,
  ReservationDetails,
} from '../src/api/generated/index.ts';
import {
  activeGroup,
  groupSummary,
  initials,
  invitations,
  lastCancelledGroup,
} from '../src/features/social/groups.ts';
import { seatTogether } from '../src/features/social/seatTogether.ts';

const me = 'me';
const person = (id: string, name = id) => ({ id, name });
const group = (
  id: string,
  status: PartyResponse['status'],
  members: [string, PartyResponse['members'][number]['status'], string?][],
  organizer = me,
  created_at = '2026-10-10T10:00:00Z',
): PartyResponse => ({
  id,
  name: `Group ${id}`,
  status,
  organizer_id: organizer,
  created_at,
  members: members.map(([who, memberStatus, reservation]) => ({
    person: person(who),
    status: memberStatus,
    reservation_id: reservation ?? null,
    seat: null,
  })),
});
const reservation = (id: string, status: string) =>
  ({ id, status }) as unknown as ReservationDetails;

test('the active group is an open one you joined, or a booked one while your seat lives', () => {
  const open = group('open', 'open', [[me, 'accepted']]);
  const invite = group('invite', 'open', [[me, 'invited']], 'ana');
  assert.equal(activeGroup([invite, open], me, null)?.id, 'open');
  assert.equal(activeGroup([invite], me, null), null);

  const booked = group('booked', 'booked', [[me, 'accepted', 'r1']]);
  assert.equal(
    activeGroup([booked], me, reservation('r1', 'pending'))?.id,
    'booked',
  );
  assert.equal(activeGroup([booked], me, reservation('r1', 'ended')), null);
  assert.equal(activeGroup([booked], me, reservation('r2', 'active')), null);
  assert.equal(
    activeGroup([group('c', 'cancelled', [[me, 'accepted']])], me, null),
    null,
  );
});

test('invitations are open groups you have not answered', () => {
  const groups = [
    group('a', 'open', [[me, 'invited']], 'ana'),
    group('b', 'open', [[me, 'declined']], 'ana'),
    group('c', 'cancelled', [[me, 'invited']], 'ana'),
  ];
  assert.deepEqual(
    invitations(groups, me).map((item) => item.id),
    ['a'],
  );
});

test('the last cancelled group offers its people again, not you and not those who said no', () => {
  const older = group(
    'old',
    'cancelled',
    [
      [me, 'accepted'],
      ['ana', 'accepted'],
    ],
    me,
    '2026-10-01T10:00:00Z',
  );
  const newer = group(
    'new',
    'cancelled',
    [
      [me, 'accepted'],
      ['ana', 'accepted'],
      ['ben', 'invited'],
      ['cem', 'declined'],
      ['dan', 'left'],
    ],
    me,
    '2026-10-09T10:00:00Z',
  );
  const theirs = group('theirs', 'cancelled', [[me, 'accepted']], 'ana');
  const last = lastCancelledGroup([older, newer, theirs], me);
  assert.equal(last?.name, 'Group new');
  assert.deepEqual(
    last?.people.map((p) => p.id),
    ['ana', 'ben'],
  );
  assert.equal(lastCancelledGroup([theirs], me), null);
});

test('summary and initials stay short', () => {
  assert.equal(
    groupSummary(
      group('g', 'open', [
        [me, 'accepted'],
        ['a', 'accepted'],
        ['b', 'invited'],
      ]),
    ),
    '2 going · 1 invited',
  );
  assert.equal(groupSummary(group('g', 'open', [[me, 'accepted']])), '1 going');
  assert.equal(initials('Sofia Marques-Villanueva'), 'SM');
  assert.equal(initials('  ana  '), 'A');
});

const tables = [
  { x: 96, y: 122, width: 128, height: 36 },
  { x: 372, y: 122, width: 128, height: 36 },
];
const seat = (id: string, x: number, y: number) => ({ id, x, y });

test('seat us together keeps the group at one table when one has room', () => {
  const free = [
    seat('a1', 132, 92),
    seat('a2', 188, 188),
    seat('b1', 408, 92),
    seat('b2', 464, 92),
    seat('b3', 408, 188),
  ];
  assert.deepEqual(seatTogether(free, 3, tables), ['b1', 'b2', 'b3']);
  assert.deepEqual(seatTogether(free, 2, tables)?.length, 2);
});

test('seat us together falls back to the closest seats, and says when there are too few', () => {
  const free = [seat('a1', 132, 92), seat('b1', 408, 92), seat('b2', 464, 92)];
  assert.deepEqual(seatTogether(free, 3, tables)?.sort(), ['a1', 'b1', 'b2']);
  assert.equal(seatTogether(free, 4, tables), null);
  assert.equal(seatTogether([], 0, tables), null);
});
