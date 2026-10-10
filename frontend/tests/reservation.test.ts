import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreBooking, secondsUntil } from '../src/mock/reservation.ts';

const start = 1700000000000;
const deadline = start + 600000;

test('a new ten-minute hold begins at 600 seconds and rounds up partial seconds', () => {
  assert.equal(secondsUntil(deadline, start), 600);
  assert.equal(secondsUntil(deadline, start + 999), 600);
  assert.equal(secondsUntil(deadline, start + 1000), 599);
});

test('background time is counted and expiry is exact at the deadline', () => {
  assert.equal(secondsUntil(deadline, start + 480000), 120);
  assert.equal(secondsUntil(deadline, deadline - 1), 1);
  assert.equal(secondsUntil(deadline, deadline), 0);
  assert.equal(secondsUntil(deadline, deadline + 60000), 0);
});

test('reload retains the original deadline, while expired holds are released', () => {
  assert.deepEqual(
    restoreBooking('reserved', String(deadline), start + 300000),
    { booking: 'reserved', expiresAt: deadline },
  );
  assert.deepEqual(restoreBooking('reserved', String(deadline), deadline), {
    booking: 'none',
    expiresAt: null,
  });
  assert.deepEqual(restoreBooking('reserved', String(deadline), deadline + 1), {
    booking: 'none',
    expiresAt: null,
  });
});

test('legacy or invalid deadlines never create a permanent reservation', () => {
  for (const value of [null, '', 'NaN', 'Infinity', 'invalid', '0']) {
    assert.deepEqual(restoreBooking('reserved', value, start), {
      booking: 'none',
      expiresAt: null,
    });
  }
  assert.deepEqual(restoreBooking('none', String(deadline), start), {
    booking: 'none',
    expiresAt: null,
  });
  assert.deepEqual(restoreBooking('session', String(deadline), deadline + 1), {
    booking: 'session',
    expiresAt: null,
  });
});
