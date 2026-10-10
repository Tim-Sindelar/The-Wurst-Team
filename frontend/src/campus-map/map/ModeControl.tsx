import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { Icon } from '../../components/Icon';

/** The layers button at the top right: opens the "Map view" sheet (CampusMap). */
export function ModeControl({ onOpen }: { onOpen: () => void }) {
  const map = useMap();
  const open = useRef(onOpen);
  open.current = onOpen;
  const [button, setButton] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const control = new L.Control({ position: 'topright' });
    control.onAdd = () => {
      const box = L.DomUtil.create('div', 'leaflet-control-layers');
      const btn = L.DomUtil.create('a', 'leaflet-control-layers-toggle', box);
      btn.href = '#';
      btn.role = 'button';
      btn.title = 'Map view';
      btn.setAttribute('aria-label', btn.title);
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.on(btn, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        open.current();
      });
      setButton(btn);
      return box;
    };
    control.addTo(map);
    return () => {
      control.remove();
      setButton(null);
    };
  }, [map]);
  // The app's own outline icon, not Leaflet's raster one.
  return button && createPortal(<Icon name="layers" />, button);
}
