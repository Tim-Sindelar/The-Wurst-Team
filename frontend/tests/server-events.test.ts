import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeEvent,
  eventsUrl,
  reconnectDelay,
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
      link: '/social-draft',
    },
  );
  const declined = describeEvent({
    type: 'party.replied',
    party_id: 'p 1',
    party_name: 'Study group',
    person,
    accepted: false,
  });
  assert.equal(declined?.title, 'Ana Novak declined Study group');
  assert.equal(declined?.icon, 'userX');
  assert.equal(declined?.link, '/social-draft/party/p%201');
  assert.equal(
    describeEvent({ type: 'party.cancelled', party_id: 'p', party_name: 'X' })
      ?.link,
    '/social-draft/parties',
  );
});

test('heartbeats show nothing', () => {
  assert.equal(describeEvent({ type: 'ping' }), null);
});

test('the socket sits next to the API, on ws or wss', () => {
  const page = { href: 'https://02.hackathon.ethz.ch/pr/7/seats/1' };
  assert.equal(
    eventsUrl('/pr/7/', page),
    'wss://02.hackathon.ethz.ch/pr/7/api/v1/events',
  );
  assert.equal(
    eventsUrl('/', { href: 'http://localhost:5173/' }),
    'ws://localhost:5173/api/v1/events',
  );
  assert.equal(
    eventsUrl('https://api.example.com', page),
    'wss://api.example.com/api/v1/events',
  );
});

test('reconnects back off from 1 s to at most 30 s', () => {
  assert.equal(reconnectDelay(0, 1), 1000);
  assert.equal(reconnectDelay(0, 0), 500);
  assert.equal(reconnectDelay(3, 1), 8000);
  assert.equal(reconnectDelay(20, 1), 30_000);
});
