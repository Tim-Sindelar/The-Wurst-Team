/* base.js: the only script. Theme switch, bottom sheets, banners, and the
   little helpers the guide pages use. Load in <head>, no defer, so the saved
   theme is applied before the page paints. Everything storage-related is
   wrapped because storage can be blocked (private window, file:// quirks). */
(() => {
  const root = document.documentElement;
  const KEY = 'study-theme';

  const read = () => {
    try {
      return new URLSearchParams(location.search).get('theme') || localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };
  const apply = (theme) => {
    if (theme === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
  };
  apply(read());

  const isLight = () => root.getAttribute('data-theme') === 'light';
  const syncToggles = () => {
    document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
      b.setAttribute('aria-pressed', String(isLight()));
      b.setAttribute('aria-label', isLight() ? 'Switch to dark theme' : 'Switch to light theme');
    });
  };

  /* --- Guide pages: show real token values and the HTML of each specimen --- */
  const renderTokens = () => {
    const cs = getComputedStyle(root);
    document.querySelectorAll('[data-token]').forEach((el) => {
      el.textContent = cs.getPropertyValue(el.dataset.token).trim();
    });
  };
  const buildSwatches = () => {
    document.querySelectorAll('[data-swatches]').forEach((box) => {
      box.innerHTML = '';
      box.dataset.swatches.split(',').forEach((name) => {
        const n = name.trim();
        const item = document.createElement('div');
        item.className = 'swatch';
        item.innerHTML =
          `<div class="swatch__chip" style="background:var(${n})"></div>` +
          `<strong>${n}</strong><code data-token="${n}"></code>`;
        box.append(item);
      });
    });
  };
  const addCodeViews = () => {
    document.querySelectorAll('.stage[data-code]').forEach((stage) => {
      const details = document.createElement('details');
      details.className = 'code';
      const summary = document.createElement('summary');
      summary.textContent = 'HTML';
      const pre = document.createElement('pre');
      const lines = stage.innerHTML.replace(/\s+style="[^"]*"/g, '').split('\n');
      while (lines.length && !lines[0].trim()) lines.shift();
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
      pre.textContent = lines.map((l) => l.slice(indent)).join('\n');
      details.append(summary, pre);
      stage.after(details);
    });
  };

  /* --- Countdowns: <p data-countdown="552" data-total="600"> ticks down each
         second and shrinks the .progress bar in the same .timer-card. ------- */
  const fmt = (s) => {
    const h = Math.floor(s / 3600);
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };
  const param = (k) => new URLSearchParams(location.search).get(k);
  const phase = param('phase') || 'normal';
  const parseMap = (s) => Object.fromEntries((s || '').split(',').filter(Boolean).map((p) => p.split(':')));
  /* Optional overrides so one timer can show every mock state:
     data-countdown-phase="priority:1160,open:570"  (uses ?phase=)
     data-countdown-extended="8360" data-total-extended="14400"  (uses ?extended=1) */
  const startCountdowns = () => {
    document.querySelectorAll('[data-countdown]').forEach((el) => {
      let left = Number(el.dataset.countdown);
      let total = Number(el.dataset.total) || left;
      const byPhase = parseMap(el.dataset.countdownPhase);
      if (byPhase[phase]) left = Number(byPhase[phase]);
      if (param('extended') === '1' && el.dataset.countdownExtended) {
        left = Number(el.dataset.countdownExtended);
        total = Number(el.dataset.totalExtended) || total;
      }
      const bar = el.closest('.timer-card')?.querySelector('.progress');
      const paint = () => {
        el.textContent = fmt(left);
        if (bar) {
          bar.querySelector('.progress__bar').style.setProperty('--value', `${(left / total) * 100}%`);
          bar.setAttribute('aria-valuenow', String(left));
        }
      };
      paint();
      if (left <= 0) return;
      const id = setInterval(() => {
        left -= 1;
        paint();
        if (left <= 0) clearInterval(id);
      }, 1000);
    });
  };

  /* --- Booking state (mock): remembers in the browser where the user is.
         Reservation sets "reserved", Session sets "session", cancelling or ending
         clears it. Home shows [data-if-state="reserved"] or [data-if-state="session"].
         ?state=reserved, ?state=session or ?state=none on the URL forces it. ---- */
  const STATE_KEY = 'study-state';
  const getState = () => {
    try {
      const forced = param('state');
      if (forced) return forced === 'none' ? null : forced;
      return localStorage.getItem(STATE_KEY);
    } catch {
      return null;
    }
  };
  const setState = (value) => {
    try {
      if (value) localStorage.setItem(STATE_KEY, value);
      else localStorage.removeItem(STATE_KEY);
    } catch {
      /* storage blocked: Home just won't show the card */
    }
  };

  /* --- Banners: auto-hide after 6s unless data-urgent ---------------------- */
  const showBanner = (el) => {
    el.hidden = false;
    clearTimeout(el._timer);
    if (!el.hasAttribute('data-urgent')) el._timer = setTimeout(() => (el.hidden = true), 6000);
  };

  /* --- Sheets: swipe down to close (counts as Cancel) ---------------------- */
  const wireSwipe = (dialog) => {
    const grab = dialog.querySelector('.sheet__grab');
    if (!grab || grab._wired) return;
    grab._wired = true;
    let startY = null;
    grab.addEventListener('pointerdown', (e) => {
      startY = e.clientY;
      grab.setPointerCapture(e.pointerId);
    });
    grab.addEventListener('pointermove', (e) => {
      if (startY === null) return;
      const dy = Math.max(0, e.clientY - startY);
      dialog.style.transform = `translateY(${dy}px)`;
    });
    const end = (e) => {
      if (startY === null) return;
      const dy = e.clientY - startY;
      startY = null;
      dialog.style.transform = '';
      if (dy > 80) dialog.close('cancel');
    };
    grab.addEventListener('pointerup', end);
    grab.addEventListener('pointercancel', () => {
      startY = null;
      dialog.style.transform = '';
    });
  };

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;

    const themeBtn = t.closest('[data-theme-toggle]');
    if (themeBtn) {
      const next = isLight() ? 'dark' : 'light';
      apply(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* storage blocked: the theme still switches for this page view */
      }
      syncToggles();
      renderTokens();
      return;
    }

    if (t.closest('[data-clears-state]')) setState(null);

    const fav = t.closest('[data-favourite], [data-toggle]');
    if (fav) {
      fav.setAttribute('aria-pressed', String(fav.getAttribute('aria-pressed') !== 'true'));
      return;
    }

    const open = t.closest('[data-sheet-open]');
    if (open) {
      const dlg = document.getElementById(open.dataset.sheetOpen);
      if (dlg) {
        wireSwipe(dlg);
        dlg.showModal();
      }
      return;
    }
    const close = t.closest('[data-sheet-close]');
    if (close) {
      close.closest('dialog')?.close('cancel');
      return;
    }
    /* Click on the dimmed area: the click target is the dialog itself. */
    if (t instanceof HTMLDialogElement && t.classList.contains('sheet')) {
      const r = t.getBoundingClientRect();
      const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if (outside) t.close('cancel');
      return;
    }

    const bOpen = t.closest('[data-banner-open]');
    if (bOpen) {
      const el = document.getElementById(bOpen.dataset.bannerOpen);
      if (el) showBanner(el);
      return;
    }
    const bClose = t.closest('[data-banner-close]');
    if (bClose) bClose.closest('.banner').hidden = true;
  });

  const initSeatMaps = () => {
    document.querySelectorAll('[data-seat-map]').forEach((viewport) => {
      if (viewport.dataset.mapReady) return;
      const world = viewport.querySelector('.seat-map__world');
      const seats = Array.from(viewport.querySelectorAll('[data-seat-number]'));
      if (!world || !seats.length) return;
      const shell = viewport.closest('[data-seat-map-shell]') || viewport;
      const zoomLabel = viewport.querySelector('[data-map-scale]');
      const zoomIn = viewport.querySelector('[data-map-zoom="in"]');
      const zoomOut = viewport.querySelector('[data-map-zoom="out"]');
      const info = viewport.querySelector('[data-map-info]');
      const pointers = new Map();
      const maxScale = 2.5;
      let width = viewport.clientWidth, height = viewport.clientHeight;
      const worldWidth = world.offsetWidth, worldHeight = world.offsetHeight;
      let scale = 1, x = 0, y = 0, gesture = null, fitted = false;
      const minScale = () => Math.min((width - 24) / worldWidth, (height - 24) / worldHeight);
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      const draw = () => {
        const w = worldWidth * scale, h = worldHeight * scale;
        x = w <= width ? (width - w) / 2 : clamp(x, width - w, 0);
        y = h <= height ? (height - h) / 2 : clamp(y, height - h, 0);
        world.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')';
        if (zoomLabel) zoomLabel.textContent = Math.round(scale * 100) + '%';
        if (zoomIn) zoomIn.disabled = scale >= maxScale - 0.001;
        if (zoomOut) zoomOut.disabled = scale <= minScale() + 0.001;
      };
      const centerSeat = (seat) => {
        fitted = false; scale = Math.max(1, scale);
        x = width / 2 - Number(seat.dataset.x) * scale;
        y = height / 2 - Number(seat.dataset.y) * scale;
        draw();
      };
      const zoom = (next, anchor = { x: width / 2, y: height / 2 }) => {
        const old = scale; fitted = false;
        scale = clamp(next, minScale(), maxScale);
        x = anchor.x - (anchor.x - x) * scale / old;
        y = anchor.y - (anchor.y - y) * scale / old;
        draw();
      };
      const fit = () => {
        fitted = true; scale = minScale();
        x = (width - worldWidth * scale) / 2;
        y = (height - worldHeight * scale) / 2;
        draw();
      };
      const names = { free: 'Free', reserved: 'Reserved', occupied: 'Occupied', break: 'On break', bookable: 'Occupied, bookable' };
      const details = { free: 'Available now', reserved: 'Reserved by another student', occupied: 'Currently occupied', break: 'Held while the student is on break', bookable: 'Occupied · available to reserve for later' };
      const select = (seat) => {
        const key = seat.dataset.seatState, number = seat.dataset.seatNumber;
        seats.forEach((item) => {
          const active = item === seat;
          item.setAttribute('aria-pressed', String(active));
          item.setAttribute('aria-label', 'Seat ' + item.dataset.seatNumber + ', ' + names[item.dataset.seatState].toLowerCase() + (active ? ', selected' : ''));
        });
        const name = shell.querySelector('[data-selected-seat-name]');
        const state = shell.querySelector('[data-selected-seat-state]');
        const detail = shell.querySelector('[data-selected-seat-detail]');
        const feature = shell.querySelector('[data-selected-seat-feature]');
        const reserve = shell.querySelector('[data-selected-seat-reserve]');
        if (name) name.textContent = 'Seat ' + number;
        if (state) { state.textContent = names[key]; state.className = 'chip is-' + key; }
        if (detail) detail.textContent = viewport.dataset.room + ' · ' + details[key];
        if (feature) feature.textContent = seat.dataset.seatFeature;
        if (reserve) {
          reserve.disabled = !['free', 'bookable'].includes(key);
          reserve.textContent = key === 'free' ? 'Reserve seat ' + number : key === 'bookable' ? 'Reserve seat ' + number + ' for later' : names[key] + ' · unavailable';
        }
        centerSeat(seat);
      };
      seats.forEach((seat) => {
        seat.style.left = Number(seat.dataset.x) + 'px';
        seat.style.top = Number(seat.dataset.y) + 'px';
      });
      select(seats.find((seat) => seat.getAttribute('aria-pressed') === 'true') || seats[0]);
      fit();
      viewport.dataset.mapReady = 'true';
      viewport.classList.add('is-ready');
      const point = (event) => {
        const rect = viewport.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
      };
      const startPinch = () => {
        const [a, b] = Array.from(pointers.values());
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        gesture = { kind: 'pinch', distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), scale, worldX: (mid.x - x) / scale, worldY: (mid.y - y) / scale, moved: true };
      };
      viewport.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.target.closest('.seat-map__info')) return;
        if (info) info.open = false;
        if (event.target.closest('.seat-map__controls')) return;
        event.preventDefault();
        const p = point(event);
        pointers.set(event.pointerId, p);
        viewport.setPointerCapture(event.pointerId);
        if (pointers.size === 1) gesture = { kind: 'pan', origin: p, x, y, seat: event.target.closest('[data-seat-number]'), moved: false };
        else if (pointers.size === 2) startPinch();
      });
      viewport.addEventListener('pointermove', (event) => {
        if (!pointers.has(event.pointerId)) return;
        pointers.set(event.pointerId, point(event)); fitted = false;
        if (pointers.size >= 2 && gesture?.kind === 'pinch') {
          const [a, b] = Array.from(pointers.values());
          scale = clamp(gesture.scale * Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance, minScale(), maxScale);
          x = (a.x + b.x) / 2 - gesture.worldX * scale;
          y = (a.y + b.y) / 2 - gesture.worldY * scale;
        } else if (gesture?.kind === 'pan') {
          const p = pointers.get(event.pointerId);
          if (Math.hypot(p.x - gesture.origin.x, p.y - gesture.origin.y) > 6) gesture.moved = true;
          x = gesture.x + p.x - gesture.origin.x;
          y = gesture.y + p.y - gesture.origin.y;
        }
        viewport.classList.toggle('is-dragging', Boolean(gesture?.moved)); draw();
      });
      const endPointer = (event) => {
        if (!pointers.has(event.pointerId)) return;
        const candidate = gesture?.kind === 'pan' && !gesture.moved && event.type === 'pointerup' ? gesture.seat : null;
        pointers.delete(event.pointerId);
        if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
        if (pointers.size >= 2) startPinch();
        else if (pointers.size === 1) gesture = { kind: 'pan', origin: Array.from(pointers.values())[0], x, y, seat: null, moved: true };
        else { gesture = null; viewport.classList.remove('is-dragging'); }
        if (candidate) { select(candidate); candidate.focus({ preventScroll: true }); }
      };
      viewport.addEventListener('pointerup', endPointer);
      viewport.addEventListener('pointercancel', endPointer);
      viewport.addEventListener('lostpointercapture', (event) => { if (pointers.has(event.pointerId)) endPointer(event); });
      viewport.addEventListener('click', (event) => {
        if (event.target.closest('[data-map-fit]')) { fit(); return; }
        const control = event.target.closest('[data-map-zoom]');
        if (control) { zoom(scale * (control.dataset.mapZoom === 'in' ? 1.25 : 0.8)); return; }
        const seat = event.target.closest('[data-seat-number]');
        if (seat && event.detail === 0) select(seat);
      });
      viewport.addEventListener('focusin', (event) => {
        const seat = event.target.closest('[data-seat-number]');
        if (seat) centerSeat(seat);
      });
      viewport.addEventListener('wheel', (event) => {
        if (event.target.closest('.seat-map__info')) return;
        event.preventDefault();
        zoom(scale * Math.exp(-clamp(event.deltaY, -100, 100) * 0.003), point(event));
      }, { passive: false });
      viewport.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && info?.open) {
          info.open = false; info.querySelector('summary').focus({ preventScroll: true });
          event.preventDefault(); return;
        }
        if (event.target.closest('.seat-map__controls') || event.target.closest('.seat-map__info')) return;
        if (['+', '='].includes(event.key)) zoom(scale * 1.25);
        else if (event.key === '-') zoom(scale * 0.8);
        else if (['0', 'Home'].includes(event.key)) fit();
        else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          fitted = false;
          x += event.key === 'ArrowLeft' ? 48 : event.key === 'ArrowRight' ? -48 : 0;
          y += event.key === 'ArrowUp' ? 48 : event.key === 'ArrowDown' ? -48 : 0;
          draw();
        } else return;
        event.preventDefault();
      });
      const choose = shell.querySelector('[data-map-choose-free]');
      if (choose) choose.addEventListener('click', () => {
        const seat = seats.find((item) => item.dataset.seatState === 'free');
        if (seat) { select(seat); seat.focus({ preventScroll: true }); }
      });
      const resize = () => {
        const oldWidth = width, oldHeight = height;
        width = viewport.clientWidth; height = viewport.clientHeight;
        if (fitted) { fit(); return; }
        x += (width - oldWidth) / 2; y += (height - oldHeight) / 2;
        scale = Math.max(scale, minScale()); draw();
      };
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(viewport);
      else window.addEventListener('resize', resize);
    });
  };

  document.addEventListener('DOMContentLoaded', () => {
    syncToggles();
    buildSwatches();
    renderTokens();
    addCodeViews();
    startCountdowns();
    const setter = document.querySelector('[data-sets-state]');
    if (setter) setState(setter.dataset.setsState);
    const current = getState();
    document.querySelectorAll('[data-if-state]').forEach((el) => (el.hidden = el.dataset.ifState !== current));
    /* Mock states: show an element only in some ?phase= (default "normal"). */
    document.querySelectorAll('[data-show-in]').forEach((el) => {
      el.hidden = !el.dataset.showIn.split(' ').includes(phase);
    });
    /* Show an element only when a URL parameter matches, e.g. data-if-param="error=1". */
    document.querySelectorAll('[data-if-param]').forEach((el) => {
      const [k, v] = el.dataset.ifParam.split('=');
      const on = param(k) === v;
      el.hidden = !on;
      if (on && el.classList.contains('banner')) showBanner(el);
    });
    /* Carry the current URL parameters onto a link: data-keep-params (not "error"). */
    document.querySelectorAll('[data-keep-params]').forEach((a) => {
      const url = new URL(a.getAttribute('href'), location.href);
      new URLSearchParams(location.search).forEach((v, k) => {
        if (k !== 'error' && !url.searchParams.has(k)) url.searchParams.set(k, v);
      });
      a.setAttribute('href', url.pathname.split('/').pop() + url.search);
    });
    /* Swap a link's target by URL parameter:
       data-href-map="from=extend>05-session.html?extended=1 from=break-start>05-session.html?phase=break" */
    document.querySelectorAll('[data-href-map]').forEach((el) => {
      el.dataset.hrefMap.split(/\s+/).filter(Boolean).forEach((rule) => {
        const [cond, target] = rule.split('>');
        const [k, v] = cond.split('=');
        if (param(k) === v) el.setAttribute('href', target);
      });
    });
    /* Show an element only when a URL parameter is absent: data-if-no-param="from". */
    document.querySelectorAll('[data-if-no-param]').forEach((el) => {
      el.hidden = param(el.dataset.ifNoParam) !== null;
    });
    initSeatMaps();
  });
})();
