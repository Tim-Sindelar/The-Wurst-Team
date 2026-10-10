import { useEffect, useRef, useState } from 'react';
import { fetchDataset, fetchDatasetList } from './repository';
import type { DatasetMeta, DatasetResponse } from './types';

const MIN_POLL_MS = 30_000;
const MAX_POLL_MS = 10 * 60_000;
const REFRESHING_POLL_MS = 3_000;
const RETRY_MS = 60_000;

export function useDatasetList() {
  const [list, setList] = useState<DatasetMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchDatasetList().then(setList, (err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, []);
  return { list, error };
}

export interface DatasetState {
  response: DatasetResponse | null;
  error: string | null;
  loading: boolean;
  /** The time asked for (null: now); `response` is always for this time. */
  at: string | null;
}

/**
 * The enabled datasets, each polled at its own pace: its ttl (the server
 * fetches again then), faster while the server is fetching. `atOf` gives the
 * time to ask each dataset for (null: now).
 */
export function useDatasets(
  metas: DatasetMeta[] | null,
  enabled: string[],
  atOf: (meta: DatasetMeta) => string | null,
) {
  const [states, setStates] = useState<Record<string, DatasetState>>({});
  const [reloadNonce, setReloadNonce] = useState<Record<string, number>>({});
  const ats = Object.fromEntries(
    (metas ?? [])
      .filter((m) => enabled.includes(m.id))
      .map((m) => [m.id, atOf(m)]),
  );
  const key = enabled.map((id) => `${id}@${ats[id] ?? ''}`).join(',');
  /** Reload requests already sent, so a reload of one dataset doesn't force the others. */
  const handled = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!metas) return;
    const timers: number[] = [];
    let cancelled = false;
    for (const id of enabled) {
      const meta = metas.find((m) => m.id === id);
      if (!meta) continue;
      const at = ats[id] ?? null;
      let timer: number | undefined;
      const load = async (force: boolean) => {
        // Data for another time than asked for is not shown, not even while loading.
        setStates((prev) => {
          const same = prev[id]?.at === at;
          return {
            ...prev,
            [id]: {
              response: same ? prev[id].response : null,
              error: same ? prev[id].error : null,
              loading: true,
              at,
            },
          };
        });
        let delay = Math.min(
          MAX_POLL_MS,
          Math.max(MIN_POLL_MS, meta.ttlSeconds * 1000),
        );
        try {
          const r = await fetchDataset(id, force, at);
          if (cancelled) return;
          setStates((prev) => ({
            ...prev,
            [id]: { response: r, error: null, loading: false, at },
          }));
          if (r.refreshing) delay = REFRESHING_POLL_MS;
        } catch (err) {
          if (cancelled) return;
          setStates((prev) => ({
            ...prev,
            [id]: {
              response: prev[id]?.response ?? null,
              error: err instanceof Error ? err.message : String(err),
              loading: false,
              at,
            },
          }));
          delay = RETRY_MS;
        }
        timer = window.setTimeout(() => load(false), delay);
        timers.push(timer);
      };
      const force = (reloadNonce[id] ?? 0) > (handled.current[id] ?? 0);
      handled.current[id] = reloadNonce[id] ?? 0;
      load(force);
    }
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [metas, key, reloadNonce]);

  /** Asks the server to fetch a dataset again now. */
  const reload = (id: string) =>
    setReloadNonce((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  return { states, reload };
}
