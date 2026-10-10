import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { useMap, useMapEvents } from 'react-leaflet';
import {
  focusFacility,
  intersects,
  singleFloorLabel,
  type FloorIndex,
} from '../floors/floorData';
import type { Library } from '../domain/types';

/** The picker shows from this zoom on, like the floor plans. */
const SHOW_FROM_ZOOM = 16;
/** Height of one floor in the wheel, in px (a touch target). Matches .floor-wheel button. */
const ITEM = 44;

interface Props {
  index: FloorIndex;
  floor: number;
  libraries: Library[];
  onChange: (floor: number) => void;
}

/**
 * Floor wheel: the floors of the buildings in view, top floor first, scrolled
 * so the selected one sits in the middle. Scrolling the wheel picks the floor
 * that comes to rest in the middle; tapping a floor picks it too. Each floor
 * shows one letter, the one the building in focus uses for it. Plus a status
 * pill naming the levels on the selected floor.
 */
export function FloorPicker({ index, floor, libraries, onChange }: Props) {
  const map = useMap();
  const [bounds, setBounds] = useState(() => map.getBounds());
  const [center, setCenter] = useState(() => map.getCenter());
  useMapEvents({
    moveend: () => {
      setBounds(map.getBounds());
      setCenter(map.getCenter());
    },
  });

  const view = {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
  };
  const inView = index.levels.filter((l) => intersects(l.bbox, view));
  const shown = inView.length ? inView : index.levels;
  const floors = [...new Set([...shown.map((l) => l.floor), floor])].sort(
    (a, b) => b - a,
  );
  const focus = focusFacility(shown, center.lat, center.lng);
  const labelOf = (f: number) => singleFloorLabel(f, shown, focus);

  const libraryFloors = new Set(
    libraries
      .filter(
        (l) =>
          l.floor !== null && bounds.contains([l.position.lat, l.position.lng]),
      )
      .map((l) => l.floor as number),
  );

  const here = inView.filter((l) => l.floor === floor);
  const names = here
    .slice(0, 4)
    .map((l) => `${l.facilityId.replace(/^ETH\./, '')} ${l.label}`);
  const status = here.length
    ? `${names.join(', ')}${here.length > names.length ? ` +${here.length - names.length}` : ''}`
    : 'No floor plans on this floor here';

  // Zoomed out over a whole campus the floors mean little, and the wheel
  // would cover the map on a phone.
  if (map.getZoom() < SHOW_FROM_ZOOM) return null;

  return (
    <>
      <FloorWheel
        floors={floors}
        floor={floor}
        labelOf={labelOf}
        marked={libraryFloors}
        onChange={onChange}
      />
      <div className="floor-status">
        Floor {labelOf(floor)} · {status}
      </div>
    </>
  );
}

function FloorWheel({
  floors,
  floor,
  labelOf,
  marked,
  onChange,
}: {
  floors: number[];
  floor: number;
  labelOf: (f: number) => string;
  marked: ReadonlySet<number>;
  onChange: (floor: number) => void;
}) {
  const track = useRef<HTMLDivElement | null>(null);
  const settle = useRef<number | undefined>(undefined);
  /** Set while the user drags, flicks or wheels the wheel: only their scrolling picks a floor. */
  const byUser = useRef(false);
  const latest = useRef({ floors, floor, onChange });
  latest.current = { floors, floor, onChange };

  // Clicks, drags and wheel events on the control must not reach the map. A
  // callback ref, since the picker comes and goes with the zoom.
  const ref = (el: HTMLDivElement | null) => {
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  };

  // The selected floor in the middle, also when it changes from elsewhere.
  // A new set of floors (the map moved) jumps there; a new floor scrolls.
  const selectedIndex = floors.indexOf(floor);
  const floorsKey = floors.join(',');
  const shownKey = useRef(floorsKey);
  useEffect(() => {
    const el = track.current;
    if (!el || selectedIndex < 0) return;
    const top = selectedIndex * ITEM;
    const jump =
      shownKey.current !== floorsKey ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    shownKey.current = floorsKey;
    if (Math.abs(el.scrollTop - top) < 2) return;
    el.scrollTo({ top, behavior: jump ? 'auto' : 'smooth' });
  }, [selectedIndex, floorsKey]);

  useEffect(() => () => window.clearTimeout(settle.current), []);

  // Once the user lets the wheel come to rest, the floor in the middle is the
  // selected one. Scrolling done by the code (or re-snapping when the floors
  // change) picks nothing.
  const onScroll = () => {
    if (!byUser.current) return;
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      byUser.current = false;
      const el = track.current;
      if (!el) return;
      const { floors: fs, floor: current, onChange: change } = latest.current;
      const i = Math.min(
        fs.length - 1,
        Math.max(0, Math.round(el.scrollTop / ITEM)),
      );
      if (fs[i] !== undefined && fs[i] !== current) change(fs[i]);
    }, 140);
  };

  // Up to five floors in view, an odd number so one sits in the middle.
  const visible = Math.min(
    5,
    floors.length % 2 ? floors.length : floors.length + 1,
  );
  const pad = ((visible - 1) / 2) * ITEM;

  return (
    <div ref={ref} className="floor-wheel" role="group" aria-label="Floor">
      <span className="floor-title">Floor</span>
      <div className="floor-wheel-window" style={{ height: visible * ITEM }}>
        <div
          ref={track}
          className="floor-wheel-track"
          style={{ paddingBlock: pad, scrollPaddingBlock: pad }}
          onScroll={onScroll}
          onPointerDown={() => (byUser.current = true)}
          onTouchStart={() => (byUser.current = true)}
          onWheel={() => (byUser.current = true)}
        >
          {floors.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={f === floor}
              aria-label={`Floor ${labelOf(f)}${marked.has(f) ? ', workspaces on this floor' : ''}`}
              className={marked.has(f) ? 'has-library' : undefined}
              onClick={() => {
                byUser.current = false;
                onChange(f);
              }}
            >
              {labelOf(f)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
