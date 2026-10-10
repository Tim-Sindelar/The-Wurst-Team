/* Shared room identity and navigation across the original admin room tabs. */
(() => {
  "use strict";
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
    const api = window.AdminSpacesData;
    let state = api.seed();
    try {
      state = api.load(localStorage);
    } catch {}
    const id =
        new URLSearchParams(location.search).get("space") ||
        state.spaces[0]?.id,
      space = state.spaces.find((s) => s.id === id);
    if (!space) return;
    document.querySelectorAll("a[href]").forEach((link) => {
      const href = link.getAttribute("href");
      if (
        !/^0[3-7]-space-/.test(href) &&
        !(
          ["10-space-qr.html"].some((path) => href.startsWith(path)) &&
          link.closest(".subnav")
        )
      )
        return;
      const url = new URL(href, location.href);
      url.searchParams.set("space", space.id);
      link.setAttribute(
        "href",
        url.pathname.split("/").pop() + "?" + url.searchParams,
      );
    });
    const title = document.querySelector(".page-header h1");
    if (title) title.textContent = space.name;
    const sub = document.querySelector(".page-header__text > .t-muted");
    if (sub && !sub.id)
      sub.innerHTML =
        '<span class="chip is-free">Open</span> &nbsp;' +
        esc(space.timeZone) +
        " · Local sample data";
    if (!location.pathname.endsWith("03-space-seats.html") || space.sample)
      return;
    const values = document.querySelectorAll(".stats .stat__value");
    if (values.length >= 4) {
      values[0].textContent = space.active + " of " + space.seats;
      values[1].textContent = space.free;
      values[2].textContent = space.occupied;
      values[3].textContent = space.onBreak;
    }
    const layoutUrl =
      "06-space-layout.html?space=" + encodeURIComponent(space.id);
    const add = document.querySelector(
      '.page-header [data-sheet-open="dlg-add"]',
    );
    if (add)
      add.outerHTML =
        '<a class="btn btn--primary" href="' + layoutUrl + '">Add seat</a>';
    const tbody = document.querySelector(".table tbody");
    if (!tbody) return;
    const seats = (space.layout || [])
      .filter((o) => o.type === "seat")
      .sort((a, b) => a.number - b.number);
    const layout = "06-space-layout.html?space=" + encodeURIComponent(space.id);
    tbody.innerHTML = seats.length
      ? seats
          .map(
            (o) =>
              "<tr><td><strong>Seat " +
              o.number +
              '</strong></td><td><span class="chip is-' +
              esc(o.state || "free") +
              '">' +
              (o.active === false
                ? "Switched off"
                : o.state === "occupied"
                  ? "Occupied"
                  : o.state === "break"
                    ? "On break"
                    : o.state === "reserved"
                      ? "Reserved"
                      : o.state === "bookable"
                        ? "Bookable later"
                        : "Free") +
              '</span></td><td><span class="t-muted">No current user</span></td><td><span class="t-muted">—</span></td><td class="actions"><a class="btn btn--quiet" href="' +
              layout +
              '">Edit in layout</a></td></tr>',
          )
          .join("")
      : '<tr><td colspan="5"><div class="empty"><strong>No seats yet</strong><p class="t-muted">Add tables and seats in this room’s Layout tab.</p><a class="btn btn--primary" href="' +
        layout +
        '">Open layout editor</a></div></td></tr>';
  });
})();
