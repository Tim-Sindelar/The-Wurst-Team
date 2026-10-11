import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeEvent,
  eventsUrl,
  reconnectDelay,
  shownOnScreen,
} from '../src/domain/serverEvents.ts';

const person = { id: 'a', name: 'Ana Novak' };

test('social events say who did what and link to it', () => {
  assert.deepEqual(
    describeEvent({
      type: 'friend_request.received',
      friendship_id: 'f',
      person,
    }),
    {
      icon: 'userPlus',
      title: 'Friend request from Ana Novak',
      link: '/requests',
      shownOn: ['/requests', '/friends'],
    },
  );
  const declined = describeEvent({
    type: 'party.replied',
    party_id: 'p 1',
    party_name: 'Study party',
    person,
    accepted: false,
  });
  assert.equal(declined?.title, 'Ana Novak declined Study party');
  assert.equal(declined?.icon, 'userX');
  assert.equal(declined?.link, '/groups/p%201');
  assert.equal(
    describeEvent({ type: 'party.cancelled', party_id: 'p', party_name: 'X' })
      ?.link,
    '/friends',
  );
});

test('no banner on a screen that already shows the change', () => {
  const joined = describeEvent({
    type: 'party.replied',
    party_id: 'p',
    party_name: 'Study party',
    person,
    accepted: true,
  })!;
  assert.equal(shownOnScreen(joined, '/groups/p'), true);
  assert.equal(shownOnScreen(joined, '/groups/p/'), true);
  assert.equal(shownOnScreen(joined, '/groups/p/seats'), true);
  assert.equal(shownOnScreen(joined, '/groups/other'), false);
  assert.equal(shownOnScreen(joined, '/'), false);
  const invited = describeEvent({
    type: 'party.invited',
    party_id: 'p',
    party_name: 'Study party',
    person,
  })!;
  assert.equal(shownOnScreen(invited, '/requests'), true);
  assert.equal(shownOnScreen(invited, '/friends'), false);
});

test('heartbeats show nothing', () => {
  assert.equal(describeEvent({ type: 'ping' }), null);
});

test('the stream sits next to the API', () => {
  const page = { href: 'https://02.hackathon.ethz.ch/pr/7/seats/1' };
  assert.equal(
    eventsUrl('/pr/7/', page),
    'https://02.hackathon.ethz.ch/pr/7/api/v1/events',
  );
  assert.equal(
    eventsUrl('/', { href: 'http://localhost:5173/' }),
    'http://localhost:5173/api/v1/events',
  );
  assert.equal(
    eventsUrl('https://api.example.com', page),
    'https://api.example.com/api/v1/events',
  );
});

test('reconnects back off from 1 s to at most 30 s', () => {
  assert.equal(reconnectDelay(0, 1), 1000);
  assert.equal(reconnectDelay(0, 0), 500);
  assert.equal(reconnectDelay(3, 1), 8000);
  assert.equal(reconnectDelay(20, 1), 30_000);
});
