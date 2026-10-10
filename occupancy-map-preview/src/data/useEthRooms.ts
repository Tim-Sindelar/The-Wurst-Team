import { useEffect, useState } from 'react';
import { zurichClock, type EthRoomsResponse } from '../domain/ethRooms';
import { fetchEthRooms } from './ethRoomsRepository';

const POLL_MS = 5 * 60_000;
const PROGRESS_MS = 2_000;
const RETRY_MS = 30_000;

/**
 * The ETH room data while `enabled`. Asking is cheap: the server answers from
 * its snapshot file and only goes to ETH when that is an hour old, so this
 * polls every few minutes (faster while a fetch is running, and right when the
 * next update is due).
 */
export function useEthRooms(enabled: boolean) {
  const [response, setResponse] = useState<EthRoomsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      let delay = POLL_MS;
      try {
        const r = await fetchEthRooms();
        if (cancelled) return;
        setResponse(r);
        setError(null);
        if (r.state === 'running') delay = PROGRESS_MS;
        else if (r.nextFetchInSeconds != null && r.state === 'ok') delay = Math.min(POLL_MS, (r.nextFetchInSeconds + 5) * 1000);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        delay = RETRY_MS;
      }
      timer = window.setTimeout(load, delay);
    };
    load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled]);
  return { response: enabled ? response : null, error: enabled ? error : null };
}

/** Zurich date and minute of the day, ticking while `enabled`. */
export function useZurichClock(enabled: boolean) {
  const [clock, setClock] = useState(() => zurichClock());
  useEffect(() => {
    if (!enabled) return;
    // Only a new minute (or day) is a new state, so nothing re-renders in between.
    const tick = () => setClock((prev) => {
      const next = zurichClock();
      return next.date === prev.date && next.minute === prev.minute ? prev : next;
    });
    tick();
    const timer = window.setInterval(tick, 20_000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return clock;
}
