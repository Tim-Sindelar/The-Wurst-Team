import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeDraftParties,
  draftReducer,
  initialDraftState,
  partyPath,
  restoreDraftState,
  loadDraftState,
  saveDraftState,
} from '../src/features/social-draft/draft.ts';

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
    const custom = draftReducer(initialDraftState(), {
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
  const joined = draftReducer(state, { type: 'reply', partyId, accept: true });
  assert.equal(
    joined.parties[1].members.find((m) => m.person.id === 'you').status,
    'accepted',
  );
  assert.equal(joined.parties[1].organizerId, 'anna');
  assert.equal(draftReducer(joined, { type: 'cancel-party', partyId }), joined);
});

test('older saved demo gets both samples once without losing custom parties or sessions', () => {
  let old = draftReducer(initialDraftState(), {
    type: 'create-party',
    id: 'custom',
    name: 'My custom party',
  });
  old = draftReducer(old, {
    type: 'book',
    partyId: 'afternoon-study',
    assignments: { you: 1, anna: 4, luca: 2, mia: 3 },
    now: 1000,
  });
  old = draftReducer(old, { type: 'check-in', partyId: 'afternoon-study' });
  old = draftReducer(old, { type: 'cancel-party', partyId: 'afternoon-study' });
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
  assert(
    upgraded.parties.some(
      (p) =>
        p.id === 'afternoon-study-demo' &&
        p.members.every((m) => m.status === 'accepted'),
    ),
  );
  assert.equal(
    upgraded.parties
      .find((p) => p.id === 'afternoon-study')
      .members.find((m) => m.person.id === 'you').checkedIn,
    true,
  );
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
    assignments: { you: 1, anna: 4, luca: 2, mia: 3 },
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
  let state = initialDraftState();
  const sample = state.parties[0];
  state = draftReducer(state, {
    type: 'create-party',
    id: 'first',
    name: ' Thursday crew ',
  });
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

test('an invite targets the party in its URL and still requires acceptance', () => {
  let state = draftReducer(initialDraftState(), {
    type: 'create-party',
    id: 'new',
    name: 'New party',
  });
  state = draftReducer(state, { type: 'accept-request', id: 'nora' });
  state = draftReducer(state, {
    type: 'invite-members',
    partyId: 'afternoon-study',
    invited: ['nora'],
  });
  state = draftReducer(state, {
    type: 'invite-members',
    partyId: 'afternoon-study',
    invited: ['nora'],
  });
  const sample = state.parties.find((p) => p.id === 'afternoon-study');
  assert.equal(sample.members.filter((m) => m.person.id === 'nora').length, 1);
  assert.equal(
    sample.members.find((m) => m.person.id === 'nora').status,
    'invited',
  );
  assert.equal(state.parties[0].members.length, 1);
  state = draftReducer(state, { type: 'viewer', id: 'nora' });
  state = draftReducer(state, {
    type: 'reply',
    partyId: 'afternoon-study',
    accept: true,
  });
  assert.equal(
    state.parties[1].members.find((m) => m.person.id === 'nora').status,
    'accepted',
  );
});

test('reload retains parties, requests and privacy, and leaves preview perspective at organizer', () => {
  let state = draftReducer(initialDraftState(), {
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

test('booking, individual check-in and cancellation do not affect another party', () => {
  let state = draftReducer(initialDraftState(), {
    type: 'create-party',
    id: 'other',
    name: 'Other party',
  });
  const other = state.parties[0];
  state = draftReducer(state, {
    type: 'book',
    partyId: 'afternoon-study',
    assignments: { you: 1, anna: 4, luca: 2, mia: 3 },
    now: 1000,
  });
  state = draftReducer(state, { type: 'viewer', id: 'luca' });
  state = draftReducer(state, { type: 'check-in', partyId: 'afternoon-study' });
  state = draftReducer(state, { type: 'viewer', id: 'you' });
  state = draftReducer(state, {
    type: 'cancel-party',
    partyId: 'afternoon-study',
  });
  const members = state.parties[1].members;
  assert.equal(members.find((m) => m.person.id === 'luca').checkedIn, true);
  assert.equal(members.find((m) => m.person.id === 'luca').cancelled, false);
  assert.equal(members.find((m) => m.person.id === 'you').cancelled, true);
  assert.equal(state.parties[0], other);
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
