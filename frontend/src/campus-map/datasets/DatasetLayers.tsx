import L from 'leaflet';
import { useState } from 'react';
import { Marker, Tooltip, useMapEvents } from 'react-leaflet';
import type { DatasetItem, DatasetMeta } from './types';
import { pinLook, showsNowOnly, type Clock, type PinLook } from './present';

export interface DatasetSelection {
  datasetId: string;
  itemId: string;
}

interface Layer {
  meta: DatasetMeta;
  items: DatasetItem[];
}

interface Props {
  layers: Layer[];
  clock: Clock;
  selected: DatasetSelection | null;
  onSelect: (sel: DatasetSelection) => void;
}

/** Small pins (amenities, free-floating vehicles) only show from this zoom on, so campuses stay readable. */
const SMALL_PIN_ZOOM = 16;

const icons = new Map<string, L.DivIcon>();

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function datasetIcon(
  color: string,
  look: PinLook,
  selected: boolean,
  approximate: boolean,
) {
  const key = `${color}|${look.glyph}|${look.badge}|${look.dimmed}|${look.small}|${selected}|${approximate}`;
  let icon = icons.get(key);
  if (!icon) {
    const size = look.small ? 22 : 30;
    const classes = [
      'ds-pin',
      look.small && 'is-small',
      look.dimmed && 'is-dimmed',
      selected && 'is-selected',
      approximate && 'is-approx',
    ];
    icon = L.divIcon({
      className: '',
      html: `<div class="${classes.filter(Boolean).join(' ')}" style="--ds-color:${color}">
               <span class="ds-glyph">${escapeHtml(look.glyph)}</span>
               ${look.badge ? `<span class="ds-badge">${escapeHtml(look.badge)}</span>` : ''}
             </div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      tooltipAnchor: [0, -size / 2],
    });
    icons.set(key, icon);
  }
  return icon;
}

/** Map pins of the enabled campus datasets (inside the MapContainer). */
export function DatasetLayers({ layers, clock, selected, onSelect }: Props) {
  const map = useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const [zoom, setZoom] = useState(() => map.getZoom());
  return (
    <>
      {layers.flatMap(({ meta, items }) =>
        items.map((item) => {
          const isSelected =
            selected?.datasetId === meta.id && selected.itemId === item.id;
          const look = pinLook(meta, item, clock);
          if (look.small && zoom < SMALL_PIN_ZOOM && !isSelected) return null;
          return (
            <Marker
              key={`${meta.id}/${item.id}`}
              position={[item.lat, item.lng]}
              icon={datasetIcon(meta.color, look, isSelected, item.approximate)}
              zIndexOffset={isSelected ? 2000 : look.small ? 300 : 600}
              eventHandlers={{
                click: () => onSelect({ datasetId: meta.id, itemId: item.id }),
              }}
            >
              <Tooltip direction="top">
                <strong>{item.name}</strong>
                {item.subtitle && (
                  <>
                    <br />
                    <span className="muted">{item.subtitle}</span>
                  </>
                )}
                {item.approximate && (
                  <>
                    <br />
                    <span className="muted">Approximate position</span>
                  </>
                )}
                {showsNowOnly(meta, clock) && (
                  <>
                    <br />
                    <span className="error-text">
                      Live only: now, not {clock.label}
                    </span>
                  </>
                )}
              </Tooltip>
            </Marker>
          );
        }),
      )}
    </>
  );
}
