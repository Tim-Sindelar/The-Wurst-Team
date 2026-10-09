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
  });
})();
