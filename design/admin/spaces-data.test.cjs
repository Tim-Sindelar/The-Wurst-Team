const { test } = require("node:test"),
  assert = require("node:assert/strict");
const api = require("./spaces-data.js"),
  geometry = require("./layout-data.js");
const input = {
  name: "  HG E 3   Auditorium  ",
  roomId: "hg-e-3",
  timeZone: "Europe/Zurich",
};
test("create binds a backend-style room identity and no GPS fields", () => {
  const old = api.seed(),
    state = api.create(old, input, "new-room");
  assert.equal(old.spaces.length, 2);
  assert.equal(state.spaces.at(-1).name, "HG E 3 Auditorium");
  assert.equal(state.spaces.at(-1).roomId, "hg-e-3");
  assert.equal(state.spaces.at(-1).seats, 0);
  assert.equal("latitude" in state.spaces.at(-1), false);
});
test("selection, duplicate room and name validation", () => {
  for (const patch of [
    { name: " " },
    { roomId: "" },
    { roomId: "invalid" },
    { roomId: "hg-e-11" },
    { timeZone: "invalid" },
    { name: "hauptbibliothek · lesesaal" },
  ])
    assert.throws(() =>
      api.create(api.seed(), { ...input, ...patch }, "new-room"),
    );
});
test("saved layouts update seat counts and preserve other spaces", () => {
  const state = api.create(api.seed(), input, "new-room"),
    room = geometry.room(input.roomId);
  let items = geometry.place(room, [], "table", 320, 300, "table");
  items = geometry.place(room, items, "seat", 280, 260, "seat");
  const next = api.saveLayout(state, "new-room", items);
  assert.equal(next.spaces.at(-1).seats, 1);
  assert.equal(next.spaces.at(-1).free, 1);
  assert.deepEqual(next.spaces[0], state.spaces[0]);
  let raw;
  const store = { getItem: () => raw, setItem: (k, v) => (raw = v) };
  assert.equal(api.save(store, next), true);
  assert.deepEqual(api.load(store), next);
});
test("old GPS sample storage migrates without losing spaces", () => {
  const old = {
    version: 1,
    spaces: [{ ...api.seed().spaces[0], latitude: 47, longitude: 8 }],
  };
  delete old.spaces[0].roomId;
  const next = api.load({ getItem: () => JSON.stringify(old) });
  assert.equal(next.spaces.length, 1);
  assert.equal(next.version, 2);
  assert.equal("latitude" in next.spaces[0], false);
  assert.equal(next.spaces[0].roomId, null);
});
test("furniture stays inside irregular room boundaries", () => {
  const room = geometry.rooms[0];
  assert.throws(() => geometry.place(room, [], "table", 600, 600, "bad"));
  let items = geometry.place(room, [], "table", 320, 300, "table");
  items = geometry.place(room, items, "seat", 320, 256, "seat");
  assert.deepEqual(geometry.move(room, items, "seat", 600, 600), items);
  assert.throws(() => geometry.update(room, items, "seat", { x: 0, y: 0 }));
});
test("windows and doors snap to walls and seat numbers stay unique", () => {
  const room = geometry.rooms[0];
  let items = geometry.place(room, [], "window", 300, 70, "window");
  assert.equal(items[0].y, 28);
  items = geometry.place(room, items, "door", 300, 700, "door");
  assert.equal(items[1].y, 732);
  items = geometry.place(room, items, "table", 320, 340, "table");
  items = geometry.place(room, items, "seat", 280, 300, "s1");
  items = geometry.place(room, items, "seat", 340, 300, "s2");
  assert.deepEqual(
    items.filter((o) => o.type === "seat").map((o) => o.number),
    [1, 2],
  );
  assert.throws(() => geometry.update(room, items, "s2", { number: 1 }));
});
test("corrupt and blocked storage fall back safely", () => {
  const bad = {
    getItem() {
      throw Error();
    },
    setItem() {
      throw Error();
    },
  };
  assert.equal(api.load(bad).spaces.length, 2);
  assert.equal(api.save(bad, api.seed()), false);
});

test("seats require tables, keep a fixed gap, and never share positions", () => {
  const r = geometry.rooms[0];
  assert.throws(() => geometry.place(r, [], "seat", 320, 300, "s"));
  let items = geometry.place(r, [], "table", 320, 300, "t");
  for (let i = 0; i < 8; i++)
    items = geometry.place(r, items, "seat", 320, 300, "s" + i);
  assert.equal(
    new Set(items.filter((o) => o.type === "seat").map((o) => o.slot)).size,
    8,
  );
  assert.throws(() => geometry.place(r, items, "seat", 320, 300, "extra"));
  geometry.assertLayout(r, items);
  const top = items.find((o) => o.slot === "top:0");
  assert.equal(300 - 18 - (top.y + 18), geometry.SEAT_GAP);
});
test("table groups move and rotate atomically; collisions are blocked", () => {
  const r = geometry.rooms[0];
  let items = geometry.place(r, [], "table", 240, 300, "t");
  items = geometry.place(r, items, "seat", 216, 256, "s");
  items = geometry.place(r, items, "table", 440, 300, "other");
  const moved = geometry.update(r, items, "t", { x: 260, y: 320, angle: 90 });
  const expected = geometry
    .slots(moved[0])
    .find((o) => o.slot === items[1].slot);
  assert.equal(moved[1].x, expected.x);
  assert.equal(moved[1].angle, expected.angle);
  assert.throws(() => geometry.update(r, items, "t", { x: 440, y: 300 }));
  assert.deepEqual(geometry.move(r, items, "t", 440, 300), items);
  items = geometry.place(r, items, "seat", 264, 256, "s2");
  const shrunk = geometry.update(r, items, "t", { width: 32 });
  assert.equal(
    shrunk.filter((o) => o.type === "seat" && o.tableId === "t").length,
    1,
  );
  geometry.assertLayout(r, shrunk);
  assert.equal(geometry.remove(items, "t").length, 1);
});
test("rotated collisions and invalid saved seat attachments are rejected", () => {
  const r = geometry.rooms[0];
  const t = {
    id: "t",
    type: "table",
    x: 320,
    y: 300,
    width: 128,
    height: 36,
    angle: 45,
  };
  assert.equal(
    geometry.overlaps(t, { ...t, id: "b", x: 350, angle: 135 }),
    true,
  );
  assert.equal(geometry.overlaps(t, { ...t, id: "b", x: 500 }), false);
  const items = geometry.place(r, [], "table", 320, 300, "t");
  const seated = geometry.place(r, items, "seat", 300, 256, "s");
  const invalid = seated.map((o) =>
    o.type === "seat" ? { ...o, x: o.x + 4 } : o,
  );
  assert.throws(() => api.saveLayout(api.seed(), "hauptbibliothek", invalid));
  assert.throws(() => geometry.place(r, seated, "table", 300, 256, "overlap"));
});
test("legacy seats normalize without losing identities or states", () => {
  const r = geometry.rooms[0];
  const table = {
    id: "t",
    type: "table",
    x: 320,
    y: 300,
    width: 128,
    height: 36,
    angle: 0,
  };
  const legacy = {
    id: "s",
    type: "seat",
    x: 280,
    y: 260,
    width: 32,
    height: 36,
    angle: 0,
    number: 7,
    state: "occupied",
    active: true,
  };
  const next = geometry.normalize(r, [table, legacy]);
  geometry.assertLayout(r, next);
  assert.equal(next[1].number, 1);
  assert.equal(next[1].state, "occupied");
  const orphan = { ...legacy, x: 600, y: 650 };
  const kept = geometry.normalize(r, [table, orphan]);
  assert.equal(kept.length, 2);
  assert.throws(() => geometry.assertLayout(r, kept));
});

test("tables get unused alphabetical names, including beyond Z", () => {
  assert.equal(geometry.tableName([]), "A");
  const names = Array.from({ length: 26 }, (_, i) => ({
    type: "table",
    label: String.fromCharCode(65 + i),
  }));
  assert.equal(geometry.tableName(names), "AA");
  let items = geometry.place(geometry.rooms[0], [], "table", 200, 200, "a");
  items = geometry.place(geometry.rooms[0], items, "table", 400, 200, "b");
  assert.deepEqual(
    items.map((o) => o.label),
    ["A", "B"],
  );
  assert.equal(
    geometry.normalize(geometry.rooms[0], [
      { ...items[0], label: "" },
      items[1],
    ])[0].label,
    "A",
  );
});
test("corner resizing holds the opposite corner and keeps attached seats", () => {
  const r = geometry.rooms[0];
  let items = geometry.place(r, [], "table", 240, 300, "t");
  items = geometry.place(r, items, "seat", 192, 256, "s");
  const anchor = geometry.handlePoint(items[0], "nw");
  const next = geometry.resize(r, items, "t", "se", 340, 340);
  assert.equal(next[0].width, 176);
  assert.equal(next[0].height, 80);
  assert.deepEqual(geometry.handlePoint(next[0], "nw"), anchor);
  geometry.assertLayout(r, next);
  const rotated = geometry.update(r, items, "t", { angle: 90 });
  const corner = geometry.handlePoint(rotated[0], "se");
  const changed = geometry.resize(
    r,
    rotated,
    "t",
    "se",
    corner.x - 20,
    corner.y + 30,
  );
  assert.ok(Math.abs(changed[0].width - 176) < 0.001);
  assert.ok(Math.abs(changed[0].height - 32) < 0.001);
  const crowded = geometry.place(r, items, "table", 440, 420, "other");
  assert.throws(() => geometry.resize(r, crowded, "t", "se", 700, 700));
  assert.throws(() => geometry.resize(r, items, "s", "se", 300, 300));
});
test("door and window resize handles preserve their opposite endpoint on the wall", () => {
  const r = geometry.rooms[0];
  for (const type of ["door", "window"]) {
    const items = geometry.place(r, [], type, 300, 28, type);
    const anchor = geometry.handlePoint(items[0], "w");
    const next = geometry.resize(r, items, type, "e", 400, 28);
    assert.equal(next[0].width, 140);
    assert.ok(
      Math.hypot(
        geometry.handlePoint(next[0], "w").x - anchor.x,
        geometry.handlePoint(next[0], "w").y - anchor.y,
      ) < 0.001,
    );
    assert.equal(next[0].y, 28);
    geometry.assertLayout(r, next);
  }
});

test("table presets fit exact seat counts per edge and drag snaps within each step", () => {
  const r = geometry.rooms[0];
  geometry.TABLE_SIZES.forEach((width, count) => {
    const table = {
      id: "t",
      type: "table",
      label: "A",
      x: 300,
      y: 300,
      width,
      height: 24,
      angle: 0,
    };
    assert.equal(
      geometry.slots(table).filter((s) => s.slot.startsWith("top:")).length,
      count,
    );
  });
  const items = geometry.place(r, [], "table", 240, 300, "t"),
    corner = geometry.handlePoint(items[0], "se");
  const small = geometry.resize(
    r,
    items,
    "t",
    "se",
    corner.x + 3,
    corner.y + 2,
  );
  const same = geometry.resize(
    r,
    items,
    "t",
    "se",
    corner.x + 10,
    corner.y + 2,
  );
  assert.equal(small[0].width, 128);
  assert.equal(same[0].width, 128);
  const larger = geometry.resize(
    r,
    items,
    "t",
    "se",
    corner.x + 30,
    corner.y + 2,
  );
  assert.equal(larger[0].width, 176);
  const key = geometry.resizeBy(r, items, "t", "se", 1, 0);
  assert.equal(key[0].width, 176);
});

test("resizing extends occupied edges at ends and preserves gaps and empty sides", () => {
  const r = geometry.rooms[0];
  let items = geometry.place(r, [], "table", 220, 300, "a");
  items = geometry.place(r, items, "seat", 172, 256, "s1");
  items = geometry.place(r, items, "seat", 268, 256, "s2");
  const larger = geometry.update(r, items, "a", { width: 176 });
  const seats = larger.filter((o) => o.type === "seat");
  assert.deepEqual(seats.map((o) => o.slot).sort(), [
    "top:0",
    "top:2",
    "top:3",
  ]);
  assert.equal(
    seats.some((o) => o.slot === "top:1"),
    false,
  );
  const smaller = geometry.update(r, larger, "a", { width: 80 });
  assert.ok(
    smaller
      .filter((o) => o.type === "seat")
      .every((o) => o.slot.startsWith("top:")),
  );
  assert.deepEqual(
    smaller.filter((o) => o.type === "seat").map((o) => o.number),
    [1],
  );
  const empty = geometry.update(r, [items[0]], "a", { width: 176 });
  assert.equal(empty.filter((o) => o.type === "seat").length, 0);
});

test("deletion renumbers remaining seats and preserves data", () => {
  const r = geometry.rooms[0];
  let items = geometry.place(r, [], "table", 220, 300, "a");
  for (let i = 0; i < 3; i++)
    items = geometry.place(r, items, "seat", 172 + i * 48, 256, "s" + i);
  const next = geometry.remove(items, "s1");
  assert.deepEqual(
    next.filter((o) => o.type === "seat").map((o) => o.number),
    [1, 2],
  );
  assert.equal(
    next.some((o) => o.id === "s2"),
    true,
  );
  const grown = geometry.update(r, next, "a", { width: 176 });
  assert.equal(
    grown.some((o) => o.slot === "top:1"),
    false,
  );
  geometry.assertLayout(r, grown);
  const saved = api.saveLayout(api.seed(), "hauptbibliothek", grown);
  assert.equal(saved.spaces[0].seats, 3);
});
test("round and L tables are editable and have valid seat positions", () => {
  const r = geometry.rooms[0];
  for (const type of ["round", "l"]) {
    let items = geometry.place(r, [], type, 320, 300, type);
    assert.equal(items[0].shape, type);
    for (const slot of geometry.slots(items[0])) {
      try {
        items = geometry.place(
          r,
          items,
          "seat",
          slot.x,
          slot.y,
          type + "-" + slot.slot,
        );
      } catch {}
    }
    assert.ok(items.length > 2);
    geometry.assertLayout(r, items);
    const changed = geometry.update(r, items, type, {
      width: 176,
      height: 176,
      angle: 90,
    });
    geometry.assertLayout(r, changed);
  }
});
test("auditorium rows support arcs, straight lines, moving and saved layouts", () => {
  const r = geometry.rooms[1];
  const items = geometry.place(r, [], "row", 320, 300, "rows");
  assert.equal(items.filter((o) => o.type === "seat").length, 13);
  geometry.assertLayout(r, items);
  const straight = geometry.update(r, items, "rows", {
    sweep: 0,
    count: 5,
    rows: 3,
  });
  assert.equal(straight.filter((o) => o.type === "seat").length, 15);
  const first = straight.filter((o) => o.slot?.startsWith("row0:"));
  assert.ok(first.every((o) => o.y === 300));
  const moved = geometry.move(r, straight, "rows", 320, 340);
  geometry.assertLayout(r, moved);
  assert.equal(moved.find((o) => o.slot === "row0:0").y, 340);
  const saved = api.saveLayout(api.seed(), "hauptbibliothek", straight);
  assert.equal(saved.spaces[0].seats, 15);
  const reload = geometry.normalize(r, straight);
  geometry.assertLayout(r, reload);
  assert.equal(reload.filter((o) => o.type === "seat").length, 15);
  assert.deepEqual(reload, straight);
  assert.throws(() => geometry.update(r, items, "rows", { count: 99 }));
});

test("half-circle rows remain spaced and deleted gaps survive edits", () => {
  const r = geometry.rooms[1];
  let items = geometry.place(r, [], "row", 320, 300, "arc");
  items = geometry.update(r, items, "arc", { sweep: 180, radius: 120 });
  geometry.assertLayout(r, items);
  const seat = items.find((o) => o.slot === "row0:2");
  const removed = geometry.remove(items, seat.id);
  const edited = geometry.update(r, removed, "arc", { radius: 130, count: 7 });
  assert.equal(
    edited.some((o) => o.slot === "row0:2"),
    false,
  );
  geometry.assertLayout(r, edited);
});

test("rectangle and square seats number clockwise through gaps and rotation", () => {
  for (const [width, height] of [
    [128, 128],
    [176, 80],
  ]) {
    for (const angle of [0, 90, 180, 270]) {
      const table = {
        id: "clockwise",
        type: "table",
        x: 320,
        y: 380,
        width,
        height,
        angle,
        label: "A",
      };
      const seats = geometry.slots(table).map((slot, i) => ({
        ...slot,
        id: "cw-" + i,
        type: "seat",
        width: 32,
        height: 36,
        number: 100 + i,
        state: "free",
      }));
      const ordered = geometry
        .renumber([table, ...seats])
        .filter((o) => o.type === "seat")
        .sort((a, b) => a.number - b.number);
      const expected = ["top", "right", "bottom", "left"].flatMap((side) => {
        const edge = seats.filter((s) => s.slot.startsWith(side + ":"));
        return (["bottom", "left"].includes(side) ? edge.reverse() : edge).map(
          (s) => s.slot,
        );
      });
      assert.deepEqual(
        ordered.map((s) => s.slot),
        expected,
      );
      const removed = geometry
        .remove([table, ...ordered], ordered[2].id)
        .filter((o) => o.type === "seat")
        .sort((a, b) => a.number - b.number);
      assert.deepEqual(
        removed.map((s) => s.slot),
        expected.filter((_, i) => i !== 2),
      );
      assert.deepEqual(
        removed.map((s) => s.number),
        removed.map((_, i) => i + 1),
      );
    }
  }
});

test("curved rows fit more outer seats while straight rows stay equal", () => {
  const room = geometry.rooms[1];
  let items = geometry.place(room, [], "row", 320, 380, "curved");
  items = geometry.update(room, items, "curved", {
    sweep: 180,
    radius: 90,
    rows: 3,
    count: 6,
  });
  const counts = (layout) =>
    [0, 1, 2].map(
      (row) =>
        layout.filter(
          (s) => s.type === "seat" && s.slot.startsWith("row" + row + ":"),
        ).length,
    );
  assert.deepEqual(counts(items), [6, 9, 13]);
  geometry.assertLayout(room, items);
  const straight = geometry.update(room, items, "curved", { sweep: 0 });
  assert.deepEqual(counts(straight), [6, 6, 6]);
  const curvedAgain = geometry.update(room, straight, "curved", { sweep: 180 });
  assert.deepEqual(counts(curvedAgain), [6, 9, 13]);
  const deleted = geometry.remove(
    curvedAgain,
    curvedAgain.find((s) => s.slot === "row1:3").id,
  );
  const grown = geometry.update(room, deleted, "curved", { count: 5 });
  const newSlots = geometry.slots(grown[0]);
  const shift = Math.floor(
    (newSlots.filter((s) => s.slot.startsWith("row1:")).length - 9) / 2,
  );
  assert.equal(
    grown.some((s) => s.type === "seat" && s.slot === "row1:" + (3 + shift)),
    false,
  );
  geometry.assertLayout(room, grown);
  assert.deepEqual(geometry.normalize(room, grown), grown);
});

test("old equal-count arcs migrate once without filling deleted gaps", () => {
  const room = geometry.rooms[1];
  const row = {
    id: "legacy-row",
    type: "row",
    label: "Row 1",
    x: 320,
    y: 380,
    angle: 0,
    width: 272,
    height: 100,
    count: 6,
    rows: 3,
    sweep: 180,
    radius: 90,
  };
  const radius = Math.max(90, 56 / (2 * Math.sin(Math.PI / 5 / 2)));
  const seats = [];
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 6; i++) {
      if (j === 1 && i === 2) continue;
      const a = (i / 5 - 0.5) * Math.PI,
        r = radius + j * 64;
      seats.push({
        id: "old-" + j + "-" + i,
        type: "seat",
        tableId: row.id,
        slot: "row" + j + ":" + i,
        x: 320 + r * Math.sin(a),
        y: 380 + r * Math.cos(a) - radius,
        angle: ((-a * 180) / Math.PI + 360) % 360,
        width: 32,
        height: 36,
        number: seats.length + 1,
        state: "free",
      });
    }
  const migrated = geometry.normalize(room, [row, ...seats]);
  assert.equal(migrated[0].seatSpacingVersion, 2);
  assert.equal(migrated.filter((s) => s.type === "seat").length, 27);
  assert.equal(
    migrated.some((s) => s.slot === "row1:3"),
    false,
  );
  for (const seat of seats) assert.ok(migrated.some((s) => s.id === seat.id));
  geometry.assertLayout(room, migrated);
  assert.deepEqual(geometry.normalize(room, migrated), migrated);
});

test("arbitrary seat insertion and cross-table moves always renumber the whole room", () => {
  const room = geometry.rooms[1];
  let items = geometry.place(room, [], "table", 180, 400, "first");
  items = geometry.update(room, items, "first", { height: 128 });
  items = geometry.place(room, items, "table", 460, 400, "second");
  items = geometry.update(room, items, "second", { height: 128 });
  const expectedOrder = (layout) =>
    layout
      .filter((o) => o.type === "table")
      .flatMap((table) =>
        ["top", "right", "bottom", "left"].flatMap((side) => {
          const edge = layout.filter(
            (s) =>
              s.type === "seat" &&
              s.tableId === table.id &&
              s.slot.startsWith(side + ":"),
          );
          return edge.sort(
            (a, b) =>
              (Number(a.slot.split(":")[1]) - Number(b.slot.split(":")[1])) *
              (["bottom", "left"].includes(side) ? -1 : 1),
          );
        }),
      );
  const check = (layout) => {
    const ordered = expectedOrder(layout);
    assert.deepEqual(
      ordered.map((s) => s.number),
      ordered.map((_, i) => i + 1),
    );
    assert.equal(new Set(ordered.map((s) => s.id)).size, ordered.length);
    geometry.assertLayout(room, layout);
  };
  const additions = [
    ["second", "left:1"],
    ["first", "bottom:0"],
    ["second", "top:2"],
    ["first", "left:0"],
    ["first", "top:1"],
    ["second", "right:1"],
    ["first", "top:0"],
    ["first", "right:2"],
    ["second", "bottom:1"],
  ];
  additions.forEach(([parent, slot], i) => {
    const target = geometry
      .slots(items.find((o) => o.id === parent))
      .find((s) => s.slot === slot);
    items = geometry.place(
      room,
      items,
      "seat",
      target.x + 3,
      target.y - 2,
      "insert-" + i,
    );
    const seat = items.find((s) => s.id === "insert-" + i);
    assert.equal(seat.tableId, parent);
    assert.equal(seat.slot, slot);
    check(items);
  });
  const destination = geometry
    .slots(items.find((o) => o.id === "second"))
    .find((s) => s.slot === "top:0");
  items = geometry.move(room, items, "insert-1", destination.x, destination.y);
  assert.equal(items.find((s) => s.id === "insert-1").tableId, "second");
  check(items);
  items = geometry.remove(items, "insert-4");
  check(items);
  const badNumbers = items.map((o) =>
    o.type === "seat" ? { ...o, number: 42 } : o,
  );
  const saved = api
    .saveLayout(
      api.create(
        api.seed(),
        { name: "Numbering test", roomId: room.id, timeZone: "Europe/Zurich" },
        "numbering-test",
      ),
      "numbering-test",
      badNumbers,
    )
    .spaces.at(-1).layout;
  check(saved);
  assert.deepEqual(
    badNumbers.filter((o) => o.type === "seat").map((o) => o.number),
    Array(8).fill(42),
  );
});

test("room boundaries use real units without distorting shape or furniture", () => {
  const input = {
    id: "metric",
    label: "Metric room",
    kind: "Study room",
    building: "Test",
    coordinateUnit: "m",
    boundary: [
      [100, 200],
      [110, 200],
      [110, 206],
      [106, 206],
      [106, 208],
      [100, 208],
    ],
  };
  const room = geometry.roomFromCoordinates(input);
  assert.equal(room.measurements.widthMeters, 10);
  assert.equal(room.measurements.heightMeters, 8);
  assert.equal(room.measurements.areaSquareMeters, 72);
  assert.equal(room.width, 10 * 64 + 56);
  assert.equal(room.height, 8 * 64 + 56);
  assert.deepEqual(room.points[0], [28, 28]);
  assert.deepEqual(room.points[2], [668, 412]);
  assert.deepEqual(geometry.sourcePoint(room, ...room.points[2]), {
    x: 110,
    y: 206,
  });
  for (const [coordinateUnit, factor] of [
    ["cm", 100],
    ["mm", 1000],
  ]) {
    const converted = geometry.roomFromCoordinates({
      ...input,
      coordinateUnit,
      boundary: input.boundary.map((p) => p.map((v) => v * factor)),
    });
    assert.deepEqual(converted.points, room.points);
    assert.deepEqual(converted.measurements, room.measurements);
  }
  const cartesian = geometry.roomFromCoordinates({
    ...input,
    coordinateAxis: "cartesian",
  });
  assert.deepEqual(cartesian.points[0], [28, 540]);
  assert.deepEqual(geometry.sourcePoint(cartesian, ...cartesian.points[0]), {
    x: 100,
    y: 200,
  });
  const plan = geometry.roomFromCoordinates({
    ...input,
    coordinateUnit: "plan",
    metersPerUnit: 0.5,
    boundary: input.boundary.map((p) => p.map((v) => v * 2)),
  });
  assert.deepEqual(plan.points, room.points);
  assert.throws(
    () => geometry.roomFromCoordinates({ ...input, coordinateUnit: "degrees" }),
    /physical unit/,
  );
  assert.throws(
    () =>
      geometry.roomFromCoordinates({
        ...input,
        boundary: [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
      }),
    /enclose an area/,
  );
  assert.throws(() =>
    geometry.roomFromCoordinates({
      ...input,
      boundary: [
        [0, 0],
        [1, NaN],
        [2, 2],
      ],
    }),
  );
});

test("larger rooms retain chair and table size instead of stretching furniture", () => {
  const make = (size) =>
    geometry.roomFromCoordinates({
      id: "scaled",
      coordinateUnit: "m",
      boundary: [
        [0, 0],
        [size, 0],
        [size, size],
        [0, size],
      ],
    });
  const small = make(6),
    large = make(18);
  const furnish = (room) => {
    let items = geometry.place(
      room,
      [],
      "table",
      room.width / 2,
      room.height / 2,
      "table",
    );
    const slot = geometry.slots(items[0])[0];
    return geometry.place(room, items, "seat", slot.x, slot.y, "seat");
  };
  const first = furnish(small),
    second = furnish(large);
  assert.equal(first[0].width, second[0].width);
  assert.equal(first[0].width / geometry.UNITS_PER_METER, 2);
  assert.equal(first[1].width / geometry.UNITS_PER_METER, 0.5);
  assert.equal(
    first[1].width /
      (small.width - 56) /
      (second[1].width / (large.width - 56)),
    3,
  );
  geometry.assertLayout(small, first);
  geometry.assertLayout(large, second);
});

test("seat amenities toggle independently and survive resize and storage", () => {
  const room = geometry.rooms[0];
  let items = geometry.place(room, [], "table", 260, 280, "table");
  const slot = geometry.slots(items[0])[0];
  items = geometry.place(room, items, "seat", slot.x, slot.y, "seat");
  const original = geometry.clone(items);
  items = geometry.toggleBadge(items, "seat", "outlet");
  items = geometry.toggleBadge(items, "seat", "monitor");
  assert.deepEqual(items.find((o) => o.id === "seat").badges, [
    "outlet",
    "monitor",
  ]);
  assert.deepEqual(original.find((o) => o.id === "seat").badges, []);
  items = geometry.toggleBadge(items, "seat", "outlet");
  assert.deepEqual(items.find((o) => o.id === "seat").badges, ["monitor"]);
  assert.throws(
    () => geometry.toggleBadge(items, "missing", "outlet"),
    /Click a seat or table/,
  );
  assert.throws(
    () => geometry.toggleBadge(items, "seat", "coffee"),
    /supported/,
  );
  items = geometry.update(room, items, "table", { width: 176 });
  assert.deepEqual(items.find((o) => o.id === "seat").badges, ["monitor"]);
  assert.equal(items.find((o) => o.id === "seat").state, "free");
  const saved = api.saveLayout(api.seed(), api.seed().spaces[0].id, items);
  const memory = new Map();
  const storage = {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => memory.set(k, v),
  };
  assert.equal(api.save(storage, saved), true);
  assert.deepEqual(
    api.load(storage).spaces[0].layout.find((o) => o.id === "seat").badges,
    ["monitor"],
  );
});

test("table features apply to all attached seats and new seats inherit them", () => {
  const room = geometry.rooms[0];
  let items = geometry.place(room, [], "table", 260, 280, "table");
  const slots = geometry.slots(items[0]);
  items = geometry.place(room, items, "seat", slots[0].x, slots[0].y, "one");
  items = geometry.place(room, items, "seat", slots[1].x, slots[1].y, "two");
  items = geometry.toggleBadge(items, "one", "quiet");
  const before = geometry.clone(items);
  items = geometry.toggleBadge(items, "table", "outlet");
  assert.deepEqual(before.find((o) => o.id === "table").badges, undefined);
  for (const id of ["table", "one", "two"])
    assert.ok(items.find((o) => o.id === id).badges.includes("outlet"));
  assert.ok(items.find((o) => o.id === "one").badges.includes("quiet"));
  items = geometry.toggleBadge(items, "table", "monitor");
  items = geometry.update(room, items, "table", { width: 176 });
  for (const seat of items.filter((o) => o.type === "seat"))
    assert.ok(
      seat.badges.includes("outlet") && seat.badges.includes("monitor"),
    );
  const table = items.find((o) => o.id === "table");
  const free = geometry
    .slots(table)
    .find((s) => !items.some((o) => o.type === "seat" && o.slot === s.slot));
  items = geometry.place(room, items, "seat", free.x, free.y, "new");
  assert.deepEqual(items.find((o) => o.id === "new").badges, [
    "outlet",
    "monitor",
  ]);
  items = geometry.toggleBadge(items, "table", "outlet");
  for (const o of items)
    assert.equal((o.badges || []).includes("outlet"), false);
  assert.ok(items.find((o) => o.id === "one").badges.includes("quiet"));
  assert.ok(items.find((o) => o.id === "new").badges.includes("monitor"));
  geometry.assertLayout(room, items);
});

test("curved tables resize and adjust curvature with valid attached seats", () => {
  const room = geometry.roomFromCoordinates({
    id: "curve",
    coordinateUnit: "m",
    boundary: [
      [0, 0],
      [12, 0],
      [12, 12],
      [0, 12],
    ],
  });
  let items = geometry.place(room, [], "curved", 360, 360, "curve");
  let table = items[0];
  assert.equal(table.shape, "curved");
  assert.ok(geometry.curveOutline(table).length > 40);
  const slots = geometry.slots(table);
  assert.ok(slots.length >= 4);
  for (const [i, s] of slots.entries())
    items = geometry.place(room, items, "seat", s.x, s.y, "seat" + i);
  geometry.assertLayout(room, items);
  items = geometry.toggleBadge(items, "curve", "monitor");
  for (const curvature of [0, 30, 80, 100]) {
    items = geometry.update(room, items, "curve", { curvature });
    geometry.assertLayout(room, items);
    assert.equal(items.find((o) => o.id === "curve").curvature, curvature);
    assert.ok(
      items
        .filter((o) => o.type === "seat")
        .every((o) => o.badges.includes("monitor")),
    );
  }
  items = geometry.resizeBy(room, items, "curve", "se", 48, 0);
  geometry.assertLayout(room, items);
  assert.equal(items.find((o) => o.id === "curve").width, 224);
  assert.deepEqual(
    items
      .filter((o) => o.type === "seat")
      .map((o) => o.number)
      .sort((a, b) => a - b),
    items.filter((o) => o.type === "seat").map((_, i) => i + 1),
  );
  assert.throws(
    () => geometry.update(room, items, "curve", { curvature: 101 }),
    /curvature/,
  );
  assert.throws(
    () =>
      geometry.update(room, items, "curve", {
        width: 80,
        height: 224,
        curvature: 100,
      }),
    /too deep/,
  );
  const rotated = geometry.update(room, items, "curve", { angle: 90 });
  geometry.assertLayout(room, rotated);
  const outside = { ...table, x: 30, y: 30, curvature: 100 };
  assert.equal(geometry.valid(room, outside), false);
});

test("deleting a study place persists its full layout for undo and releases the room", () => {
  const state = api.create(api.seed(), input, "delete-room");
  const removed = api.remove(state, "delete-room");
  assert.equal(state.spaces.length, 3);
  assert.equal(removed.spaces.length, 2);
  assert.deepEqual(removed.deletedSpaces[0], state.spaces[2]);
  const storage = {
    value: null,
    setItem(k, v) {
      this.value = v;
    },
    getItem() {
      return this.value;
    },
  };
  assert.equal(api.save(storage, removed), true);
  const loaded = api.load(storage);
  const restored = api.restore(loaded, "delete-room");
  assert.deepEqual(restored.spaces[2], state.spaces[2]);
  assert.equal(restored.deletedSpaces.length, 0);
  assert.equal(api.create(loaded, input, "replacement").spaces.length, 3);
  assert.throws(
    () => api.restore(api.create(loaded, input, "replacement"), "delete-room"),
    /already uses/,
  );
  assert.throws(() => api.remove(removed, "delete-room"), /not found/);
});
