/** Destination search / pick, start from the live position (or a picked point), route summary. */
import { useEffect, useState } from 'react';
import type { LngLat } from '../geo';
import { cellCenter, type NavData, type NavRoom } from './navData';
import { describe, findRoute, RouteError, type Route, type RoutePoint } from './route';

export type PickTarget = 'from' | 'to' | null;

interface Props {
  nav: NavData | null;
  navError: string | null;
  /** Live position with a floor (BLE fix), used as start unless a start was picked. */
  position: RoutePoint | null;
  start: RoutePoint | null;
  destination: (RoutePoint & { name?: string }) | null;
  setStart: (p: RoutePoint | null) => void;
  setDestination: (p: (RoutePoint & { name?: string }) | null) => void;
  picking: PickTarget;
  setPicking: (p: PickTarget) => void;
  route: Route | null;
  setRoute: (r: Route | null) => void;
  levelLabel: (id: string) => string;
}

export function RoutePanel({ nav, navError, position, start, destination, setStart, setDestination, picking, setPicking, route, setRoute, levelLabel }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<NavRoom[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const from = start ?? position;

  useEffect(() => setHits(nav && query.length >= 2 ? nav.searchRooms(query) : []), [nav, query]);

  // Re-route when the ends change (a live start only after it moved ~10 m).
  const fromKey = from ? `${from.levelId}:${from.lng.toFixed(4)},${from.lat.toFixed(4)}` : '';
  const toKey = destination ? `${destination.levelId}:${destination.lng},${destination.lat}` : '';
  useEffect(() => {
    if (!nav || !from || !destination) {
      setRoute(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    findRoute(nav, from, destination)
      .then((r) => !cancelled && setRoute(r))
      .catch((e: Error) => {
        if (cancelled) return;
        setRoute(null);
        setError(e instanceof RouteError ? e.message : `Routing failed: ${e.message}`);
      })
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, fromKey, toKey]);

  if (navError) return <p className="muted">{navError}</p>;
  if (!nav) return <p className="muted">Loading navigation data…</p>;

  const chooseRoom = (r: NavRoom) => {
    const info = nav.level(r[2])!;
    setDestination({ ...cellCenter(info, nav.cell, r[3], r[4]), levelId: r[2], name: r[0] });
    setQuery('');
    setHits([]);
  };
  const fmt = (p: LngLat & { levelId: string; name?: string }) => p.name ?? `${levelLabel(p.levelId)} (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`;

  return (
    <div className="route-panel">
      <div className="route-row">
        <span className="route-label">From</span>
        <span className="route-value">{start ? fmt(start) : position ? `my position (${levelLabel(position.levelId)})` : 'no position yet'}</span>
        <button className={picking === 'from' ? 'active' : ''} onClick={() => setPicking(picking === 'from' ? null : 'from')}>Pick</button>
        {start && <button onClick={() => setStart(null)} title="Use my position">×</button>}
      </div>
      <div className="route-row">
        <span className="route-label">To</span>
        <span className="route-value">{destination ? fmt(destination) : 'search a room or pick on the map'}</span>
        <button className={picking === 'to' ? 'active' : ''} onClick={() => setPicking(picking === 'to' ? null : 'to')}>Pick</button>
        {destination && <button onClick={() => setDestination(null)} title="Clear">×</button>}
      </div>
      <input className="route-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Room, e.g. HG E 41 or CAB G 61" />
      {hits.length > 0 && (
        <ul className="route-hits">
          {hits.map((r) => (
            <li key={`${r[0]}-${r[2]}`}>
              <button onClick={() => chooseRoom(r)}>
                <b>{r[0]}</b> <span className="muted">{r[1]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picking && <p className="muted">Tap the map to set the {picking === 'from' ? 'start' : 'destination'} (on the floor shown).</p>}
      {busy && <p className="muted">Routing…</p>}
      {error && <p className="route-error">{error}</p>}
      {route && !busy && (
        <div className="route-summary">
          <b>{Math.round(route.length)} m</b> · about {Math.max(1, Math.round(route.seconds / 60))} min
          <ol>
            {describe(route, levelLabel).map((line, k) => (
              <li key={k}>{line}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
