/* Local sample spaces. No backend requests. */
(function (root) {
  "use strict";
  const geometry =
    root.AdminLayoutData ||
    (typeof require !== "undefined" ? require("./layout-data.js") : null);
  const KEY = "study-admin-spaces-v1",
    zones = ["Europe/Zurich", "Europe/Berlin", "UTC"];
  function seed() {
    return {
      version: 2,
      deletedSpaces: [],
      spaces: [
        {
          id: "hauptbibliothek",
          name: "Hauptbibliothek · Lesesaal",
          roomId: "hg-e-11",
          timeZone: "Europe/Zurich",
          seats: 4,
          active: 3,
          free: 0,
          occupied: 2,
          onBreak: 1,
          sample: true,
          layout: null,
        },
        {
          id: "baubibliothek",
          name: "Baubibliothek · Hönggerberg",
          roomId: null,
          timeZone: "Europe/Zurich",
          seats: 4,
          active: 4,
          free: 3,
          occupied: 1,
          onBreak: 0,
          sample: true,
          layout: null,
        },
      ],
    };
  }
  function load(storage) {
    try {
      const data = JSON.parse(storage.getItem(KEY));
      if (
        [1, 2].includes(data?.version) &&
        Array.isArray(data.spaces) &&
        data.spaces.every(
          (s) =>
            typeof s.id === "string" &&
            typeof s.name === "string" &&
            zones.includes(s.timeZone) &&
            ["seats", "active", "free", "occupied", "onBreak"].every(
              (k) => Number.isInteger(s[k]) && s[k] >= 0,
            ),
        )
      ) {
        return {
          version: 2,
          deletedSpaces: Array.isArray(data.deletedSpaces)
            ? data.deletedSpaces
            : [],
          spaces: data.spaces.map((s) => {
            const { latitude, longitude, ...rest } = s;
            return {
              ...rest,
              roomId: s.roomId || null,
              layout: Array.isArray(s.layout) ? s.layout : null,
            };
          }),
        };
      }
    } catch {}
    return seed();
  }
  function save(storage, state) {
    try {
      storage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }
  function create(state, input, id) {
    const name = String(input.name || "")
      .trim()
      .replace(/\s+/g, " ");
    if (!name || name.length > 120)
      throw Error("Enter a space name between 1 and 120 characters.");
    if (
      state.spaces.some(
        (s) => s.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    )
      throw Error("A space with this name already exists.");
    if (!geometry.room(input.roomId)) throw Error("Choose a room on the map.");
    if (state.spaces.some((s) => s.roomId === input.roomId))
      throw Error("This room already has a study space. Choose another room.");
    if (!zones.includes(input.timeZone))
      throw Error("Choose a supported time zone.");
    if (!id || state.spaces.some((s) => s.id === id))
      throw Error("Could not create a unique space.");
    return {
      ...state,
      spaces: [
        ...state.spaces,
        {
          id,
          name,
          roomId: input.roomId,
          timeZone: input.timeZone,
          seats: 0,
          active: 0,
          free: 0,
          occupied: 0,
          onBreak: 0,
          sample: false,
          layout: [],
        },
      ],
    };
  }
  function saveLayout(state, id, objects) {
    const space = state.spaces.find((s) => s.id === id);
    if (!space) throw Error("Space not found.");
    const r = geometry.room(space.roomId) || geometry.rooms[0];
    objects = geometry.renumber(objects);
    geometry.assertLayout(r, objects);
    const seats = objects.filter((o) => o.type === "seat"),
      numbers = seats.map((o) => o.number);
    if (
      new Set(numbers).size !== numbers.length ||
      objects.some((o) => !geometry.valid(r, o))
    )
      throw Error("Check the layout and unique seat numbers.");
    return {
      ...state,
      spaces: state.spaces.map((s) =>
        s.id === id
          ? {
              ...s,
              layout: geometry.clone(objects),
              seats: seats.length,
              active: seats.filter((o) => o.active !== false).length,
              free: seats.filter(
                (o) => o.active !== false && o.state === "free",
              ).length,
              occupied: seats.filter(
                (o) => o.active !== false && o.state === "occupied",
              ).length,
              onBreak: seats.filter(
                (o) => o.active !== false && o.state === "break",
              ).length,
            }
          : s,
      ),
    };
  }
  function remove(state, id) {
    const space = state.spaces.find((s) => s.id === id);
    if (!space) throw Error("Space not found.");
    return {
      ...state,
      spaces: state.spaces.filter((s) => s.id !== id),
      deletedSpaces: [...(state.deletedSpaces || []), geometry.clone(space)],
    };
  }
  function restore(state, id) {
    const space = (state.deletedSpaces || []).find((s) => s.id === id);
    if (!space) throw Error("Deleted space not found.");
    if (
      state.spaces.some(
        (s) =>
          s.id === id ||
          (space.roomId && s.roomId === space.roomId) ||
          s.name.toLocaleLowerCase() === space.name.toLocaleLowerCase(),
      )
    )
      throw Error("A study place already uses this room or name.");
    return {
      ...state,
      spaces: [...state.spaces, geometry.clone(space)],
      deletedSpaces: state.deletedSpaces.filter((s) => s.id !== id),
    };
  }
  const api = {
    KEY,
    zones,
    seed,
    load,
    save,
    create,
    saveLayout,
    remove,
    restore,
  };
  root.AdminSpacesData = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
