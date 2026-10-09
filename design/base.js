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
  });
})();
