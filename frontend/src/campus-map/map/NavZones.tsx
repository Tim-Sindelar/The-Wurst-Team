import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Polygon, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import {
  outlineCenter,
  zoneAt,
  type NavigationConfig,
  type NavZone,
} from '../domain/navigation';
import { outlineToLatLngs } from './geo';

interface Props {
  config: NavigationConfig;
  /** Off while placing pins, picking rooms or drawing, so clicks keep their admin meaning. */
  enabled: boolean;
  /** Admin: zone drawn dashed so its click area is visible while configuring it. */
  highlightedZoneId: string | null;
  /** Where the home button flies back to. */
  homeBounds: L.LatLngBounds | undefined;
  /** Admin: show the hover outline with the zone name. The normal view only changes the cursor. */
  showHints: boolean;
  /** The "show both campuses" button. */
  homeButton: boolean;
}

const HOVER_STYLE: L.PathOptions = {
  color: '#215caf',
  weight: 2,
  opacity: 0.8,
  fillColor: '#215caf',
  fillOpacity: 0.08,
  interactive: false,
};
const ADMIN_STYLE: L.PathOptions = {
  color: '#e0a020',
  weight: 2,
  opacity: 0.9,
  fillOpacity: 0.06,
  dashArray: '6 4',
  interactive: false,
};

/**
 * Click-to-zoom shortcut: a click inside an active zone flies there. It takes
 * priority over everything drawn on the map (pins, workspace markers and
 * outlines, rooms); only the map controls keep their clicks.
 */
export function NavZones({
  config,
  enabled,
  highlightedZoneId,
  homeBounds,
  showHints,
  homeButton,
}: Props) {
  const map = useMap();
  const [hover, setHover] = useState<NavZone | null>(null);
  const moving = useRef(false);

  const hit = useRef<(e: MouseEvent) => NavZone | null>(() => null);
  hit.current = (e) => {
    // Map controls (zoom, floor picker, home) keep their own clicks.
    const target = e.target as Element;
    if (
      !enabled ||
      target.closest('.leaflet-control, .floor-picker, .leaflet-popup')
    )
      return null;
    return zoneAt(config, map.mouseEventToLatLng(e), map.getZoom());
  };

  // Native capture-phase listeners on the container run before Leaflet's own
  // handlers on pins, rooms and workspace outlines, so a zone click takes
  // priority over them (they still get their clicks wherever no zone is active).
  useEffect(() => {
    const container = map.getContainer();
    const onClick = (e: MouseEvent) => {
      // A drag ends with a click too; Leaflet ignores it, and so do we.
      if ((map.dragging as L.Handler & { moved?: () => boolean }).moved?.())
        return;
      const zone = hit.current(e);
      if (!zone) return;
      e.stopPropagation();
      setHover(null);
      map.flyTo(outlineCenter(zone.outline!), zone.zoom, { duration: 0.8 });
    };
    const onMove = (e: MouseEvent) => {
      if (moving.current) return;
      const zone = hit.current(e);
      setHover((prev) => (prev?.id === zone?.id ? prev : zone));
    };
    container.addEventListener('click', onClick, true);
    container.addEventListener('mousemove', onMove, true);
    return () => {
      container.removeEventListener('click', onClick, true);
      container.removeEventListener('mousemove', onMove, true);
    };
  }, [map]);

  useMapEvents({
    mouseout: () => setHover(null),
    movestart: () => {
      moving.current = true;
      setHover(null);
    },
    moveend: () => void (moving.current = false),
  });

  useEffect(() => {
    if (!enabled) setHover(null);
  }, [enabled]);

  useEffect(() => {
    map.getContainer().classList.toggle('nav-hover', hover !== null);
  }, [map, hover]);

  useHomeControl(homeButton ? homeBounds : undefined);

  const highlighted = config.zones.find(
    (z) => z.id === highlightedZoneId && z.outline,
  );

  return (
    <>
      {highlighted && (
        <Polygon
          key={`admin-${highlighted.id}`}
          positions={outlineToLatLngs(highlighted.outline!)}
          pathOptions={ADMIN_STYLE}
        />
      )}
      {showHints && hover && hover.id !== highlighted?.id && (
        <Polygon
          key={`hover-${hover.id}`}
          positions={outlineToLatLngs(hover.outline!)}
          pathOptions={HOVER_STYLE}
        >
          <Tooltip permanent direction="center" className="nav-zone-tip">
            {hover.name}
          </Tooltip>
        </Polygon>
      )}
    </>
  );
}

/** A "show everything" button below the zoom buttons. */
function useHomeControl(bounds: L.LatLngBounds | undefined) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    const control = new L.Control({ position: 'topleft' });
    control.onAdd = () => {
      const bar = L.DomUtil.create('div', 'leaflet-bar');
      const btn = L.DomUtil.create('a', 'nav-home', bar);
      btn.href = '#';
      btn.role = 'button';
      btn.title = 'Show both campuses';
      btn.setAttribute('aria-label', btn.title);
      btn.innerHTML = '&#8962;';
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(btn, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        map.flyToBounds(bounds, { duration: 0.8 });
      });
      return bar;
    };
    control.addTo(map);
    return () => void control.remove();
  }, [map, bounds]);
}
