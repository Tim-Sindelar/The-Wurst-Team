import assert from 'node:assert/strict';
import test from 'node:test';
import type { FriendResponse } from '../src/api/generated/index.ts';
import {
  friendsBySeat,
  friendWhere,
  studyingFriends,
  studyingMark,
} from '../src/features/social/studying.ts';

const room = (space: string, seat: string, on_break = false) => ({
  id: space,
  name: `Room ${space}`,
  seat_id: seat,
  seat_label: seat.toUpperCase(),
  on_break,
});
const friend = (
  name: string,
  where: FriendResponse['room'] = null,
): FriendResponse => ({
  friendship_id: `f-${name}`,
  person: { id: name, name, photo_url: null },
  room: where,
});

test('studying friends are the checked-in ones, by name', () => {
  const list = [
    friend('Zoë', room('a', 's1')),
    friend('Ben'),
    friend('Ada', room('b', 's2', true)),
  ];
  assert.deepEqual(
    studyingFriends(list).map((item) => item.person.name),
    ['Ada', 'Zoë'],
  );
});

test('a friend says where they are', () => {
  assert.equal(friendWhere(room('a', 's1')), 'Room a · seat S1');
  assert.equal(
    friendWhere(room('a', 's1', true)),
    'Room a · seat S1 · on a break',
  );
  assert.equal(studyingMark(room('a', 's1')), 'here');
  assert.equal(studyingMark(room('a', 's1', true)), 'break');
  assert.equal(studyingMark(null), undefined);
});

test('the seat map gets only the friends in its space, by seat', () => {
  const list = [
    friend('Ada Lovelace', room('a', 's1', true)),
    friend('Ben', room('b', 's2')),
    friend('Cy'),
  ];
  assert.deepEqual(friendsBySeat(list, 'a'), {
    s1: {
      name: 'Ada Lovelace',
      initials: 'AL',
      photoUrl: null,
      onBreak: true,
    },
  });
});
