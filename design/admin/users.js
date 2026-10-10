/* Functional Users mockup. No network requests or backend mutations. */
(() => {
  "use strict";
  const api = window.AdminUsersData;
  let state = api.seed(),
    storage;
  try {
    storage = window.localStorage;
    state = api.load(storage);
  } catch {}
  let query = "",
    filter = "all",
    sort = "name",
    expanded = false;
  const userId = document.body.dataset.userId;
  const main = document.querySelector("main .page");
  const esc = (value) =>
    String(value ?? "").replace(
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
  const time = (minutes) =>
    Math.floor(minutes / 60) +
    "h " +
    String(minutes % 60).padStart(2, "0") +
    "m";
  const current = (user) => user.records.find(api.live);
  const minutes = (user) =>
    user.records.reduce((n, r) => n + r.studyMinutes, 0);
  const labels = {
    occupied: "Checked in",
    reserved: "Awaiting check-in",
    break: "On break",
    completed: "Completed",
    missed: "Missed check-in",
    cancelled: "Cancelled",
    ended: "Ended by admin",
  };
  const chip = (record) =>
    '<span class="chip ' +
    (api.live(record) ? "is-" + record.status : "chip--plain user-status") +
    '">' +
    esc(labels[record.status] || record.status) +
    "</span>";
  const note =
    '<p class="t-small t-muted mock-note"><i class="icon i-info" aria-hidden="true"></i> Interactive demo · sample data, saved in this browser. Demo time: 10 Oct 2026, 10:42.</p>';
  const stat = (label, value, detail) =>
    '<div class="stat"><span class="t-label">' +
    label +
    '</span><span class="stat__value">' +
    esc(value) +
    '</span><span class="t-small t-muted">' +
    esc(detail) +
    "</span></div>";
  const dialog = (id, title, body, footer) =>
    '<dialog class="dialog" id="' +
    id +
    '" aria-labelledby="' +
    id +
    '-title"><div class="dialog__head"><h2 class="dialog__title" id="' +
    id +
    '-title">' +
    title +
    '</h2><button class="icon-button" type="button" data-sheet-close aria-label="Close"><i class="icon i-close"></i></button></div><div class="dialog__body">' +
    body +
    '</div><div class="dialog__foot">' +
    (footer ||
      '<button class="btn btn--secondary" type="button" data-sheet-close>Close</button>') +
    "</div></dialog>";
  const banner =
    '<div class="banner-region"><div class="banner" id="users-banner" role="status" hidden><i class="icon i-check"></i><div class="banner__text"><span class="banner__title"></span><span class="t-small t-muted"></span></div><button class="icon-button" type="button" data-banner-close aria-label="Dismiss"><i class="icon i-close"></i></button></div></div>';
  function notify(title, detail = "") {
    const el = document.getElementById("users-banner");
    el.querySelector(".banner__title").textContent = title;
    el.querySelector(".t-small").textContent = detail;
    el.hidden = false;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => (el.hidden = true), 6000);
  }
  function persist() {
    return storage && api.save(storage, state);
  }
  function extras(html) {
    document
      .querySelectorAll("body > dialog, body > .banner-region")
      .forEach((el) => el.remove());
    document.body.insertAdjacentHTML("beforeend", html + banner);
  }
  function directory() {
    const records = state.users.flatMap((u) => u.records);
    main.innerHTML =
      '<header class="page-header"><div class="page-header__text"><h1 class="t-heading">Users</h1><p class="t-muted">People, reservations and time spent studying.</p></div><div class="page-header__actions"><button class="btn btn--secondary" data-user-action="refresh">Refresh</button><button class="btn btn--quiet" data-sheet-open="users-reset">Reset demo data</button></div></header><p class="t-small t-muted">Last 30 days · 11 Sep–10 Oct 2026</p><section class="stats" aria-label="User summary">' +
      stat("Users", state.users.length, "Student accounts") +
      stat(
        "Current bookings",
        records.filter(api.live).length,
        "Reserved, checked in or on break",
      ) +
      stat(
        "Reservations",
        records.length,
        records.filter((r) => r.status === "completed" || r.status === "ended")
          .length + " completed or ended",
      ) +
      stat(
        "Study time",
        time(state.users.reduce((n, u) => n + minutes(u), 0)),
        "Checked-in time, excluding breaks",
      ) +
      '</section><div class="toolbar users-toolbar"><label class="search"><i class="icon i-search"></i><span class="sr-only">Search users</span><input type="search" id="users-search" placeholder="Name, email, department or ID"></label><label class="field"><span class="field__label">Booking status</span><span class="select"><select id="users-filter" aria-label="Booking status"><option value="all">All users</option><option value="occupied">Checked in</option><option value="reserved">Awaiting check-in</option><option value="break">On break</option><option value="none">No current booking</option></select></span></label><label class="field"><span class="field__label">Sort by</span><span class="select"><select id="users-sort" aria-label="Sort by"><option value="name">Name A–Z</option><option value="hours">Most study time</option><option value="reservations">Most reservations</option></select></span></label></div><p class="t-small t-muted" id="users-count" role="status"></p><div class="table-wrap"><table class="table users-table"><caption class="sr-only">Users and activity in the last 30 days</caption><thead><tr><th scope="col">User</th><th scope="col">Current booking</th><th scope="col" class="num">Reservations</th><th scope="col" class="num">Study time</th><th scope="col" class="num">Missed check-ins</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody id="users-rows"></tbody></table></div>' +
      note;
    main.querySelector("#users-search").value = query;
    main.querySelector("#users-filter").value = filter;
    main.querySelector("#users-sort").value = sort;
    rows();
    extras(
      dialog(
        "users-reset",
        "Reset demo data?",
        "<p>Restores the original sample users and reservations. Your local profile edits and ended bookings will be discarded.</p>",
        '<button class="btn btn--secondary" data-sheet-close>Keep changes</button><button class="btn btn--danger" data-user-action="reset">Reset demo data</button>',
      ),
    );
  }
  function rows() {
    const matches = state.users.filter(
      (u) =>
        [u.name, u.email, u.department, u.studentId]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase().trim()) &&
        (filter === "all" || (current(u)?.status || "none") === filter),
    );
    matches.sort((a, b) =>
      sort === "hours"
        ? minutes(b) - minutes(a)
        : sort === "reservations"
          ? b.records.length - a.records.length
          : a.name.localeCompare(b.name),
    );
    document.getElementById("users-count").textContent =
      matches.length + " of " + state.users.length + " users";
    document.getElementById("users-rows").innerHTML = matches.length
      ? matches
          .map((u) => {
            const r = current(u),
              url = "09-user-" + encodeURIComponent(u.id) + ".html";
            const initials = u.name
              .trim()
              .split(/\s+/)
              .slice(0, 2)
              .map((n) => n[0])
              .join("")
              .toUpperCase();
            return (
              '<tr><td><div class="user-identity"><span class="avatar" aria-hidden="true">' +
              esc(initials) +
              '</span><div class="table__name"><a class="table__link" href="' +
              url +
              '">' +
              esc(u.name) +
              '</a><span class="t-small t-muted">' +
              esc(u.department) +
              " · " +
              esc(u.studentId) +
              '</span></div></div></td><td><div class="cell-stack">' +
              (r
                ? chip(r) +
                  '<span class="t-small t-muted">' +
                  esc(r.room) +
                  " · Seat " +
                  r.seat +
                  "</span>"
                : '<span class="t-small t-muted">No current booking</span>') +
              '</div></td><td class="num">' +
              u.records.length +
              '</td><td class="num">' +
              time(minutes(u)) +
              '</td><td class="num">' +
              u.records.filter((r) => r.status === "missed").length +
              '</td><td class="actions"><a class="btn btn--quiet" aria-label="Manage ' +
              esc(u.name) +
              '" href="' +
              url +
              '">Manage <i class="icon i-chevron-right"></i></a></td></tr>'
            );
          })
          .join("")
      : '<tr><td colspan="6"><div class="empty"><strong>No users match these filters.</strong><button class="btn btn--secondary" data-user-action="clear">Clear filters</button></div></td></tr>';
  }
  function profile() {
    const u = state.users.find((u) => u.id === userId);
    if (!u) {
      main.innerHTML =
        '<h1 class="t-heading">User not found</h1><a href="08-users.html">Back to users</a>';
      return;
    }
    const r = current(u),
      initials = u.name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((n) => n[0])
        .join("")
        .toUpperCase();
    const weekly = Array.from({ length: 7 }, (_, i) =>
      u.records
        .filter((r) => r.date === "2026-10-" + String(i + 4).padStart(2, "0"))
        .reduce((sum, r) => sum + r.studyMinutes, 0),
    );
    const history = expanded ? u.records : u.records.slice(0, 6);
    const currentCard = r
      ? '<div class="user-section-head"><h2 class="t-title">Current reservation</h2>' +
        chip(r) +
        '</div><div class="booking-summary"><div><strong>' +
        esc(r.room) +
        " · Seat " +
        r.seat +
        '</strong><p class="t-small t-muted">10 Oct · ' +
        r.start +
        "–" +
        r.end +
        '</p></div><button class="btn btn--secondary" data-user-action="space" data-record="' +
        esc(r.id) +
        '">View space</button></div><dl class="user-facts"><div><dt>' +
        (r.checkedIn ? "Checked in" : "Check-in deadline") +
        "</dt><dd>" +
        (r.checkedIn || r.deadline) +
        "</dd></div><div><dt>Study time so far</dt><dd>" +
        time(r.studyMinutes) +
        "</dd></div><div><dt>Reservation ID</dt><dd>" +
        esc(r.id) +
        '</dd></div></dl><div class="user-card-foot"><p class="t-small t-muted">Ending this booking releases the seat.</p><button class="btn btn--quiet is-risky" data-user-action="end" data-record="' +
        esc(r.id) +
        '">End reservation</button></div>'
      : '<h2 class="t-title">Current reservation</h2><p class="t-muted">No current reservation or study session.</p><a class="btn btn--secondary" href="01-spaces.html">Browse spaces</a>';
    main.innerHTML =
      '<a class="crumbs" href="08-users.html"><i class="icon i-back"></i> All users</a><header class="page-header"><div class="user-identity"><span class="avatar avatar--lg" aria-hidden="true">' +
      esc(initials) +
      '</span><div class="page-header__text"><h1 class="t-heading">' +
      esc(u.name) +
      '</h1><p class="t-muted">' +
      esc(u.department) +
      " · " +
      esc(u.studentId) +
      '</p><p class="t-small t-muted">' +
      esc(u.email) +
      '</p></div></div><button class="btn btn--primary" data-user-action="edit">Manage profile</button></header><section class="stats" aria-label="User activity in the last 30 days">' +
      stat(
        "Study time · 30 days",
        time(minutes(u)),
        "Checked-in time, excluding breaks",
      ) +
      stat(
        "Reservations · 30 days",
        u.records.length,
        u.records.filter(
          (r) => r.status === "completed" || r.status === "ended",
        ).length + " completed or ended",
      ) +
      stat(
        "Missed check-ins · 30 days",
        u.records.filter((r) => r.status === "missed").length,
        "Arrival window expired",
      ) +
      stat(
        "Favourite space",
        favourite(u),
        "Most studied in the last 30 days",
      ) +
      '</section><div class="user-detail-grid"><section class="user-card">' +
      currentCard +
      '</section><section class="user-card"><div class="user-section-head"><h2 class="t-title">Study activity</h2><span class="t-small t-muted">4–10 Oct</span></div><div><strong class="stat__value">' +
      time(weekly.reduce((a, b) => a + b, 0)) +
      '</strong><p class="t-small t-muted">Checked-in study time this week</p></div><figure class="activity-chart"><div class="activity-bars">' +
      weekly
        .map(
          (v, i) =>
            '<div class="activity-day"><span class="t-small">' +
            (v
              ? Math.floor(v / 60) + ":" + String(v % 60).padStart(2, "0")
              : "—") +
            '</span><div class="activity-track" aria-hidden="true"><span class="activity-bar" style="--activity-height:' +
            Math.round((v / Math.max(1, ...weekly)) * 100) +
            '%"></span></div><span class="t-small t-muted">' +
            ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][i] +
            "</span></div>",
        )
        .join("") +
      '</div><figcaption class="t-small t-muted">Daily hours:minutes. Breaks are excluded.</figcaption></figure></section></div><section class="user-history"><div class="user-section-head"><h2 class="t-title">Reservation history</h2><span class="t-small t-muted">' +
      history.length +
      " of " +
      u.records.length +
      ' records · Europe/Zurich</span></div><div class="table-wrap"><table class="table"><caption class="sr-only">Reservation history for ' +
      esc(u.name) +
      '</caption><thead><tr><th scope="col">Date and time</th><th scope="col">Space / seat</th><th scope="col">Outcome</th><th scope="col" class="num">Study time</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>' +
      history
        .map(
          (record) =>
            '<tr><td><div class="table__name"><strong>' +
            esc(record.date) +
            '</strong><span class="t-small t-muted">' +
            record.start +
            "–" +
            record.end +
            "</span></div></td><td>" +
            esc(record.room) +
            " · Seat " +
            record.seat +
            "</td><td>" +
            chip(record) +
            '</td><td class="num">' +
            time(record.studyMinutes) +
            '</td><td class="actions"><button class="btn btn--quiet" data-user-action="details" data-record="' +
            esc(record.id) +
            '" aria-label="Details for ' +
            esc(record.id) +
            '">Details</button>' +
            (api.live(record)
              ? '<button class="btn btn--quiet is-risky" data-user-action="end" data-record="' +
                esc(record.id) +
                '">End</button>'
              : "") +
            "</td></tr>",
        )
        .join("") +
      '</tbody></table></div><button class="btn btn--secondary" data-user-action="history">' +
      (expanded
        ? "Show recent reservations"
        : "Show all " + u.records.length + " reservations") +
      "</button></section>" +
      note;
    document.title = u.name + " · Study Spaces Admin";
    extras("");
  }
  function favourite(u) {
    const totals = {};
    for (const r of u.records)
      totals[r.room] = (totals[r.room] || 0) + r.studyMinutes;
    return Object.keys(totals).sort((a, b) => totals[b] - totals[a])[0] || "—";
  }
  function open(html, id) {
    document.querySelectorAll("body > dialog").forEach((d) => d.remove());
    document.body.insertAdjacentHTML("beforeend", html);
    document.getElementById(id).showModal();
  }
  function render() {
    userId ? profile() : directory();
  }
  document.addEventListener("input", (event) => {
    if (event.target.id === "users-search") {
      query = event.target.value;
      rows();
    }
  });
  document.addEventListener("change", (event) => {
    if (event.target.id === "users-filter") {
      filter = event.target.value;
      rows();
    }
    if (event.target.id === "users-sort") {
      sort = event.target.value;
      rows();
    }
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-user-action]");
    if (!button) return;
    const action = button.dataset.userAction,
      u = state.users.find((u) => u.id === userId),
      r = u?.records.find((r) => r.id === button.dataset.record);
    if (action === "refresh") {
      if (storage) state = api.load(storage);
      render();
      notify("Refreshed", "Loaded the latest local sample data.");
    }
    if (action === "reset") {
      state = api.seed();
      const saved = persist();
      query = "";
      filter = "all";
      sort = "name";
      render();
      notify(
        "Demo data reset",
        saved
          ? "Original sample data restored."
          : "Storage is unavailable; changes last until this page closes.",
      );
    }
    if (action === "clear") {
      query = "";
      filter = "all";
      sort = "name";
      directory();
    }
    if (action === "history") {
      expanded = !expanded;
      profile();
    }
    if (action === "edit" && u) {
      open(
        '<dialog class="dialog" id="users-edit" aria-labelledby="users-edit-title"><form id="users-edit-form"><div class="dialog__head"><h2 class="dialog__title" id="users-edit-title">Manage ' +
          esc(u.name) +
          '</h2><button class="icon-button" type="button" data-sheet-close aria-label="Close"><i class="icon i-close"></i></button></div><div class="dialog__body">' +
          [
            ["name", "Display name", u.name, 80],
            ["email", "Email address", u.email, 254],
            ["department", "Department", u.department, 64],
          ]
            .map(
              ([key, label, value, max]) =>
                '<div class="field"><label class="field__label" for="edit-' +
                key +
                '">' +
                label +
                '</label><input class="input" id="edit-' +
                key +
                '" name="' +
                key +
                '" value="' +
                esc(value) +
                '" type="' +
                (key === "email" ? "email" : "text") +
                '" required maxlength="' +
                max +
                '"></div>',
            )
            .join("") +
          '<p class="t-small t-muted">Changes are saved to this browser’s sample data.</p><p id="profile-error" class="t-small user-form-error" role="alert" hidden></p></div><div class="dialog__foot"><button class="btn btn--secondary" type="button" data-sheet-close>Cancel</button><button class="btn btn--primary" type="submit">Save changes</button></div></form></dialog>',
        "users-edit",
      );
    }
    if (action === "end" && r)
      open(
        dialog(
          "users-end",
          "End this reservation?",
          "<p>" +
            esc(u.name) +
            " · " +
            esc(r.room) +
            " · Seat " +
            r.seat +
            "</p><p>The sample booking will end and the seat will be released. Its history and study time will be kept.</p>",
          '<button class="btn btn--secondary" data-sheet-close>Keep reservation</button><button class="btn btn--danger" data-user-action="confirm-end" data-record="' +
            esc(r.id) +
            '">End reservation</button>',
        ),
        "users-end",
      );
    if (action === "confirm-end" && r) {
      state = api.endReservation(state, u.id, r.id);
      const saved = persist();
      profile();
      notify(
        "Reservation ended",
        saved
          ? "The sample seat has been released."
          : "Storage is unavailable; changes last until this page closes.",
      );
    }
    if (action === "details" && r)
      open(
        dialog(
          "users-record",
          "Reservation details",
          "<p>" +
            esc(u.name) +
            " · " +
            esc(r.room) +
            " · Seat " +
            r.seat +
            "</p>" +
            chip(r) +
            '<dl class="user-facts user-facts--stack">' +
            [
              ["Reservation ID", r.id],
              ["Date", r.date],
              ["Reserved", r.start + "–" + r.end],
              ["Checked in", r.checkedIn || "Not checked in"],
              ["Ended", r.endedAt || "—"],
              [
                "Ended by",
                r.endedBy || (r.status === "completed" ? "student" : "—"),
              ],
              ["Break time", time(r.breakMinutes)],
              ["Study time", time(r.studyMinutes)],
            ]
              .map(
                ([label, value]) =>
                  "<div><dt>" +
                  label +
                  "</dt><dd>" +
                  esc(value) +
                  "</dd></div>",
              )
              .join("") +
            "</dl>",
        ),
        "users-record",
      );
    if (action === "space" && r)
      open(
        dialog(
          "users-space",
          esc(r.room),
          "<p>Seat " +
            r.seat +
            " · " +
            esc(u.name) +
            "</p>" +
            chip(r) +
            '<p class="t-small t-muted">Reservation: ' +
            r.start +
            "–" +
            r.end +
            ". Current sample booking.</p>",
          '<button class="btn btn--secondary" data-sheet-close>Close</button><a class="btn btn--primary" href="01-spaces.html">Browse spaces</a>',
        ),
        "users-space",
      );
  });
  document.addEventListener("submit", (event) => {
    if (event.target.id !== "users-edit-form") return;
    event.preventDefault();
    const form = event.target;
    try {
      state = api.updateProfile(
        state,
        userId,
        Object.fromEntries(new FormData(form)),
      );
      const saved = persist();
      profile();
      main.querySelector('[data-user-action="edit"]').focus();
      notify(
        "Profile updated",
        saved
          ? "Saved to this browser’s sample data."
          : "Storage is unavailable; changes last until this page closes.",
      );
    } catch (error) {
      const el = document.getElementById("profile-error");
      el.textContent = error.message;
      el.hidden = false;
    }
  });
  window.addEventListener("storage", (event) => {
    if (event.key === api.KEY && !document.querySelector("dialog[open]")) {
      state = api.load(storage);
      render();
    }
  });
  document.addEventListener("DOMContentLoaded", render);
})();
