import { ActionIcon } from '@mantine/core';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import { Icon } from './Icon';

/* Leaflet and MapLibre are big, so the map loads in its own chunk. */
const CampusMap = lazy(() =>
  import('../campus-map/CampusMap').then((m) => ({ default: m.CampusMap })),
);

/** Within this many px of the top of the screen counts as fully expanded. */
const EXPANDED_WITHIN = 2;

/* The campus map at the bottom of Home. The block is one screen tall, so the
   page scrolls until the map fills the screen: the part showing at first is
   its preview, and scrolling reveals the rest. While it shows only partly the
   map is nudged up by half of what is hidden, so the visible part always
   centres on the map's centre. Only `transform` moves, and the map takes
   touches only once it is fully expanded, so a drag over the preview scrolls
   the page. */
export function HomeMap() {
  const section = useRef<HTMLElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = section.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = Math.max(0, el.getBoundingClientRect().top);
      layer.current?.style.setProperty('--map-shift', `${top / 2}px`);
      setExpanded(top <= EXPANDED_WITHIN);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // The content above changes height as the spaces load.
    const observer = new ResizeObserver(schedule);
    if (el.parentElement) observer.observe(el.parentElement);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section
      ref={section}
      aria-label="Campus map"
      className="relative -mx-4 -mb-4 h-dvh overflow-hidden border-t border-border bg-bg"
    >
      <div
        ref={layer}
        inert={!expanded}
        className="absolute inset-0 -translate-y-(--map-shift,0px)"
      >
        <Suspense fallback={null}>
          <CampusMap embedded />
        </Suspense>
      </div>

      {expanded && (
        <div className="absolute top-[calc(--spacing(18.5)+env(safe-area-inset-top))] left-2.5 z-1100 overflow-hidden rounded-card border border-border bg-surface shadow-card">
          <ActionIcon
            aria-label="Back to study spaces"
            onClick={() =>
              window.scrollTo({
                top: 0,
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
                  .matches
                  ? 'auto'
                  : 'smooth',
              })
            }
          >
            <Icon name="chevronUp" />
          </ActionIcon>
        </div>
      )}
    </section>
  );
}
