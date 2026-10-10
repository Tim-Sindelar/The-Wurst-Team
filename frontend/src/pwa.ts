/** Installable app: registers the service worker (production builds only, so
 *  the dev server never serves stale files) and keeps the browser's
 *  theme-color, which tints the status bar of the installed app, on the
 *  current theme's background. */
export function setUpPwa() {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const register = () =>
      navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`, {
          scope: import.meta.env.BASE_URL,
        })
        .catch(() => {
          /* no worker (private mode, blocked): the app still works online */
        });
    // The entry module can run after the load event has already fired.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }

  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (!meta) return;
  const sync = () => {
    const bg = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-bg')
      .trim();
    if (bg) meta.content = bg;
  };
  sync();
  new MutationObserver(sync).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-mantine-color-scheme'],
  });
}
