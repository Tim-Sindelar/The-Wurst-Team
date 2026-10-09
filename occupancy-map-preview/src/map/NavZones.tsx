import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Polygon, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { outlineCenter, zoneAt, type NavigationConfig, type NavZone } from '../domain/navigation';
import { outlineToLatLngs } from './geo';

interface Props {
  config: NavigationConfig;
  /** Off while placing pins, picking rooms or drawing, so clicks keep their admin meaning. */
  enabled: boolean;
  /** Admin: zone drawn dashed so its click area is visible while configuring it. */
  highlightedZoneId: string | null;
  /** Where the home button flies back to. */
  homeBounds: L.LatLngBounds | undefined;
}

const HOVER_STYLE: L.PathOptions = { color: '#215caf', weight: 2, opacity: 0.8, fillColor: '#215caf', fillOpacity: 0.08, interactive: false };
const ADMIN_STYLE: L.PathOptions = { color: '#e0a020', weight: 2, opacity: 0.9, fillOpacity: 0.06, dashArray: '6 4', interactive: false };

/**
 * Click-to-zoom shortcut: a click inside an active zone flies there. Hit testing
 * runs on map clicks, so markers and workspace outlines (which stop their
 * clicks) keep working on top of a zone.
 */
export function NavZones({ config, enabled, highlightedZoneId, homeBounds }: Props) {
  const map = useMap();
  const [hover, setHover] = useState<NavZone | null>(null);
  const moving = useRef(false);

  const hit = (latlng: L.LatLng) => (enabled ? zoneAt(config, latlng, map.getZoom()) : null);

  useMapEvents({
    click: (e) => {
      const zone = hit(e.latlng);
      if (!zone) return;
      setHover(null);
      map.flyTo(outlineCenter(zone.outline!), zone.zoom, { duration: 0.8 });
    },
    mousemove: (e) => {
      if (moving.current) return;
      const zone = hit(e.latlng);
      if (zone?.id !== hover?.id) setHover(zone);
    },
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

  useHomeControl(homeBounds);

  const highlighted = config.zones.find((z) => z.id === highlightedZoneId && z.outline);

  return (
    <>
      {highlighted && <Polygon key={`admin-${highlighted.id}`} positions={outlineToLatLngs(highlighted.outline!)} pathOptions={ADMIN_STYLE} />}
      {hover && hover.id !== highlighted?.id && (
        <Polygon key={`hover-${hover.id}`} positions={outlineToLatLngs(hover.outline!)} pathOptions={HOVER_STYLE}>
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
