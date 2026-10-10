/* Pure adapters for main's separate map and reservation identities. No API calls. */
(function (root) {
  "use strict";
  const geometry =
    root.AdminLayoutData ||
    (typeof require !== "undefined" ? require("./layout-data.js") : null);
  const states = {
    free: "free",
    reserved: "reserved",
    occupied: "occupied",
    on_break: "break",
    claimable: "bookable",
    unavailable: "unavailable",
  };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  function seatState(state) {
    if (!Object.hasOwn(states, state))
      throw Error("Unknown backend seat state: " + state);
    return states[state];
  }
  function overview(response) {
    const s = response?.space;
    if (!s || !Array.isArray(s.seats) || typeof s.id !== "string")
      throw Error("Expected an admin space overview response.");
    return {
      id: s.id,
      backendSpaceId: s.id,
      name: s.name,
      timeZone: s.timezone,
      isOpen: s.is_open,
      serverTime: response.server_time,
      seats: s.seats.map((seat) => ({
        id: seat.id,
        label: seat.label,
        state: seatState(seat.state),
        active: seat.is_active,
        reservableAt: seat.reservable_at,
        currentReservation: seat.current_reservation,
        upcomingReservation: seat.upcoming_reservation,
      })),
      layout: clone(s.layout),
      openingHours: clone(s.opening_hours),
      closures: clone(s.closures),
    };
  }
  function geographicRoom(ref, outline) {
    if (
      outline?.type !== "MultiPolygon" ||
      outline.coordinates.length !== 1 ||
      outline.coordinates[0].length !== 1
    )
      throw Error(
        "The editor needs one room polygon without holes. Keep multi-wing/hole geometry in the campus map until the editor supports it.",
      );
    const ring = outline.coordinates[0][0];
    if (
      ring.length < 4 ||
      ring[0][0] !== ring.at(-1)[0] ||
      ring[0][1] !== ring.at(-1)[1] ||
      ring.some(
        (p) =>
          !Number.isFinite(p[0]) ||
          !Number.isFinite(p[1]) ||
          Math.abs(p[0]) > 180 ||
          Math.abs(p[1]) > 90,
      )
    )
      throw Error("Use a closed GeoJSON ring in [longitude, latitude] order.");
    const origin = { lng: ring[0][0], lat: ring[0][1] },
      metersLat = (6371008.8 * Math.PI) / 180,
      metersLng = metersLat * Math.cos((origin.lat * Math.PI) / 180);
    const room = geometry.roomFromCoordinates({
      id: ref.id,
      label: ref.name,
      kind: ref.kind || "Study room",
      building: ref.facilityId,
      coordinateUnit: "m",
      coordinateAxis: "cartesian",
      approximate: true,
      boundary: ring
        .slice(0, -1)
        .map(([lng, lat]) => [
          (lng - origin.lng) * metersLng,
          (lat - origin.lat) * metersLat,
        ]),
    });
    return {
      ...room,
      mapRef: {
        unitId: ref.id,
        levelId: ref.levelId,
        facilityId: ref.facilityId,
        floor: ref.floor,
      },
      georeference: { origin, metersLat, metersLng },
      outline: clone(outline),
    };
  }
  function decodeRoom(rawLevel, id, ref) {
    const raw = rawLevel?.rooms?.find((r) => r.id === id);
    if (
      !raw ||
      !Number.isFinite(rawLevel.scale) ||
      rawLevel.scale <= 0 ||
      !Array.isArray(rawLevel.origin)
    )
      throw Error("Room not found in this floor plan.");
    const coordinates = raw.rings.map((poly) =>
      poly.map((flat) => {
        if (flat.length % 2) throw Error("Invalid floor ring offsets.");
        const ring = [];
        for (let i = 0; i < flat.length; i += 2)
          ring.push([
            rawLevel.origin[0] + flat[i] / rawLevel.scale,
            rawLevel.origin[1] + flat[i + 1] / rawLevel.scale,
          ]);
        return ring;
      }),
    );
    return geographicRoom(
      { ...ref, id, name: raw.name, kind: raw.kind, levelId: rawLevel.id },
      { type: "MultiPolygon", coordinates },
    );
  }
  function geographicPoint(room, x, y) {
    if (!room.georeference)
      throw Error(
        "No geographic room reference. Do not derive room size from a campus pin.",
      );
    const p = geometry.sourcePoint(room, x, y),
      g = room.georeference;
    return {
      lat: g.origin.lat + p.y / g.metersLat,
      lng: g.origin.lng + p.x / g.metersLng,
    };
  }
  function layoutPayload(space, room) {
    const objects = geometry.renumber(clone(space.layout || []));
    geometry.assertLayout(room, objects);
    const config = objects.map((o) => {
      const {
        state,
        qr_token,
        qrToken,
        currentReservation,
        upcomingReservation,
        ...rest
      } = o;
      return rest;
    });
    return {
      layout: {
        schemaVersion: 1,
        unitsPerMeter: geometry.UNITS_PER_METER,
        room: clone(room),
        objects: config,
      },
    };
  }
  function studentPreview(space, room, availability = []) {
    const statesById = new Map(availability.map((s) => [s.id, s]));
    return {
      spaceId: space.backendSpaceId || space.id,
      name: space.name,
      room,
      objects: clone(space.layout || []).map((o) => {
        if (o.type !== "seat") return o;
        const live = statesById.get(o.backendSeatId);
        return {
          ...o,
          label:
            live?.label || o.backendLabel || String(o.number).padStart(2, "0"),
          state: live
            ? live.is_active === false
              ? "unavailable"
              : seatState(live.state)
            : o.active === false
              ? "unavailable"
              : space.backendSpaceId
                ? "unknown"
                : o.state || "free",
          active: live ? live.is_active : o.active,
          features: (o.badges || [])
            .map((b) => geometry.BADGES[b])
            .filter(Boolean),
        };
      }),
    };
  }
  function bindSeats(objects, bindings) {
    const ids = new Set(),
      byLocal = new Map();
    for (const b of bindings) {
      if (
        !b.localId ||
        !b.seatId ||
        ids.has(b.seatId) ||
        byLocal.has(b.localId)
      )
        throw Error("Seat bindings must be one-to-one.");
      ids.add(b.seatId);
      byLocal.set(b.localId, b);
    }
    if (
      bindings.some(
        (b) => !objects.some((o) => o.type === "seat" && o.id === b.localId),
      )
    )
      throw Error("Binding points to an unknown editor seat.");
    return objects.map((o) => {
      const b = byLocal.get(o.id);
      return b
        ? { ...o, backendSeatId: b.seatId, backendLabel: b.label }
        : clone(o);
    });
  }
  const api = {
    seatState,
    overview,
    geographicRoom,
    decodeRoom,
    geographicPoint,
    layoutPayload,
    studentPreview,
    bindSeats,
  };
  root.AdminIntegrationData = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
