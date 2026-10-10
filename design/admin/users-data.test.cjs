const { test } = require("node:test");
const assert = require("node:assert/strict");
const api = require("./users-data.js");
const storage = () => {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) || null,
    setItem: (key, value) => map.set(key, value),
  };
};
test("sample metrics come from reservation records", () => {
  const state = api.seed();
  assert.equal(state.users.length, 6);
  assert.equal(
    state.users.reduce(
      (n, u) => n + u.records.reduce((sum, r) => sum + r.studyMinutes, 0),
      0,
    ),
    194 * 60,
  );
  assert.equal(
    state.users.flatMap((u) => u.records).filter(api.live).length,
    5,
  );
  assert.ok(
    state.users
      .flatMap((u) => u.records)
      .filter((r) => !r.checkedIn)
      .every((r) => r.studyMinutes === 0),
  );
});
test("profile edits persist across page loads and keep reservation history", () => {
  const state = api.seed(),
    store = storage();
  const updated = api.updateProfile(state, "lena", {
    name: "  Lena Updated  ",
    email: "lena@example.com",
    department: "D-INFK",
  });
  assert.equal(updated.users[0].name, "Lena Updated");
  assert.deepEqual(updated.users[0].records, state.users[0].records);
  assert.equal(api.save(store, updated), true);
  assert.equal(api.load(store).users[0].name, "Lena Updated");
  assert.equal(state.users[0].name, "Lena Fischer");
});
test("invalid profiles cannot overwrite sample data", () => {
  const state = api.seed();
  for (const patch of [
    { name: " ", email: "a@example.com", department: "D-INFK" },
    { name: "Lena", email: "invalid", department: "D-INFK" },
    { name: "Lena", email: "a@example.com", department: " " },
  ])
    assert.throws(() => api.updateProfile(state, "lena", patch));
});
test("ending every live status is idempotent and preserves study time", () => {
  for (const id of ["lena", "tim", "maya"]) {
    const state = api.seed(),
      user = state.users.find((u) => u.id === id),
      record = user.records.find(api.live);
    const updated = api.endReservation(state, id, record.id);
    const ended = updated.users
      .find((u) => u.id === id)
      .records.find((r) => r.id === record.id);
    assert.equal(ended.status, "ended");
    assert.equal(ended.endedBy, "admin");
    assert.equal(ended.studyMinutes, record.studyMinutes);
    assert.equal(
      updated.users.find((u) => u.id === id).records.some(api.live),
      false,
    );
    assert.deepEqual(api.endReservation(updated, id, record.id), updated);
  }
});
test("corrupt and blocked browser storage fall back safely", () => {
  const store = storage();
  store.setItem(api.KEY, "broken");
  assert.equal(api.load(store).users.length, 6);
  store.setItem(
    api.KEY,
    JSON.stringify({ version: 1, users: [{ id: "bad" }] }),
  );
  assert.equal(api.load(store).users.length, 6);
  const blocked = {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("blocked");
    },
  };
  assert.equal(api.load(blocked).users.length, 6);
  assert.equal(api.save(blocked, api.seed()), false);
});
