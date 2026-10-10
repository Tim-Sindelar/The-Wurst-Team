(() => {
  "use strict";
  document.addEventListener("DOMContentLoaded", () => {
    const api = window.AdminSpacesData,
      qr = window.AdminQrData,
      geometry = window.AdminLayoutData;
    let storage,
      state = api.seed(),
      batch = null,
      size = 4;
    try {
      storage = localStorage;
      state = api.load(storage);
    } catch {}
    const form = document.getElementById("qr-form"),
      spaceSelect = document.getElementById("qr-space"),
      roomInput = document.getElementById("qr-room"),
      address = document.getElementById("qr-address"),
      labels = document.getElementById("qr-labels"),
      print = document.getElementById("qr-print"),
      error = document.getElementById("qr-error"),
      fields = document.getElementById("qr-fields");
    const requested = new URLSearchParams(location.search).get("space");
    const space = () => state.spaces.find((s) => s.id === (requested || spaceSelect.value));
    spaceSelect.disabled = !!requested;
    document.getElementById("qr-space-picker").hidden = !!requested;
    document.getElementById("qr-space-name").hidden = !requested;
    if (requested) {
      document.querySelector('label[for="qr-space"]').removeAttribute("for");
      document.getElementById("qr-empty").textContent = "Generate seat labels for this study space.";
    }
    function populateSpaces(selected) {
      spaceSelect.replaceChildren();
      for (const s of state.spaces) {
        if (requested && s.id !== requested) continue;
        const option = document.createElement("option");
        option.value = s.id;
        option.textContent = s.name;
        spaceSelect.append(option);
      }
      if (selected !== undefined) spaceSelect.value = selected;
    }
    populateSpaces();
    if (requested && !state.spaces.some((s) => s.id === requested)) {
      spaceSelect.value = "";
      error.hidden = false;
      error.textContent = "Space not found. Open QR codes from the sidebar to select an available study space.";
    } else if (requested) spaceSelect.value = requested;
    const invalidate = () => {
      if (batch) {
        document.getElementById("qr-stale").hidden = false;
        print.disabled = true;
      }
    };
    function selectSpace() {
      const s = space(),
        room = geometry.room(s?.roomId);
      document.getElementById("qr-space-name").textContent = s?.name || "Space not found";
      roomInput.value = room?.label || "";
      roomInput.readOnly = !!room;
      document.getElementById("qr-room-help").textContent = room
        ? "Room label from the selected space."
        : "Enter the full room label for this sample space, e.g. HG EO 30.0065.";
      let count = 0;
      try {
        count = qr.seatNumbers(s).length;
      } catch {}
      document.getElementById("qr-seat-count").textContent =
        count +
        " seat labels" +
        (s?.layout === null ? " · Sample seat count" : " · From saved layout");
      const id = encodeURIComponent(s?.id || "");
      document.querySelectorAll(".subnav a").forEach((a) => {
        const url = new URL(a.href, location.href);
        url.searchParams.set("space", s?.id || "");
        a.href = url.href;
      });
      document.getElementById("qr-layout").href =
        "06-space-layout.html?space=" + id;
      document.querySelector(".page-header h1").textContent = s
        ? s.name + " · QR codes"
        : "QR codes";
      invalidate();
    }
    selectSpace();
    spaceSelect.addEventListener("change", selectSpace);
    form.addEventListener("input", invalidate);
    window.addEventListener("storage", (event) => {
      if (event.key === api.KEY) {
        const selected = spaceSelect.value;
        state = api.load(storage);
        populateSpaces(selected);
        selectSpace();
      }
    });
    const labelSvg = (label) => {
      const code = qrcode(0, "M");
      code.addData(label.url, "Byte");
      code.make();
      return code.createSvgTag({ cellSize: 1, margin: 4, scalable: true });
    };
    function download(label) {
      const svg = label.svg.replace(
          "<svg ",
          '<svg width="' + size + 'cm" height="' + size + 'cm" ',
        ),
        url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })),
        a = document.createElement("a");
      a.href = url;
      a.download =
        "room-" +
        label.room.replace(/ /g, "-") +
        "-seat-" +
        String(label.seat).padStart(2, "0") +
        "-" +
        size +
        "cm.svg";
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.hidden = true;
      print.disabled = true;
      fields.disabled = true;
      try {
        if (storage) state = api.load(storage);
        const next = qr.labels(space(), roomInput.value, address.value);
        if (typeof qrcode !== "function")
          throw Error(
            "The QR library could not load. Connect to the internet and reload this page.",
          );
        await new Promise((resolve) => setTimeout(resolve, 0));
        const fragment = document.createDocumentFragment();
        for (const label of next) {
          label.svg = labelSvg(label);
          const card = document.createElement("article");
          card.className = "qr-label";
          const caption = document.createElement("p");
          caption.className = "qr-room-caption";
          caption.textContent = label.room;
          const title = document.createElement("h3");
          title.className = "qr-seat-caption";
          title.textContent = "Seat " + String(label.seat).padStart(2, "0");
          const image = document.createElement("img");
          image.className = "qr-image";
          image.src =
            "data:image/svg+xml;charset=utf-8," + encodeURIComponent(label.svg);
          image.alt = "QR code for " + label.room + ", seat " + label.seat;
          const actions = document.createElement("div");
          actions.className = "qr-label-actions qr-screen-only";
          const save = document.createElement("button");
          save.type = "button";
          save.className = "btn btn--quiet";
          save.textContent = "Download SVG";
          save.setAttribute(
            "aria-label",
            "Download SVG for seat " + label.seat,
          );
          save.addEventListener("click", () => download(label));
          const link = document.createElement("a");
          link.className = "btn btn--quiet";
          link.textContent = "Seat link";
          link.href = label.url;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.setAttribute("aria-label", "Open link for seat " + label.seat);
          actions.append(save, link);
          card.append(caption, title, image, actions);
          fragment.append(card);
        }
        labels.replaceChildren(fragment);
        await Promise.all(
          [...labels.querySelectorAll("img")].map((img) => img.decode()),
        );
        batch = next;
        roomInput.value = next[0].room;
        address.value = qr.appAddress(address.value);
        document.getElementById("qr-summary").textContent =
          next.length + " labels · " + size + " × " + size + " cm";
        document.getElementById("qr-empty").hidden = true;
        document.getElementById("qr-stale").hidden = true;
        document.getElementById("qr-print-tip").hidden = false;
        const note = document.getElementById("qr-address-note"),
          hostname = new URL(address.value).hostname;
        note.hidden =
          hostname !== "example.com" &&
          !["localhost", "127.0.0.1", "[::1]"].includes(hostname);
        note.textContent =
          hostname === "example.com"
            ? "Example links: replace the app address before printing real labels."
            : "Localhost links open only on this computer. Use an address reachable from students’ phones.";
        print.disabled = false;
      } catch (problem) {
        error.textContent = problem.message;
        error.hidden = false;
        error.focus();
        document.getElementById("qr-stale").hidden = !batch;
      } finally {
        fields.disabled = false;
      }
    });
    document.querySelectorAll("[data-qr-size]").forEach((button) =>
      button.addEventListener("click", () => {
        size = Number(button.dataset.qrSize);
        labels.style.setProperty("--qr-size", size + "cm");
        document
          .querySelectorAll("[data-qr-size]")
          .forEach((b) =>
            b.setAttribute(
              "aria-pressed",
              String(Number(b.dataset.qrSize) === size),
            ),
          );
        if (batch)
          document.getElementById("qr-summary").textContent =
            batch.length + " labels · " + size + " × " + size + " cm";
      }),
    );
    print.addEventListener("click", () => {
      if (batch && !print.disabled) window.print();
    });
  });
})();
