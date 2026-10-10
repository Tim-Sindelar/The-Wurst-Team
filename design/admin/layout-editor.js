(() => {
  "use strict";
  const api = window.AdminSpacesData,
    geometry = window.AdminLayoutData;
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
  document.addEventListener("DOMContentLoaded", () => {
    let storage,
      state = api.seed();
    try {
      storage = localStorage;
      state = api.load(storage);
    } catch {}
    const spaceId =
      new URLSearchParams(location.search).get("space") || state.spaces[0]?.id;
    const space = state.spaces.find((s) => s.id === spaceId);
    if (!space) {
      document.querySelector("main .page").innerHTML =
        '<h1 class="t-heading">Space not found</h1><a href="01-spaces.html">Back to spaces</a>';
      return;
    }
    const room = geometry.room(space.roomId) || geometry.rooms[0],
      svg = document.getElementById("layout-canvas");
    let objects = geometry.clone(space.layout || []),
      selected = null,
      tool = "select",
      undo = [],
      redo = [],
      drag = null,
      zoom = 1,
      view = { x: 0, y: 0 };
    if (space.layout === null && space.seats) {
      objects = [
        {
          id: "table-a",
          type: "table",
          x: 260,
          y: 280,
          width: 128,
          height: 36,
          angle: 0,
          label: "A",
        },
      ];
      for (let i = 0; i < space.seats; i++)
        objects.push({
          id: "seat-" + (i + 1),
          type: "seat",
          x: 220 + (i % 2) * 56,
          y: 240 + Math.floor(i / 2) * 80,
          width: 32,
          height: 36,
          angle: 0,
          number: i + 1,
          state:
            i < space.occupied
              ? "occupied"
              : i < space.occupied + space.onBreak
                ? "break"
                : "free",
          active: i < space.active,
        });
    }
    let saved = JSON.stringify(objects);
    objects = geometry.renumber(geometry.normalize(room, objects));
    document.getElementById("editor-title").textContent = space.name;
    document.getElementById("editor-room").textContent =
      room.label + " · " + room.kind + " · " + space.timeZone;
    const measurements = room.measurements;
    const length = (value) =>
      new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
    document.getElementById("editor-room-size").textContent =
      (measurements.approximate ? "Approx. " : "") +
      length(measurements.widthMeters) +
      " × " +
      length(measurements.heightMeters) +
      " m · " +
      length(measurements.areaSquareMeters) +
      " m²";
    svg.style.aspectRatio = room.width + " / " + room.height;
    document
      .getElementById("editor-outline")
      .setAttribute(
        "d",
        room.points.map((p, i) => (i ? "L" : "M") + p.join(" ")).join("") + "Z",
      );
    function message(text) {
      document.getElementById("editor-message").textContent = text;
    }
    function checkpoint(before) {
      if (JSON.stringify(before) === JSON.stringify(objects)) return;
      undo.push(before);
      redo = [];
      render();
    }
    function change(next) {
      const before = geometry.clone(objects);
      objects = geometry.renumber(next);
      checkpoint(before);
    }
    function renderView() {
      svg.setAttribute(
        "viewBox",
        view.x +
          " " +
          view.y +
          " " +
          room.width / zoom +
          " " +
          room.height / zoom,
      );
    }
    const badgeIcons = {
      outlet: '<path d="M8 3v5M16 3v5M6 8h12v4a6 6 0 0 1-6 6v3M6 10h12"/>',
      monitor:
        '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v4M8 21h8"/>',
      quiet: '<path d="M4 10h4l5-5v14l-5-5H4zM17 9l4 6M21 9l-4 6"/>',
      coffee:
        '<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9zM16 11h2a2.5 2.5 0 0 1 0 5h-2M8 3v2M12 3v2"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    };
    const badgeIcon = (name) =>
      '<svg class="editor-badge-icon" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">' +
      badgeIcons[name] +
      "</svg>";
    function applyBadge(id, badge) {
      try {
        selected = id;
        change(geometry.toggleBadge(objects, id, badge));
        const seat = objects.find((o) => o.id === id);
        const target =
          seat.type === "table"
            ? "table " + seat.label + " and its seats"
            : "seat " + seat.number;
        message(
          geometry.BADGES[badge] +
            (seat.badges.includes(badge) ? " added to " : " removed from ") +
            target +
            ".",
        );
      } catch (error) {
        message(error.message);
      }
    }
    function render(refreshProperties = true) {
      document.getElementById("editor-items").innerHTML = [...objects]
        .sort((a, b) => (a.type === "row" ? 0 : 1) - (b.type === "row" ? 0 : 1))
        .map((o) => {
          const w = o.width,
            h = o.height;
          let shape = "";
          if (o.type === "table")
            shape =
              '<rect class="editor-table" x="' +
              -w / 2 +
              '" y="' +
              -h / 2 +
              '" width="' +
              w +
              '" height="' +
              h +
              '" rx="5"/><text class="editor-table-label" text-anchor="middle" dominant-baseline="middle">' +
              esc(o.label || "") +
              "</text>";

          if (o.type === "table" && o.shape === "round")
            shape =
              '<circle class="editor-table" r="' +
              w / 2 +
              '"/><text class="editor-table-label" text-anchor="middle" dominant-baseline="middle">' +
              esc(o.label) +
              "</text>";
          if (o.type === "table" && o.shape === "l")
            shape =
              '<path class="editor-table" d="M' +
              -w / 2 +
              " " +
              -h / 2 +
              "H" +
              w / 2 +
              "V" +
              (-h / 2 + 32) +
              "H" +
              (-w / 2 + 32) +
              "V" +
              h / 2 +
              "H" +
              -w / 2 +
              'Z"/><text class="editor-table-label" text-anchor="middle" dominant-baseline="middle" y="' +
              (-h / 2 + 16) +
              '">' +
              esc(o.label) +
              "</text>";
          if (o.type === "table" && o.shape === "curved") {
            const outline = geometry.curveOutline(o);
            shape =
              '<path class="editor-table" d="' +
              outline.map((p, i) => (i ? "L" : "M") + p.join(" ")).join("") +
              'Z"/><text class="editor-table-label" text-anchor="middle" dominant-baseline="middle">' +
              esc(o.label) +
              "</text>";
          }
          if (o.type === "table") {
            const labelY =
              o.shape === "l"
                ? -h / 2 + 16
                : o.shape === "curved"
                  ? (-o.width * 0.175 * (o.curvature ?? 60)) / 100
                  : 0;
            if (o.shape === "curved")
              shape = shape.replace(
                'class="editor-table-label"',
                'class="editor-table-label" y="' + labelY + '"',
              );
            shape = shape.replace(
              'class="editor-table-label"',
              'class="editor-table-label" transform="rotate(' +
                -(o.angle || 0) +
                " 0 " +
                labelY +
                ')"',
            );
          }
          if (o.type === "table") {
            const a = (-(o.angle || 0) * Math.PI) / 180;
            shape += geometry
              .slots(o)
              .filter((slot) => {
                const candidate = {
                  ...slot,
                  type: "seat",
                  width: 32,
                  height: 36,
                };
                return (
                  geometry.valid(room, candidate) &&
                  !objects.some(
                    (other) =>
                      ["seat", "table"].includes(other.type) &&
                      geometry.overlaps(candidate, other),
                  )
                );
              })
              .map((slot) => {
                const dx = slot.x - o.x,
                  dy = slot.y - o.y;
                return (
                  '<circle class="editor-seat-slot" cx="' +
                  (dx * Math.cos(a) - dy * Math.sin(a)) +
                  '" cy="' +
                  (dx * Math.sin(a) + dy * Math.cos(a)) +
                  '" r="4"><title>Available seat position</title></circle>'
                );
              })
              .join("");
          }
          if (o.type === "row") {
            const positions = geometry.slots({ ...o, x: 0, y: 0, angle: 0 });
            for (let row = 0; row < o.rows; row++) {
              const points = positions.filter((p) =>
                p.slot.startsWith("row" + row + ":"),
              );

              const radius =
                Math.max(
                  o.radius,
                  56 /
                    (2 *
                      Math.sin(
                        (o.sweep * Math.PI) /
                          180 /
                          Math.max(1, o.count - 1) /
                          2,
                      )),
                ) +
                row * 64;
              const d =
                points.length > 1 && o.sweep
                  ? "M" +
                    points[0].x +
                    " " +
                    points[0].y +
                    "A" +
                    radius +
                    " " +
                    radius +
                    " 0 0 0 " +
                    points.at(-1).x +
                    " " +
                    points.at(-1).y
                  : points
                      .map((p, i) => (i ? "L" : "M") + p.x + " " + p.y)
                      .join(" ");
              shape +=
                '<path class="editor-row-hit" d="' +
                d +
                '"/><path class="editor-row-guide" d="' +
                d +
                '"/>';
            }

            const scale = svg.getScreenCTM()?.a || 1;
            const labelY = Math.min(...positions.map((p) => p.y)) - 40 / scale;
            shape +=
              '<g class="editor-row-label" transform="translate(0 ' +
              labelY +
              ") scale(" +
              1 / scale +
              ')"><rect x="-48" y="-22" width="96" height="44" rx="8"/><text text-anchor="middle" dominant-baseline="middle">' +
              esc(o.label) +
              "</text></g>";
          }
          if (o.type === "seat")
            shape =
              '<rect class="editor-seat is-' +
              o.state +
              '" x="-16" y="-18" width="32" height="36" rx="5"/><text class="editor-seat-label" text-anchor="middle" dominant-baseline="middle" transform="rotate(' +
              -o.angle +
              ')">' +
              String(o.number).padStart(2, "0") +
              "</text>";
          if (o.type === "seat") {
            const badges = (o.badges || []).filter((b) => geometry.BADGES[b]);
            const stateBadge =
              o.state === "break"
                ? "coffee"
                : o.state === "bookable"
                  ? "clock"
                  : null;
            const drawBadge = (name, x, y, title) =>
              '<g class="editor-seat-badge" transform="translate(' +
              x +
              " " +
              y +
              ')"><title>' +
              title +
              '</title><circle r="9"/><svg x="-6" y="-6" width="12" height="12" viewBox="0 0 24 24">' +
              badgeIcons[name] +
              "</svg></g>";
            shape +=
              '<g transform="rotate(' +
              -(o.angle || 0) +
              ')">' +
              badges
                .map((b, i) =>
                  drawBadge(
                    b,
                    (i - (badges.length - 1) / 2) * 19,
                    23,
                    geometry.BADGES[b],
                  ),
                )
                .join("") +
              (stateBadge
                ? drawBadge(
                    stateBadge,
                    17,
                    -18,
                    stateBadge === "coffee" ? "On break" : "Bookable later",
                  )
                : "") +
              "</g>";
          }
          if (o.type === "window")
            shape =
              '<path class="editor-wall-hit" d="M' +
              -w / 2 +
              " 0H" +
              w / 2 +
              '"/><path class="floor-plan__window" d="M' +
              -w / 2 +
              " 0H" +
              w / 2 +
              '"/>';
          if (o.type === "door")
            shape =
              '<path class="editor-wall-hit" d="M' +
              -w / 2 +
              " 0H" +
              w / 2 +
              '"/><path class="editor-door-gap" d="M' +
              -w / 2 +
              " 0H" +
              w / 2 +
              '"/><path class="floor-plan__door" d="M' +
              -w / 2 +
              " 0V" +
              w +
              "M" +
              -w / 2 +
              " " +
              w +
              "A" +
              w +
              " " +
              w +
              " 0 0 0 " +
              w / 2 +
              ' 0"/>';
          const label =
            o.type === "seat"
              ? "Seat " +
                o.number +
                ((o.badges || []).length
                  ? ", " +
                    o.badges
                      .map((b) => geometry.BADGES[b])
                      .filter(Boolean)
                      .join(", ")
                  : "")
              : o.type + " " + (o.label || "");
          if (o.id === selected && o.type !== "row")
            shape +=
              '<rect class="selection" x="' +
              (-w / 2 - 4) +
              '" y="' +
              (o.type === "window" || o.type === "door" ? -8 : -h / 2 - 4) +
              '" width="' +
              (w + 8) +
              '" height="' +
              (o.type === "door" ? w + 16 : o.type === "window" ? 16 : h + 8) +
              '" rx="7"/>';

          if (
            o.id === selected &&
            ["table", "window", "door"].includes(o.type)
          ) {
            const scale = svg.getScreenCTM()?.a || 1;
            for (const handle of o.type === "table"
              ? ["nw", "ne", "sw", "se"]
              : ["w", "e"]) {
              const sx = handle.includes("w") ? -1 : 1;
              const sy = handle.includes("n")
                ? -1
                : handle.includes("s")
                  ? 1
                  : 0;
              shape +=
                '<g data-resize="' +
                handle +
                '" role="button" tabindex="0" aria-label="Resize ' +
                esc(label.trim()) +
                " " +
                handle +
                '" transform="translate(' +
                (sx * w) / 2 +
                " " +
                (sy * h) / 2 +
                ')"><circle class="editor-resize-hit" r="' +
                22 / scale +
                '"/><g transform="scale(' +
                sx / scale +
                " " +
                (sy || 1) / scale +
                ')">' +
                (o.type === "table"
                  ? '<path class="editor-resize-grip-halo" d="M-12 4H-2Q4 4 4 -2V-12"/><path class="editor-resize-grip" d="M-12 4H-2Q4 4 4 -2V-12"/>'
                  : '<path class="editor-resize-grip-halo" d="M-3 -9Q6 -9 6 0Q6 9 -3 9"/><path class="editor-resize-grip" d="M-3 -9Q6 -9 6 0Q6 9 -3 9"/>') +
                "</g></g>";
            }
          }
          return (
            '<g class="editor-item' +
            (o.active === false ? " editor-inactive" : "") +
            '" data-item="' +
            esc(o.id) +
            '" role="button" tabindex="0" aria-label="' +
            esc(label) +
            '" aria-pressed="' +
            (o.id === selected) +
            '" transform="translate(' +
            o.x +
            " " +
            o.y +
            ") rotate(" +
            o.angle +
            ')">' +
            shape +
            "</g>"
          );
        })
        .join("");
      const count = (type) => objects.filter((o) => o.type === type).length;
      document.getElementById("editor-counts").textContent =
        count("table") +
        " tables · " +
        count("seat") +
        " seats · " +
        count("window") +
        " windows · " +
        count("door") +
        " doors";
      document.getElementById("delete-layout").disabled = !objects.length;
      document.getElementById("editor-undo").disabled = !undo.length;
      document.getElementById("editor-redo").disabled = !redo.length;
      document.getElementById("editor-save-state").textContent =
        JSON.stringify(objects) === saved ? "Saved" : "Unsaved changes";
      if (refreshProperties) properties();
      else {
        const row = objects.find((o) => o.id === selected && o.type === "row");
        const countLabel = document.querySelector('label[for="prop-count"]');
        if (row && countLabel)
          countLabel.textContent = row.sweep
            ? "Seats in first row"
            : "Seats per row";
      }
    }
    function properties() {
      const o = objects.find((o) => o.id === selected),
        panel = document.getElementById("editor-properties");
      if (!o) {
        panel.innerHTML = '<p class="t-muted">Select an item to edit it.</p>';
        return;
      }
      const field = (name, label, value, min = 0, max = 760) =>
        '<div class="field"><label class="field__label" for="prop-' +
        name +
        '">' +
        label +
        '</label><input class="input" id="prop-' +
        name +
        '" name="' +
        name +
        '" type="number" step="any" value="' +
        value +
        '" min="' +
        min +
        '" max="' +
        max +
        '" required></div>';
      panel.innerHTML =
        '<form class="editor-properties-form" id="item-properties"><p class="t-small t-muted">' +
        o.type[0].toUpperCase() +
        o.type.slice(1) +
        "</p>" +
        (o.type === "seat"
          ? '<div class="field"><label class="field__label" for="prop-number">Seat number</label><input class="input" id="prop-number" type="number" value="' +
            o.number +
            '" readonly aria-describedby="seat-number-hint"></div>'
          : o.type === "table"
            ? '<div class="field"><label class="field__label" for="prop-label">Table label</label><input class="input" id="prop-label" name="label" maxlength="12" value="' +
              esc(o.label || "") +
              '"></div>'
            : "") +
        (o.type === "table"
          ? '<div class="field"><label class="field__label" for="prop-shape">Table shape</label><select class="input" id="prop-shape" name="shape">' +
            [
              ["rectangle", "Rectangle"],
              ["round", "Round"],
              ["l", "L shape"],
              ["curved", "Curved"],
            ]
              .map(
                ([v, label]) =>
                  '<option value="' +
                  v +
                  '"' +
                  ((o.shape || "rectangle") === v ? " selected" : "") +
                  ">" +
                  label +
                  "</option>",
              )
              .join("") +
            "</select></div>"
          : "") +
        (o.type === "table" && o.shape === "curved"
          ? '<div class="field"><label class="field__label" for="prop-curvature">Curvature <span id="prop-curvature-value">' +
            (o.curvature ?? 60) +
            '%</span></label><input id="prop-curvature" name="curvature" type="range" min="0" max="100" step="5" value="' +
            (o.curvature ?? 60) +
            '"></div>'
          : "") +
        (o.type === "row"
          ? field(
              "count",
              o.sweep ? "Seats in first row" : "Seats per row",
              o.count,
              1,
              12,
            ) +
            field("rows", "Number of rows", o.rows, 1, 6) +
            field("sweep", "Curve angle (0 = straight)", o.sweep, 0, 180) +
            field("radius", "Curve radius", o.radius, 60, 600)
          : "") +
        (o.type === "table"
          ? '<button class="btn btn--secondary" type="submit" aria-keyshortcuts="Control+Enter" title="Apply changes (Ctrl Enter)">Apply changes</button>'
          : "") +
        "</form>" +
        (["seat", "table"].includes(o.type)
          ? '<div class="editor-seat-features"><h3 class="t-label">Features</h3><div class="editor-toolbar">' +
            Object.entries(geometry.BADGES)
              .map(
                ([badge, title]) =>
                  '<button type="button" class="btn btn--secondary" data-seat-badge="' +
                  badge +
                  '" aria-pressed="' +
                  String((o.badges || []).includes(badge)) +
                  '">' +
                  badgeIcon(badge) +
                  title +
                  "</button>",
              )
              .join("") +
            "</div>" +
            (o.type === "table"
              ? '<p class="t-small t-muted">Applies to every seat at this table. New seats inherit table features.</p>'
              : "") +
            "</div>"
          : "") +
        (o.type === "seat"
          ? '<p class="t-small t-muted" id="seat-number-hint">Assigned automatically: clockwise around tables and row by row in auditorium seating.</p>'
          : o.type === "row"
            ? '<p class="t-small t-muted">Changes update live. Curved outer rows fit more seats at consistent spacing; straight rows keep equal counts. Set 0° for straight rows or up to 180° for a half-circle. Click the row label or drag its guide to move the whole group.</p>'
            : '<p class="t-small t-muted">Drag the curved grips to snap between preset sizes.</p>') +
        (o.type === "table"
          ? '<p class="t-small t-muted">' +
            geometry.slots(o).length +
            " seat positions at this size</p>"
          : "") +
        '<div class="page-header__actions">' +
        (["table", "row"].includes(o.type)
          ? '<button class="btn btn--quiet" id="rotate-item" aria-keyshortcuts="R" title="Rotate (R)">Rotate 90°</button>'
          : "") +
        '<button class="btn btn--quiet is-risky" id="delete-item" aria-keyshortcuts="Delete" title="Remove item (Delete)">Remove item</button></div>';
    }
    function point(event) {
      const p = svg.createSVGPoint();
      p.x = event.clientX;
      p.y = event.clientY;
      return p.matrixTransform(svg.getScreenCTM().inverse());
    }
    function add(x, y) {
      try {
        const next = geometry.place(
          room,
          objects,
          tool,
          x,
          y,
          crypto.randomUUID(),
        );
        selected =
          tool === "row"
            ? next.find(
                (o) =>
                  o.type === "row" && !objects.some((old) => old.id === o.id),
              ).id
            : next.at(-1).id;
        change(next);
        const created = selected,
          addedTool = tool;
        if (addedTool === "row") {
          setTool("select");
          selected = created;
          render();
        }
        message(addedTool[0].toUpperCase() + addedTool.slice(1) + " added.");
      } catch (error) {
        message(error.message);
      }
    }

    function setTool(next) {
      tool = next;
      selected = null;
      document
        .querySelectorAll("[data-tool]")
        .forEach((el) =>
          el.setAttribute("aria-pressed", String(el.dataset.tool === tool)),
        );
      document.getElementById("editor-center").hidden =
        tool === "select" || !!geometry.BADGES[tool];
      const isBadge = !!geometry.BADGES[tool];
      document.getElementById("badge-tools").hidden = !isBadge;
      document
        .getElementById("badge-menu")
        .setAttribute("aria-pressed", String(isBadge));
      document
        .getElementById("badge-menu")
        .setAttribute("aria-expanded", String(isBadge));
      svg.style.cursor = tool === "select" ? "default" : "crosshair";
      document.getElementById("table-shapes").hidden = ![
        "table",
        "round",
        "l",
        "curved",
      ].includes(tool);
      document
        .getElementById("table-menu")
        .setAttribute(
          "aria-pressed",
          String(["table", "round", "l", "curved"].includes(tool)),
        );
      document
        .getElementById("table-menu")
        .setAttribute(
          "aria-expanded",
          String(["table", "round", "l"].includes(tool)),
        );
      render();
      message(
        tool === "select"
          ? "Select or drag an item. Middle-drag to pan."
          : geometry.BADGES[tool]
            ? "Click a seat or table to add or remove " +
              geometry.BADGES[tool].toLowerCase() +
              ". Esc returns to selection."
            : "Click the map to place " +
              (tool === "row" ? "seat rows" : tool) +
              ". Esc returns to selection.",
      );
    }

    document
      .getElementById("badge-menu")
      .addEventListener("click", () =>
        setTool(geometry.BADGES[tool] ? "select" : "outlet"),
      );
    document.getElementById("table-menu").addEventListener("click", () => {
      if (["table", "round", "l"].includes(tool)) setTool("select");
      else setTool("table");
    });
    document
      .querySelectorAll("[data-tool]")
      .forEach((button) =>
        button.addEventListener("click", () => setTool(button.dataset.tool)),
      );
    const shortcuts = {
      v: "select",
      t: "table",
      s: "seat",
      w: "window",
      d: "door",
      o: "round",
      l: "l",
      a: "row",
      p: "outlet",
      e: "monitor",
      q: "quiet",
      u: "curved",
    };
    document.querySelectorAll("[data-tool]").forEach((el) => {
      const key = Object.keys(shortcuts).find(
        (k) => shortcuts[k] === el.dataset.tool,
      );
      el.setAttribute("aria-keyshortcuts", key.toUpperCase());
      el.title = el.textContent.trim() + " (" + key.toUpperCase() + ")";
    });
    document.addEventListener("keydown", (event) => {
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (drag?.before) objects = drag.before;
        drag = null;
        setTool("select");
        svg.focus();
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === "Enter" &&
        selected
      ) {
        event.preventDefault();
        document.getElementById("item-properties")?.requestSubmit();
        return;
      }
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        const id =
          key === "z"
            ? event.shiftKey
              ? "editor-redo"
              : "editor-undo"
            : key === "y"
              ? "editor-redo"
              : key === "s"
                ? "save-layout"
                : event.key === "Delete" && event.shiftKey
                  ? "delete-layout"
                  : null;
        if (id) {
          event.preventDefault();
          document.getElementById(id).click();
        }
        return;
      }
      if (event.target.closest("input,select,textarea,[contenteditable=true]"))
        return;
      if (event.altKey) return;
      if (event.code === "Space" && drag?.kind === "item") {
        event.preventDefault();
        if (event.repeat) return;
        try {
          const item = objects.find((o) => o.id === selected);
          objects = geometry.update(room, objects, selected, {
            angle: (item.angle + 90) % 360,
          });
          const rotated = objects.find((o) => o.id === selected);
          // Continue from the rotated position without changing the drag's undo snapshot.
          drag.moveBase = geometry.clone(objects);
          drag.x = rotated.x;
          drag.y = rotated.y;
          drag.start = drag.last || drag.start;
          render();
          message("Rotated 90°. Keep dragging to place the item.");
        } catch (error) {
          message(error.message);
        }
        return;
      }
      if (key === "b") {
        event.preventDefault();
        document.getElementById("badge-menu").click();
        svg.focus();
      } else if (shortcuts[key]) {
        event.preventDefault();
        setTool(shortcuts[key]);
        svg.focus();
      } else if (key === "f") {
        event.preventDefault();
        document.getElementById("editor-fit").click();
      } else if (key === "c" && tool !== "select" && !geometry.BADGES[tool]) {
        event.preventDefault();
        document.getElementById("editor-center").click();
      } else if (key === "m") {
        event.preventDefault();
        document.querySelector("[data-theme-toggle]").click();
      } else if (key === "r" && selected) {
        event.preventDefault();
        document.getElementById("rotate-item")?.click();
      } else if (["+", "=", "-"].includes(key)) {
        event.preventDefault();
        document
          .getElementById(key === "-" ? "editor-zoom-out" : "editor-zoom-in")
          .click();
      } else if (
        ["Delete", "Backspace"].includes(event.key) &&
        selected &&
        !svg.contains(event.target)
      ) {
        event.preventDefault();
        change(geometry.remove(objects, selected));
        selected = null;
        render();
      }
    });

    for (const [id, key] of Object.entries({
      "save-layout": "Control+s",
      "editor-undo": "Control+z",
      "editor-redo": "Control+Shift+z",
      "delete-layout": "Control+Shift+Delete",
      "editor-center": "C",
      "editor-fit": "F",
      "editor-zoom-in": "+",
      "editor-zoom-out": "-",
    })) {
      const el = document.getElementById(id);
      el.setAttribute("aria-keyshortcuts", key);
      el.title = el.textContent.trim() + " (" + key + ")";
    }
    svg.addEventListener("auxclick", (event) => {
      if (event.button === 1) event.preventDefault();
    });
    document
      .getElementById("editor-center")
      .addEventListener("click", () => add(room.width / 2, room.height / 2));
    svg.addEventListener("pointerdown", (event) => {
      if (![0, 1].includes(event.button)) return;
      event.preventDefault();
      const p = point(event),
        item = event.target.closest("[data-item]");
      svg.setPointerCapture(event.pointerId);
      if (
        event.button === 1 ||
        (tool === "select" && !item && event.pointerType === "touch")
      ) {
        drag = {
          kind: "pan",
          x: event.clientX,
          y: event.clientY,
          view: { ...view },
          matrix: svg.getScreenCTM().a,
        };
        return;
      }

      if (geometry.BADGES[tool]) {
        applyBadge(item?.dataset.item, tool);
        return;
      }
      const handle = event.target.closest("[data-resize]");
      if (handle && item) {
        selected = item.dataset.item;
        drag = {
          kind: "resize",
          handle: handle.dataset.resize,
          before: geometry.clone(objects),
        };
        return;
      }
      if (tool !== "select" && !handle) {
        add(p.x, p.y);
        return;
      }
      if (item) {
        selected = item.dataset.item;
        const o = objects.find((o) => o.id === selected);
        drag = {
          kind: "item",
          start: p,
          x: o.x,
          y: o.y,
          before: geometry.clone(objects),
        };
        render();
        return;
      }
      if (tool === "select") {
        selected = null;
        render();
      } else add(p.x, p.y);
    });
    svg.addEventListener("pointermove", (event) => {
      if (!drag) return;
      if (drag.kind === "pan") {
        view = {
          x: drag.view.x - (event.clientX - drag.x) / drag.matrix,
          y: drag.view.y - (event.clientY - drag.y) / drag.matrix,
        };
        renderView();
        return;
      }

      const p = point(event);
      if (drag.kind === "resize") {
        try {
          objects = geometry.resize(
            room,
            drag.before,
            selected,
            drag.handle,
            p.x,
            p.y,
          );

          const item = objects.find((o) => o.id === selected);
          message(
            item.type === "table"
              ? "Table resized · " +
                  objects.filter(
                    (o) => o.type === "seat" && o.tableId === item.id,
                  ).length +
                  " seats. Seat numbers updated."
              : item.type[0].toUpperCase() +
                  item.type.slice(1) +
                  " resized to a preset length.",
          );
          render();
        } catch (error) {
          message(error.message);
        }
        return;
      }
      drag.last = p;
      objects = geometry.move(
        room,
        drag.moveBase || drag.before,
        selected,
        drag.x + p.x - drag.start.x,
        drag.y + p.y - drag.start.y,
      );
      message(
        objects === (drag.moveBase || drag.before)
          ? "Move blocked: use a free table position and keep furniture inside the room."
          : "Furniture moved.",
      );
      render();
    });
    function endDrag(event) {
      if (!drag) return;
      if (drag.kind !== "pan") checkpoint(drag.before);
      drag = null;
      if (svg.hasPointerCapture(event.pointerId))
        svg.releasePointerCapture(event.pointerId);
    }
    svg.addEventListener("pointerup", endDrag);
    svg.addEventListener("pointercancel", endDrag);
    svg.addEventListener("keydown", (event) => {
      if (event.ctrlKey || event.metaKey) return;
      const item = event.target.closest("[data-item]");
      const handle = event.target.closest("[data-resize]");
      if (
        handle &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        try {
          change(
            geometry.resizeBy(
              room,
              objects,
              item.dataset.item,
              handle.dataset.resize,
              event.key === "ArrowLeft"
                ? -1
                : event.key === "ArrowRight"
                  ? 1
                  : 0,
              event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0,
            ),
          );
          message("Item resized.");
        } catch (error) {
          message(error.message);
        }
        return;
      }
      if (item && ["Enter", " "].includes(event.key)) {
        event.preventDefault();
        if (geometry.BADGES[tool]) applyBadge(item.dataset.item, tool);
        else {
          selected = item.dataset.item;
          render();
        }
        return;
      }
      if (["Delete", "Backspace"].includes(event.key) && selected) {
        event.preventDefault();
        change(geometry.remove(objects, selected));
        selected = null;
        render();
      }
      if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
          event.key,
        ) &&
        selected
      ) {
        event.preventDefault();
        const o = objects.find((o) => o.id === selected);
        const step = o.type === "seat" ? geometry.SEAT_PITCH : 4;
        change(
          geometry.move(
            room,
            objects,
            selected,
            o.x +
              (event.key === "ArrowLeft"
                ? -step
                : event.key === "ArrowRight"
                  ? step
                  : 0),
            o.y +
              (event.key === "ArrowUp"
                ? -step
                : event.key === "ArrowDown"
                  ? step
                  : 0),
          ),
        );
      }
    });

    let liveBaseline = null,
      liveRecorded = false;
    const propertyPanel = document.getElementById("editor-properties");
    propertyPanel.addEventListener("focusin", (event) => {
      if (
        event.target.matches("input") &&
        (objects.find((o) => o.id === selected)?.type === "row" ||
          event.target.id === "prop-curvature")
      ) {
        liveBaseline = geometry.clone(objects);
        liveRecorded = false;
      }
    });
    propertyPanel.addEventListener("input", (event) => {
      const row = objects.find((o) => o.id === selected);
      if (
        (row?.type !== "row" && event.target.id !== "prop-curvature") ||
        !event.target.matches("input")
      )
        return;
      const form = event.target.closest("form");
      if (!form.checkValidity()) {
        message("Enter a valid row size. The last valid layout is kept.");
        return;
      }
      const patch =
        event.target.id === "prop-curvature"
          ? { curvature: Number(event.target.value) }
          : Object.fromEntries(new FormData(form));
      for (const key of ["count", "rows", "sweep", "radius"])
        if (key in patch) patch[key] = Number(patch[key]);
      try {
        const next = geometry.update(room, objects, selected, patch);
        if (JSON.stringify(next) === JSON.stringify(objects)) return;
        if (!liveRecorded) {
          undo.push(liveBaseline || geometry.clone(objects));
          redo = [];
          liveRecorded = true;
        }
        objects = next;
        render(false);
        const curvatureLabel = document.getElementById("prop-curvature-value");
        if (curvatureLabel)
          curvatureLabel.textContent =
            objects.find((o) => o.id === selected).curvature + "%";
        message(
          row.type === "table"
            ? "Table curvature updated live. Seat positions updated."
            : "Seat rows updated live.",
        );
      } catch (error) {
        message("Row change blocked: " + error.message);
      }
    });
    document
      .getElementById("editor-properties")
      .addEventListener("submit", (event) => {
        event.preventDefault();
        try {
          const patch = Object.fromEntries(new FormData(event.target));
          for (const key of [
            "number",
            "x",
            "y",
            "width",
            "height",
            "count",
            "rows",
            "sweep",
            "radius",
            "curvature",
          ])
            if (key in patch) patch[key] = Number(patch[key]);
          change(geometry.update(room, objects, selected, patch));
          message("Item updated.");
        } catch (error) {
          message(error.message);
        }
      });
    document
      .getElementById("editor-properties")
      .addEventListener("click", (event) => {
        const badgeButton = event.target.closest("[data-seat-badge]");
        if (badgeButton) applyBadge(selected, badgeButton.dataset.seatBadge);
        if (event.target.id === "delete-item") {
          const id = selected;
          selected = null;
          change(geometry.remove(objects, id));
          message(
            "Item and any attached seats removed. Undo can restore them.",
          );
        }
        if (event.target.id === "rotate-item") {
          try {
            const o = objects.find((o) => o.id === selected);
            change(
              geometry.update(room, objects, selected, {
                angle: (o.angle + 90) % 360,
              }),
            );
          } catch (error) {
            message(error.message);
          }
        }
      });

    document
      .getElementById("confirm-delete-layout")
      .addEventListener("click", () => {
        document.getElementById("delete-layout-confirm").close("confirm");
        selected = null;
        drag = null;
        change([]);
        message(
          "Whole layout deleted. Undo restores it. Save layout to keep the room empty.",
        );
      });
    document.getElementById("editor-undo").addEventListener("click", () => {
      if (!undo.length) return;
      redo.push(geometry.clone(objects));
      objects = undo.pop();
      selected = null;
      render();
      message("Last change undone.");
    });
    document.getElementById("editor-redo").addEventListener("click", () => {
      if (!redo.length) return;
      undo.push(geometry.clone(objects));
      objects = redo.pop();
      selected = null;
      render();
      message("Last change reapplied.");
    });
    function zoomBy(factor, event) {
      const anchor = event ? point(event) : null;
      const next = Math.max(0.5, Math.min(4, zoom * factor)),
        cx = view.x + room.width / zoom / 2,
        cy = view.y + room.height / zoom / 2;
      zoom = next;
      view = { x: cx - room.width / zoom / 2, y: cy - room.height / zoom / 2 };
      renderView();
      if (anchor) {
        const after = point(event);
        view.x += anchor.x - after.x;
        view.y += anchor.y - after.y;
        renderView();
      }
    }
    svg.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        if (drag || !event.deltaY) return;
        const unit =
          event.deltaMode === 1
            ? 16
            : event.deltaMode === 2
              ? svg.clientHeight
              : 1;
        const delta = Math.max(-1000, Math.min(1000, event.deltaY * unit));
        zoomBy(Math.exp(-delta * 0.002), event);
      },
      { passive: false },
    );
    document
      .getElementById("editor-zoom-in")
      .addEventListener("click", () => zoomBy(1.25));
    document
      .getElementById("editor-zoom-out")
      .addEventListener("click", () => zoomBy(0.8));
    document.getElementById("editor-fit").addEventListener("click", () => {
      zoom = 1;
      view = { x: 0, y: 0 };
      renderView();
    });
    function saveLayout() {
      try {
        objects = geometry.renumber(objects);
        const latest = storage ? api.load(storage) : state,
          next = api.saveLayout(latest, spaceId, objects);
        if (!storage || !api.save(storage, next))
          throw Error("Enable browser storage to save the layout.");
        state = next;
        saved = JSON.stringify(objects);
        render();
        message(
          "Layout saved. The Spaces list now shows " +
            objects.filter((o) => o.type === "seat").length +
            " seats.",
        );
        return true;
      } catch (error) {
        message(error.message);
        const errorNotice = document.getElementById("unsaved-layout-error");
        errorNotice.textContent = error.message;
        errorNotice.hidden = false;
        return false;
      }
    }
    document
      .getElementById("save-layout")
      .addEventListener("click", saveLayout);
    const leaveDialog = document.getElementById("unsaved-layout-confirm");
    let pendingDestination = null,
      allowLeaving = false;
    const hasUnsavedChanges = () => JSON.stringify(objects) !== saved;
    window.addEventListener("beforeunload", (event) => {
      if (!allowLeaving && hasUnsavedChanges()) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
    document.addEventListener("click", (event) => {
      const link = event.target.closest("a[href]");
      if (
        !link ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        link.target === "_blank" ||
        link.hasAttribute("download") ||
        !hasUnsavedChanges()
      )
        return;
      const destination = new URL(link.href, location.href);
      if (
        destination.origin === location.origin &&
        destination.pathname === location.pathname &&
        destination.search === location.search &&
        destination.hash
      )
        return;
      event.preventDefault();
      pendingDestination = destination.href;
      document.getElementById("unsaved-layout-error").hidden = true;
      leaveDialog.showModal();
    });
    leaveDialog.addEventListener("close", () => {
      pendingDestination = null;
    });
    const leave = () => {
      const destination = pendingDestination;
      if (!destination) return;
      allowLeaving = true;
      leaveDialog.close("leave");
      location.href = destination;
    };
    document
      .getElementById("discard-layout-leave")
      .addEventListener("click", leave);
    document
      .getElementById("save-layout-leave")
      .addEventListener("click", () => {
        if (saveLayout()) leave();
      });
    renderView();
    render();
    if (new URLSearchParams(location.search).has("created"))
      message("Space created. Its room outline is ready for furniture.");
  });
})();
