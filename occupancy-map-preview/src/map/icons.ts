import L from 'leaflet';
import type { SeatStatus } from '../domain/types';

export type OccupancyLevel = 'none' | 'ok' | 'low' | 'full';

export const occupancyLevel = (free: number, total: number): OccupancyLevel =>
  total === 0 ? 'none' : free / total > 0.33 ? 'ok' : free > 0 ? 'low' : 'full';

// divIcons are cached by their visual state so react-leaflet doesn't call
// setIcon (and rebuild the DOM node) on every render.
const cache = new Map<string, L.DivIcon>();

function cached(key: string, make: () => L.DivIcon) {
  let icon = cache.get(key);
  if (!icon) {
    icon = make();
    cache.set(key, icon);
  }
  return icon;
}

export function libraryIcon(opts: { free: number; total: number; selected: boolean; approximate: boolean }) {
  const { free, total, selected, approximate } = opts;
  const level = occupancyLevel(free, total);
  const key = `lib|${free}|${total}|${selected}|${approximate}`;
  return cached(key, () =>
    L.divIcon({
      className: '',
      html: `<div class="lib-pin lib-${level}${selected ? ' is-selected' : ''}${approximate ? ' is-approx' : ''}">
               <span>${total === 0 ? '–' : free}</span>
             </div>`,
      iconSize: [34, 42],
      iconAnchor: [17, 42],
      tooltipAnchor: [0, -36],
    }),
  );
}

export function tableIcon(label: string, selected: boolean) {
  return cached(`tbl|${label}|${selected}`, () =>
    L.divIcon({
      className: '',
      html: `<div class="table-marker${selected ? ' is-selected' : ''}">${escapeHtml(label)}</div>`,
      iconSize: [30, 20],
      iconAnchor: [15, 10],
      tooltipAnchor: [0, -10],
    }),
  );
}

export function seatIcon(status: SeatStatus, selected: boolean) {
  return cached(`seat|${status}|${selected}`, () =>
    L.divIcon({
      className: '',
      html: `<div class="seat-marker seat-${status}${selected ? ' is-selected' : ''}"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
      tooltipAnchor: [0, -7],
    }),
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
