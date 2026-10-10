/* QR label prototype: matches tools/qr-generator seat links. No check-in requests. */
(function (root) {
  "use strict";
  function normalizeRoom(value) {
    const room = String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9 .-]{0,63}$/.test(room))
      throw Error(
        "Use a room label such as HG E 1.1 or HG EO 30.0065 (up to 64 letters, numbers, spaces, dots or hyphens).",
      );
    return room;
  }
  function appAddress(value) {
    let url;
    try {
      url = new URL(String(value).trim());
    } catch {
      throw Error("Enter a full app address, such as https://example.com.");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.origin.length > 200
    )
      throw Error(
        "Use an HTTP or HTTPS app address without a path, login details or query parameters.",
      );
    return url.origin;
  }
  function seatNumbers(space) {
    if (!space) throw Error("Select a study space.");
    const seats = Array.isArray(space.layout)
      ? space.layout.filter((o) => o.type === "seat").map((o) => o.number)
      : Array.from(
          { length: Math.min(201, Math.max(0, space.seats || 0)) },
          (_, i) => i + 1,
        );
    if (!seats.length)
      throw Error("Add seats in Layout before generating QR codes.");
    if (seats.length > 200)
      throw Error("This prototype supports up to 200 seat labels per space.");
    if (
      seats.some((n) => !Number.isInteger(n) || n < 1 || n > 999) ||
      new Set(seats).size !== seats.length
    )
      throw Error("Check the seat numbers in Layout before printing.");
    return seats.sort((a, b) => a - b);
  }
  function labels(space, room, address) {
    const normalized = normalizeRoom(room),
      baseUrl = appAddress(address);
    return seatNumbers(space).map((seat) => {
      const url = new URL("/check-in", baseUrl);
      url.searchParams.set("room", normalized);
      url.searchParams.set("seat", String(seat));
      return { room: normalized, seat, url: url.href };
    });
  }
  const api = { normalizeRoom, appAddress, seatNumbers, labels };
  root.AdminQrData = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
