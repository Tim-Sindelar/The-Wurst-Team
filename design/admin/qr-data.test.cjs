const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  qr = require("./qr-data.js");
test("room identities normalize consistently and preserve ETH punctuation", () => {
  const space = { layout: null, seats: 2 };
  const a = qr.labels(space, "  hg   eo 30.0065  ", "https://example.com/");
  const b = qr.labels(space, "HG EO 30.0065", "https://example.com");
  assert.deepEqual(a, b);
  assert.equal(new URL(a[0].url).searchParams.get("room"), "HG EO 30.0065");
  assert.equal(new URL(a[0].url).pathname, "/check-in");
  assert.equal(new URL(a[1].url).searchParams.get("seat"), "2");
  assert.notEqual(a[0].url, a[1].url);
  assert.equal(qr.normalizeRoom("b204"), "B204");
  assert.throws(() => qr.normalizeRoom("HG/E1"));
  assert.throws(() => qr.normalizeRoom("A".repeat(65)));
});
test("labels use actual saved seat numbers, including inactive seats", () => {
  const space = {
    seats: 99,
    layout: [
      { type: "table", number: 1 },
      { type: "seat", number: 8, active: false },
      { type: "seat", number: 2 },
    ],
  };
  assert.deepEqual(qr.seatNumbers(space), [2, 8]);
  const labels = qr.labels(space, "HG E 1.1", "https://example.com");
  assert.deepEqual(
    labels.map((l) => new URL(l.url).searchParams.get("seat")),
    ["2", "8"],
  );
  assert.deepEqual(
    space.layout.filter((o) => o.type === "seat").map((o) => o.number),
    [8, 2],
  );
});
test("empty, oversized or duplicate-seat layouts cannot generate labels", () => {
  assert.throws(() => qr.seatNumbers({ layout: [], seats: 10 }), /Add seats/);
  assert.throws(() => qr.seatNumbers({ layout: null, seats: 0 }));
  assert.equal(qr.seatNumbers({ layout: null, seats: 200 }).length, 200);
  assert.throws(() => qr.seatNumbers({ layout: null, seats: 201 }), /200/);
  assert.throws(() =>
    qr.seatNumbers({
      layout: [
        { type: "seat", number: 1 },
        { type: "seat", number: 1 },
      ],
    }),
  );
  assert.throws(() =>
    qr.seatNumbers({ layout: [{ type: "seat", number: 0 }] }),
  );
});
test("app addresses accept only clean HTTP(S) origins", () => {
  assert.equal(qr.appAddress(" https://example.com/ "), "https://example.com");
  assert.equal(qr.appAddress("http://localhost:5173"), "http://localhost:5173");
  for (const value of [
    "bad",
    "javascript:alert(1)",
    "https://example.com/path",
    "https://example.com?q=1",
    "https://example.com/#a",
    "https://user:secret@example.com",
  ])
    assert.throws(() => qr.appAddress(value));
});
