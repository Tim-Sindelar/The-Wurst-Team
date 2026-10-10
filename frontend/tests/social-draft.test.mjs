import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeDraftParties,
  activeDraftParty,
  isDraftPartyActive,
  holdSeconds,
  sessionSeconds,
  draftReducer,
  initialDraftState,
  partyPath,
  restoreDraftState,
  loadDraftState,
  saveDraftState,
} from '../src/features/social-draft/draft.ts';

const releasedDemo = () =>
  draftReducer(initialDraftState(), {
    type: 'cancel-party',
    partyId: 'afternoon-study',
  });

test('separate PR previews and local development keep separate saved demos', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map();
  const mockStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });
  try {
    const custom = draftReducer(releasedDemo(), {
      type: 'create-party',
      id: 'pr-only',
      name: 'Only in PR 23',
    });
    saveDraftState(custom, '/pr/23/');
    saveDraftState(initialDraftState(), '/pr/24/');
    assert.equal(loadDraftState('/pr/23/').parties[0].name, 'Only in PR 23');
    assert.equal(loadDraftState('/pr/24/').parties.length, 2);
    assert.equal(loadDraftState().parties.length, 2);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, 'localStorage', previous);
  }
});

test('local demo shows one incoming invitation and one fully joined four-person party', () => {
  const { parties, viewer } = initialDraftState();
  const invitations = parties.filter((p) =>
    p.members.some((m) => m.person.id === viewer && m.status === 'invited'),
  );
  const joined = parties.filter((p) =>
    p.members.some((m) => m.person.id === viewer && m.status === 'accepted'),
  );
  assert.equal(invitations.length, 1);
  assert.equal(invitations[0].organizerId, 'anna');
  assert.equal(joined.length, 1);
  assert.equal(joined[0].members.length, 4);
  assert(joined[0].members.every((m) => m.status === 'accepted'));
});

test('invited member can join but cannot book or cancel Anna’s party', () => {
  const state = initialDraftState();
  const partyId = 'anna-study';
  assert.equal(draftReducer(state, { type: 'cancel-party', partyId }), state);
  assert.equal(
    draftReducer(state, {
      type: 'book',
      partyId,
      assignments: { you: 1 },
      now: 1000,
    }),
    state,
  );
  assert.equal(
    draftReducer(state, { type: 'reply', partyId, accept: true }),
    state,
  );
  const joined = draftReducer(releasedDemo(), {
    type: 'reply',
    partyId,
    accept: true,
  });
  assert.equal(
    joined.parties[1].members.find((m) => m.person.id === 'you').status,
    'accepted',
  );
  assert.equal(joined.parties[1].organizerId, 'anna');
  assert.equal(draftReducer(joined, { type: 'cancel-party', partyId }), joined);
});

test('older saved demo preserves custom parties and checked-in sessions without adding a second active party', () => {
  let old = draftReducer(initialDraftState(), {
    type: 'book',
    partyId: 'afternoon-study',
    assignments: { you: 1, theo: 4, luca: 2, mia: 3 },
    now: 1000,
  });
  old = draftReducer(old, { type: 'check-in', partyId: 'afternoon-study' });
  old = draftReducer(old, { type: 'cancel-party', partyId: 'afternoon-study' });
  old = draftReducer(old, {
    type: 'create-party',
    id: 'custom',
    name: 'My custom party',
  });
  const legacy = {
    ...old,
    demoSeedVersion: undefined,
    parties: old.parties
      .filter((p) => p.id !== 'anna-study')
      .map((p) => ({ ...p, organizerId: undefined })),
  };
  const upgraded = restoreDraftState(JSON.stringify(legacy));
  assert(upgraded.parties.some((p) => p.name === 'My custom party'));
  assert(upgraded.parties.some((p) => p.id === 'anna-study'));
  assert.equal(activeDraftParty(upgraded.parties).id, 'custom');
  assert.equal(
    upgraded.parties
      .find((p) => p.id === 'afternoon-study')
      .members.find((m) => m.person.id === 'you').checkedIn,
    true,
  );
  assert(!upgraded.parties.some((p) => p.id === 'afternoon-study-demo'));
  const declined = draftReducer(upgraded, {
    type: 'reply',
    partyId: 'anna-study',
    accept: false,
  });
  assert.deepEqual(
    restoreDraftState(JSON.stringify(declined)).parties,
    declined.parties,
  );
});

test('cancelled parties leave the active list without deleting checked-in sessions', () => {
  let state = initialDraftState();
  state = draftReducer(state, {
    type: 'book',
    assignments: { you: 1, theo: 4, luca: 2, mia: 3 },
    now: 1000,
  });
  state = draftReducer(state, { type: 'check-in' });
  state = draftReducer(state, { type: 'cancel-party' });
  assert.deepEqual(
    activeDraftParties(state.parties).map((p) => p.id),
    ['anna-study'],
  );
  assert.equal(
    state.parties[0].members.find((m) => m.person.id === 'you').checkedIn,
    true,
  );
  assert.equal(
    state.parties[0].members.find((m) => m.person.id === 'you').cancelled,
    false,
  );
});

test('creating parties keeps earlier parties and gives each one a separate link', () => {
  let state = releasedDemo();
  const sample = state.parties[0];
  state = draftReducer(state, {
    type: 'create-party',
    id: 'first',
    name: ' Thursday crew ',
  });
  assert.equal(
    draftReducer(state, {
      type: 'create-party',
      id: 'blocked',
      name: 'Blocked',
    }),
    state,
  );
  state = draftReducer(state, { type: 'cancel-party', partyId: 'first' });
  state = draftReducer(state, {
    type: 'create-party',
    id: 'second',
    name: 'Friday crew',
  });
  assert.deepEqual(
    state.parties.map((p) => p.name),
    ['Friday crew', 'Thursday crew', 'Afternoon study', 'Anna’s study group'],
  );
  assert.equal(state.parties[2], sample);
  assert.equal(state.parties[0].members.length, 1);
  assert.equal(state.activePartyId, 'second');
  assert.notEqual(partyPath('first'), partyPath('second'));
  assert.equal(
    partyPath('first', 'invite'),
    '/social-draft/party/first/invite',
  );
});

test('invitations target their party and require acceptance without changing other parties', () => {
  let state = draftReducer(releasedDemo(), {
    type: 'create-party',
    id: 'new',
    name: 'New party',
  });
  const other = state.parties[2];
  state = {
    ...state,
    friends: [...state.friends, { id: 'sam', name: 'Sam Keller', room: null }],
  };
  state = draftReducer(state, {
    type: 'invite-members',
    partyId: 'new',
    invited: ['sam'],
  });
  state = draftReducer(state, {
    type: 'invite-members',
    partyId: 'new',
    invited: ['sam'],
  });
  assert.equal(
    state.parties[0].members.filter((m) => m.person.id === 'sam').length,
    1,
  );
  assert.equal(
    state.parties[0].members.find((m) => m.person.id === 'sam').status,
    'invited',
  );
  assert.equal(state.parties[2], other);
  state = draftReducer(state, { type: 'viewer', id: 'sam' });
  state = draftReducer(state, { type: 'reply', partyId: 'new', accept: true });
  assert.equal(
    state.parties[0].members.find((m) => m.person.id === 'sam').status,
    'accepted',
  );
});

test('reload retains parties, requests and privacy, and leaves preview perspective at organizer', () => {
  let state = draftReducer(releasedDemo(), {
    type: 'create-party',
    id: 'new',
    name: 'New party',
  });
  state = draftReducer(state, { type: 'privacy', enabled: true });
  state = draftReducer(state, { type: 'accept-request', id: 'nora' });
  state = draftReducer(state, { type: 'viewer', id: 'anna' });
  const restored = restoreDraftState(JSON.stringify(state));
  assert.deepEqual(restored.parties, state.parties);
  assert.deepEqual(restored.friends, state.friends);
  assert.deepEqual(restored.requests, state.requests);
  assert.equal(restored.shareRoom, true);
  assert.equal(restored.viewer, 'you');
});

test('corrupt and old saved previews reset safely', () => {
  for (const saved of [
    null,
    '{',
    '{}',
    '{"party":{"name":"old"}}',
    JSON.stringify({ ...initialDraftState(), parties: [] }),
  ]) {
    assert.deepEqual(restoreDraftState(saved), initialDraftState());
  }
});

test('booking, individual check-in and cancellation preserve the waiting invitation', () => {
  let state = initialDraftState();
  const other = state.parties[1];
  state = draftReducer(state, {
    type: 'book',
    partyId: 'afternoon-study',
    assignments: { you: 1, theo: 4, luca: 2, mia: 3 },
    now: 1000,
  });
  state = draftReducer(state, { type: 'viewer', id: 'luca' });
  state = draftReducer(state, { type: 'check-in', partyId: 'afternoon-study' });
  state = draftReducer(state, { type: 'viewer', id: 'you' });
  state = draftReducer(state, {
    type: 'cancel-party',
    partyId: 'afternoon-study',
  });
  const members = state.parties[0].members;
  assert.equal(members.find((m) => m.person.id === 'luca').checkedIn, true);
  assert.equal(members.find((m) => m.person.id === 'luca').cancelled, false);
  assert.equal(members.find((m) => m.person.id === 'you').cancelled, true);
  assert.equal(state.parties[1], other);
});

test('a stale party link cannot mutate an existing party', () => {
  const state = initialDraftState();
  const updated = draftReducer(state, {
    type: 'cancel-party',
    partyId: 'missing',
  });
  assert.deepEqual(updated.parties, state.parties);
});

test('people search includes non-friends and distinguishes pending requests', async () => {
  const { samplePeople } =
    await import('../src/features/social-draft/directory.ts');
  let state = initialDraftState();
  assert.deepEqual(samplePeople(state, 's'), []);
  const sam = samplePeople(state, '  SAM ')[0];
  assert.equal(sam.name, 'Sam Keller');
  assert.equal(sam.relationship, 'none');
  assert.equal(samplePeople(state, 'Anna')[0].relationship, 'friends');
  assert.equal(samplePeople(state, 'Nora')[0].relationship, 'incoming');
  state = draftReducer(state, {
    type: 'send-request',
    person: { id: sam.id, name: sam.name, room: null },
  });
  assert.equal(samplePeople(state, 'Sam')[0].relationship, 'outgoing');
  state = draftReducer(state, { type: 'remove-friend', id: 'anna' });
  assert.equal(samplePeople(state, 'Anna')[0].relationship, 'none');
});

test('active-party limits ignore invitations and release a slot when its reservation ends or expires', () => {
  let state = initialDraftState();
  const now = 1000;
  assert.equal(
    activeDraftParty(state.parties, 'you', now).id,
    'afternoon-study',
  );
  assert.equal(
    draftReducer(state, {
      type: 'create-party',
      id: 'new',
      name: 'Extra',
      now,
    }),
    state,
  );
  assert.equal(
    draftReducer(state, {
      type: 'reply',
      partyId: 'anna-study',
      accept: true,
      now,
    }),
    state,
  );
  state = draftReducer(state, {
    type: 'book',
    assignments: { you: 1, theo: 4, luca: 2, mia: 3 },
    now,
  });
  assert(
    isDraftPartyActive(state.parties[0], 'you', now + holdSeconds * 1000 - 1),
  );
  assert(
    !isDraftPartyActive(state.parties[0], 'you', now + holdSeconds * 1000),
  );
  assert.equal(
    draftReducer(state, {
      type: 'create-party',
      id: 'expired',
      name: 'Next',
      now: now + holdSeconds * 1000,
    }).parties[0].id,
    'expired',
  );
  state = draftReducer(state, { type: 'check-in' });
  assert(isDraftPartyActive(state.parties[0], 'you', now + holdSeconds * 1000));
  assert(
    !isDraftPartyActive(state.parties[0], 'you', now + sessionSeconds * 1000),
  );
  state = draftReducer(state, { type: 'cancel-seat' });
  assert(!activeDraftParty(state.parties, 'you', now));
  assert.equal(
    draftReducer(state, {
      type: 'reply',
      partyId: 'anna-study',
      accept: true,
      now,
    }).parties[1].members.find((m) => m.person.id === 'you').status,
    'accepted',
  );
});

test('friend list puts shared rooms first, filters names and leaves its source order intact', async () => {
  const { friendsWithLocationsFirst } =
    await import('../src/features/social-draft/friends.ts');
  const friends = [
    { id: 'a', name: 'Alice', room: null },
    { id: 'z', name: 'Zoe', room: 'HG E 41' },
    { id: 'b', name: 'Bob', room: 'CAB E 11' },
  ];
  assert.deepEqual(
    friendsWithLocationsFirst(friends).map((p) => p.id),
    ['b', 'z', 'a'],
  );
  assert.deepEqual(
    friendsWithLocationsFirst(friends, '  AL ').map((p) => p.id),
    ['a'],
  );
  assert.deepEqual(
    friends.map((p) => p.id),
    ['a', 'z', 'b'],
  );
});

test('previous open demo rosters upgrade once to separate the joined party and invitation', () => {
  const old = initialDraftState();
  old.demoSeedVersion = 1;
  old.friends = old.friends.filter((p) => p.id !== 'theo');
  old.parties[0].members.find((m) => m.person.id === 'theo').person =
    old.friends[0];
  old.parties[1].members.find((m) => m.person.id === 'nora').person =
    old.friends.find((p) => p.id === 'luca');
  old.parties[1].members.find((m) => m.person.id === 'felix').person =
    old.friends.find((p) => p.id === 'mia');
  const upgraded = restoreDraftState(JSON.stringify(old));
  assert.equal(upgraded.demoSeedVersion, 2);
  assert(upgraded.friends.some((p) => p.id === 'theo'));
  for (const id of ['you', 'anna', 'luca', 'mia', 'theo']) {
    assert.equal(
      upgraded.parties.filter((p) => isDraftPartyActive(p, id, 1000)).length,
      1,
    );
  }
  assert.deepEqual(
    restoreDraftState(JSON.stringify(upgraded)).parties,
    upgraded.parties,
  );
});
