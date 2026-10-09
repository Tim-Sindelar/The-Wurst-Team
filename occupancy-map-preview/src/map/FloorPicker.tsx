import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { useMap, useMapEvents } from 'react-leaflet';
import { floorLabel, intersects, type FloorIndex } from '../floors/floorData';
import type { Library } from '../domain/types';

interface Props {
  index: FloorIndex;
  floor: number;
  libraries: Library[];
  onChange: (floor: number) => void;
}

/** Vertical floor switcher listing the floors of the buildings in view, plus a status pill naming their levels. */
export function FloorPicker({ index, floor, libraries, onChange }: Props) {
  const map = useMap();
  const [bounds, setBounds] = useState(() => map.getBounds());
  useMapEvents({ moveend: () => setBounds(map.getBounds()) });

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Clicks and wheel events on the control must not reach the map (e.g. while placing pins).
    if (ref.current) {
      L.DomEvent.disableClickPropagation(ref.current);
      L.DomEvent.disableScrollPropagation(ref.current);
    }
  }, []);

  const view = { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() };
  const inView = index.levels.filter((l) => intersects(l.bbox, view));

  const shown = inView.length ? inView : index.levels;
  const floors = [...new Set([...shown.map((l) => l.floor), floor])].sort((a, b) => b - a);
  const labelOf = (f: number) => floorLabel(f, shown);

  const libraryFloors = new Set(
    libraries
      .filter((l) => l.floor !== null && bounds.contains([l.position.lat, l.position.lng]))
      .map((l) => l.floor as number),
  );

  const here = inView.filter((l) => l.floor === floor);
  const names = here.slice(0, 4).map((l) => `${l.facilityId.replace(/^ETH\./, '')} ${l.label}`);
  const status = here.length
    ? `${names.join(', ')}${here.length > names.length ? ` +${here.length - names.length}` : ''}`
    : 'No floor plans on this floor here';

  return (
    <>
      <div ref={ref} className="floor-picker" role="group" aria-label="Floor">
        <span className="floor-title">Floor</span>
        {floors.map((f) => (
          <button
            key={f}
            aria-pressed={f === floor}
            className={libraryFloors.has(f) ? 'has-library' : undefined}
            title={libraryFloors.has(f) ? 'Libraries on this floor' : undefined}
            onClick={() => onChange(f)}
          >
            {labelOf(f)}
          </button>
        ))}
      </div>
      {map.getZoom() >= 16 && (
        <div className="floor-status">
          Floor {labelOf(floor)} · {status}
        </div>
      )}
    </>
  );
}
