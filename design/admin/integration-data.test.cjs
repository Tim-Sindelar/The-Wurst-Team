const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  adapter = require("./integration-data.js"),
  geometry = require("./layout-data.js");
test("backend states map explicitly and unknown values cannot become free", () => {
  assert.equal(adapter.seatState("on_break"), "break");
  assert.equal(adapter.seatState("claimable"), "bookable");
  assert.throws(() => adapter.seatState("new_state"), /Unknown/);
});
test("geographic room scale uses coordinates in correct order and round trips", () => {
  const ref = {
    id: "ETH.HG.E.E_003",
    name: "HG E 3",
    levelId: "ETH.HG.E",
    facilityId: "ETH.HG",
    floor: 0,
  };
  const outline = {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [8.548, 47.376],
          [8.5481, 47.376],
          [8.5481, 47.3761],
          [8.548, 47.3761],
          [8.548, 47.376],
        ],
      ],
    ],
  };
  const room = adapter.geographicRoom(ref, outline);
  assert.equal(room.id, ref.id);
  assert.ok(
    room.measurements.widthMeters > 7 && room.measurements.widthMeters < 8,
  );
  assert.ok(
    room.measurements.heightMeters > 11 && room.measurements.heightMeters < 12,
  );
  const p = adapter.geographicPoint(room, ...room.points[2]);
  assert.ok(Math.abs(p.lng - 8.5481) < 1e-10);
  assert.ok(Math.abs(p.lat - 47.3761) < 1e-10);
  assert.throws(
    () =>
      adapter.geographicRoom(ref, {
        ...outline,
        coordinates: [...outline.coordinates, ...outline.coordinates],
      }),
    /one room polygon/,
  );
  assert.throws(() => adapter.geographicRoom(ref, null), /one room polygon/);
  const raw = {
    id: ref.levelId,
    origin: [8.548, 47.376],
    scale: 1e6,
    rooms: [
      {
        id: ref.id,
        name: ref.name,
        kind: "teaching",
        rings: [[[0, 0, 100, 0, 100, 100, 0, 100, 0, 0]]],
      },
    ],
  };
  assert.equal(
    adapter.decodeRoom(raw, ref.id, ref).mapRef.levelId,
    ref.levelId,
  );
});
test("backend identities survive binding and labels remain independent of numbering", () => {
  const room = geometry.rooms[0];
  let objects = geometry.place(room, [], "table", 260, 280, "local-table");
  const slot = geometry.slots(objects[0])[0];
  objects = geometry.place(room, objects, "seat", slot.x, slot.y, "local-seat");
  const bound = adapter.bindSeats(objects, [
    {
      localId: "local-seat",
      seatId: "2c7f2b2f-3dc1-4f78-9d93-339bd3d5f100",
      label: "A-7",
    },
  ]);
  const space = {
    id: "local",
    backendSpaceId: "48c2b0cd-f53f-40aa-937d-022676d5f180",
    layout: bound,
  };
  const preview = adapter.studentPreview(space, room, [
    {
      id: bound[1].backendSeatId,
      label: "A-7",
      state: "claimable",
      is_active: true,
    },
  ]);
  assert.equal(preview.objects[1].state, "bookable");
  assert.equal(preview.objects[1].label, "A-7");
  assert.equal(preview.spaceId, space.backendSpaceId);
  assert.equal(adapter.studentPreview(space, room).objects[1].state, "unknown");
  assert.throws(
    () => adapter.bindSeats(objects, [{ localId: "missing", seatId: "x" }]),
    /unknown/,
  );
  assert.throws(
    () =>
      adapter.bindSeats(objects, [
        { localId: "local-seat", seatId: "x" },
        { localId: "local-seat", seatId: "y" },
      ]),
    /one-to-one/,
  );
  const payload = adapter.layoutPayload(space, room);
  assert.equal(payload.layout.objects[1].backendSeatId, bound[1].backendSeatId);
  assert.equal("state" in payload.layout.objects[1], false);
  assert.equal("qr_token" in payload.layout.objects[1], false);
  assert.equal(objects[1].backendSeatId, undefined);
});
