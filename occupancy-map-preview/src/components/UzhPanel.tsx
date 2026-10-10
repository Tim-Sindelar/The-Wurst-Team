import { useCallback, useEffect, useState } from 'react';
import { fetchUzh, type UzhLocation } from '../data/ethRoomsRepository';
import { zurichTime } from '../domain/ethRooms';

const REFRESH_MS = 5 * 60_000;

/** Live study space occupancy of the UZH libraries (sensor based), the nearest public live seat data. */
export function UzhPanel() {
  const [data, setData] = useState<{ fetchedAt: string; source: string; locations: UzhLocation[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetchUzh().then(
      (d) => {
        setData(d);
        setError(null);
      },
      (err) => setError(err instanceof Error ? err.message : String(err)),
    );
  }, []);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <details className="panel-section collapsible" open>
      <summary>
        <h2>UZH libraries <span className="muted">(live)</span></h2>
      </summary>
      {error && <p className="note error-text">{error}</p>}
      {!data && !error && <p className="note">Loading…</p>}
      {data && (
        <>
          <ul className="uzh-list">
            {data.locations.map((l) => (
              <li key={l.id}>
                <span className="list-title">{l.name}</span>
                <span className="occ">
                  <span className="occ-track">
                    <span className="occ-fill uzh-fill" style={{ width: `${Math.round((l.fraction ?? 0) * 100)}%` }} />
                  </span>
                  <span className="occ-label">{l.label || '–'}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="note">
            Sensor data, updated {zurichTime(data.fetchedAt)} ·{' '}
            <a href={data.source} target="_blank" rel="noreferrer">
              UZH ↗
            </a>
          </p>
        </>
      )}
    </details>
  );
}
