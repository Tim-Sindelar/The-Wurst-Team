(() => {
  "use strict";
  const api = window.AdminSpacesData,
    geometry = window.AdminLayoutData;
  let storage,
    state = api.seed();
  try {
    storage = localStorage;
    state = api.load(storage);
  } catch {}
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const url = (s) => "03-space-seats.html?space=" + encodeURIComponent(s.id);
  const editorUrl = (s) =>
    "06-space-layout.html?space=" + encodeURIComponent(s.id);
  function list() {
    const q = document
        .querySelector('input[type="search"]')
        .value.toLowerCase()
        .trim(),
      spaces = state.spaces.filter((s) =>
        (s.name + " " + s.timeZone).toLowerCase().includes(q),
      );
    document.querySelector(".table tbody").innerHTML =
      spaces
        .map(
          (s) =>
            '<tr><td><div class="table__name"><a class="table__link" href="' +
            url(s) +
            '">' +
            esc(s.name) +
            '</a><span class="t-small t-muted">' +
            esc(geometry.room(s.roomId)?.label || s.timeZone) +
            '</span></div></td><td><span class="chip is-free">Open</span></td><td class="num">' +
            s.seats +
            '</td><td class="num">' +
            s.active +
            '</td><td class="num"><span class="avail ' +
            (s.free ? "avail--high" : "avail--none") +
            '">' +
            s.free +
            '</span></td><td class="num">' +
            s.occupied +
            '</td><td class="num">' +
            s.onBreak +
            '</td><td class="actions"><a class="btn btn--quiet" href="' +
            url(s) +
            '">Manage</a><button class="btn btn--quiet" type="button" data-delete-space="' +
            esc(s.id) +
            '">Delete</button></td></tr>',
        )
        .join("") ||
      '<tr><td colspan="8">No spaces match your search.</td></tr>';
    const values = document.querySelectorAll(".stats .stat__value"),
      sum = (key) => state.spaces.reduce((n, s) => n + s[key], 0);
    values[0].textContent = state.spaces.length;
    values[1].innerHTML =
      sum("free") +
      ' <span class="t-small t-muted">of ' +
      sum("active") +
      " active</span>";
    values[2].textContent = sum("occupied");
    values[3].textContent = sum("onBreak");
  }
  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("space-create-form");
    if (form) {
      const locations = [
        [24, 24],
        [322, 24],
        [620, 24],
      ];
      document.getElementById("room-picker-items").innerHTML = geometry.rooms
        .map((r, i) => {
          const used = state.spaces.some((s) => s.roomId === r.id),
            [x, y] = locations[i],
            mapScale = Math.min(256 / r.width, 320 / r.height),
            offsetX = (256 - r.width * mapScale) / 2,
            offsetY = (320 - r.height * mapScale) / 2;
          return (
            '<g class="picker-room' +
            (used ? " is-registered" : "") +
            '" role="button" tabindex="0" data-room="' +
            r.id +
            '" aria-label="' +
            r.label +
            ", " +
            r.kind +
            (used ? ", already registered" : "") +
            '" aria-pressed="false" aria-disabled="' +
            used +
            '" transform="translate(' +
            x +
            " " +
            y +
            ')"><path d="' +
            r.points
              .map(
                (p, j) =>
                  (j ? "L" : "M") +
                  (offsetX + p[0] * mapScale) +
                  " " +
                  (offsetY + p[1] * mapScale),
              )
              .join("") +
            'Z"/><text x="128" y="130" text-anchor="middle">' +
            r.label +
            '</text><text class="picker-kind" x="128" y="154" text-anchor="middle">' +
            r.kind +
            "</text>" +
            (used
              ? '<text class="picker-kind" x="128" y="180" text-anchor="middle">Already registered</text>'
              : "") +
            "</g>"
          );
        })
        .join("");
      const search = document.getElementById("room-search"),
        results = document.getElementById("room-search-results"),
        searchField = document.getElementById("room-search-field"),
        roomId = document.getElementById("room-id"),
        name = document.getElementById("name");
      const registered = (r) => state.spaces.some((s) => s.roomId === r.id);
      const matches = () => {
        const terms = search.value
          .toLowerCase()
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        return geometry.rooms.filter((r) =>
          terms.every((term) =>
            (r.label + " " + r.kind + " " + r.building)
              .toLowerCase()
              .includes(term),
          ),
        );
      };
      const showResults = () => {
        results.innerHTML =
          matches()
            .map(
              (r) =>
                '<button class="room-search-result" type="button" data-room-result="' +
                esc(r.id) +
                '"' +
                (registered(r) ? " disabled" : "") +
                "><strong>" +
                esc(r.label) +
                '</strong><span class="t-small t-muted">' +
                esc(r.kind + " · " + r.building) +
                (registered(r) ? " · Already registered" : "") +
                "</span></button>",
            )
            .join("") ||
          '<p class="t-small t-muted room-search-empty" role="status">No matching rooms.</p>';
        results.hidden = false;
      };
      const select = (target) => {
        const r = geometry.room(
          target.dataset.room || target.dataset.roomResult,
        );
        if (!r || registered(r)) return;
        name.value = r.label + " · " + r.kind;
        search.value = name.value;
        roomId.value = r.id;
        document.getElementById("room-selection").textContent =
          name.value + " selected";
        document.getElementById("space-form-error").hidden = true;
        document
          .querySelectorAll("[data-room]")
          .forEach((el) =>
            el.setAttribute("aria-pressed", String(el.dataset.room === r.id)),
          );
        results.hidden = true;
      };
      search.addEventListener("focus", showResults);
      search.addEventListener("input", () => {
        document.getElementById("space-form-error").hidden = true;
        roomId.value = "";
        name.value = "";
        document.getElementById("room-selection").textContent =
          "No room selected";
        document
          .querySelectorAll("[data-room]")
          .forEach((el) => el.setAttribute("aria-pressed", "false"));
        showResults();
      });
      results.addEventListener("click", (event) => {
        const button = event.target.closest("[data-room-result]");
        if (button) select(button);
      });
      searchField.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          results.hidden = true;
          search.focus();
          results.hidden = true;
        } else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault();
          if (results.hidden) showResults();
          const buttons = [
            ...results.querySelectorAll("button:not(:disabled)"),
          ];
          const current = buttons.indexOf(document.activeElement);
          const index =
            event.key === "ArrowDown"
              ? (current + 1) % buttons.length
              : current <= 0
                ? buttons.length - 1
                : current - 1;
          buttons[index]?.focus();
        } else if (
          event.key === "Enter" &&
          event.target === search &&
          !results.hidden
        ) {
          event.preventDefault();
          const available = matches().filter((r) => !registered(r));
          if (available.length === 1) {
            select({ dataset: { room: available[0].id } });
          } else results.querySelector("button:not(:disabled)")?.focus();
        }
      });
      document.addEventListener("click", (event) => {
        if (!searchField.contains(event.target)) results.hidden = true;
      });
      searchField.addEventListener("focusout", (event) => {
        if (!searchField.contains(event.relatedTarget)) results.hidden = true;
      });
      document.getElementById("room-picker").addEventListener("click", (e) => {
        const el = e.target.closest("[data-room]");
        if (el) select(el);
      });
      document
        .getElementById("room-picker")
        .addEventListener("keydown", (e) => {
          if (
            ["Enter", " "].includes(e.key) &&
            e.target.matches("[data-room]")
          ) {
            e.preventDefault();
            select(e.target);
          }
        });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const error = document.getElementById("space-form-error");
        error.hidden = true;
        try {
          if (!roomId.value)
            throw Error("Select a room from the search results or map.");
          const next = api.create(
            state,
            Object.fromEntries(new FormData(form)),
            crypto.randomUUID(),
          );
          if (!storage || !api.save(storage, next))
            throw Error("Enable browser storage to save the space.");
          location.href = editorUrl(next.spaces.at(-1)) + "&created=1";
        } catch (problem) {
          error.textContent = problem.message;
          error.hidden = false;
          error.focus();
        }
      });
      return;
    }
    list();
    document.addEventListener("spaces-changed", () => {
      if (storage) state = api.load(storage);
      list();
    });
    document
      .querySelector('input[type="search"]')
      .addEventListener("input", list);
    const refresh = document.querySelector(
      '[data-banner-open="banner-refreshed"]',
    );
    refresh.removeAttribute("data-banner-open");
    refresh.addEventListener("click", () => {
      if (storage) state = api.load(storage);
      list();
      const banner = document.getElementById("banner-refreshed");
      banner.querySelector(".t-small").textContent =
        "Local sample spaces refreshed.";
      banner.hidden = false;
      clearTimeout(banner._timer);
      banner._timer = setTimeout(() => (banner.hidden = true), 6000);
    });
    window.addEventListener("storage", (e) => {
      if (e.key === api.KEY) {
        state = api.load(storage);
        list();
      }
    });
  });
})();
