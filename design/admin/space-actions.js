(() => {
  "use strict";
  document.addEventListener("DOMContentLoaded", () => {
    const api = window.AdminSpacesData;
    const dialog = document.getElementById("dlg-delete-space");
    const error = document.getElementById("delete-space-error");
    const banner = document.getElementById("space-deleted-banner");
    let pending = null,
      deleted = null;
    const load = () => api.load(localStorage);
    function announce(space) {
      deleted = space.id;
      document.getElementById("space-deleted-name").textContent = space.name;
      banner.hidden = false;
    }
    document.addEventListener("click", (event) => {
      const button = event.target.closest(
        "[data-delete-space], [data-delete-current-space]",
      );
      if (!button) return;
      try {
        const state = load();
        const id =
          button.dataset.deleteSpace ||
          new URLSearchParams(location.search).get("space") ||
          state.spaces[0]?.id;
        pending = state.spaces.find((s) => s.id === id);
        if (!pending) return;
        document.getElementById("delete-space-description").textContent =
          "Delete “" + pending.name + "”?";
        error.hidden = true;
        dialog.showModal();
      } catch {
        button.textContent = "Enable browser storage to delete";
      }
    });
    document
      .getElementById("confirm-delete-space")
      .addEventListener("click", () => {
        if (!pending) return;
        try {
          const next = api.remove(load(), pending.id);
          if (!api.save(localStorage, next))
            throw Error("Enable browser storage to save this change.");
          dialog.close();
          if (location.pathname.endsWith("07-space-settings.html")) {
            location.href =
              "01-spaces.html?deleted=" + encodeURIComponent(pending.id);
            return;
          }
          announce(pending);
          document.dispatchEvent(new Event("spaces-changed"));
        } catch (problem) {
          error.textContent = problem.message;
          error.hidden = false;
        }
      });
    document
      .getElementById("undo-space-delete")
      .addEventListener("click", () => {
        try {
          const next = api.restore(load(), deleted);
          if (!api.save(localStorage, next))
            throw Error("Enable browser storage to restore this study place.");
          banner.hidden = true;
          document.dispatchEvent(new Event("spaces-changed"));
        } catch (problem) {
          document.getElementById("space-deleted-name").textContent =
            problem.message;
        }
      });
    let id = new URLSearchParams(location.search).get("deleted");
    if (!id && location.pathname.endsWith("01-spaces.html")) {
      try { id = load().deletedSpaces?.at(-1)?.id; } catch {}
    }
    if (id) {
      try {
        const space = (load().deletedSpaces || []).find((s) => s.id === id);
        if (space) announce(space);
      } catch {}
    }
  });
})();
