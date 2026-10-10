import { useEffect, useRef, useState } from 'react';
import { fetchDataset, fetchDatasetList } from './repository';
import type { DatasetMeta, DatasetResponse } from './types';

const MIN_POLL_MS = 30_000;
const MAX_POLL_MS = 10 * 60_000;
const REFRESHING_POLL_MS = 3_000;
const RETRY_MS = 60_000;

/** Which datasets are on and which amenity categories are hidden. Kept per browser. */
export interface DatasetSettings {
  enabled: string[];
  hiddenCategories: Record<string, string[]>;
}

const KEY = 'dataset-settings';

export function loadDatasetSettings(): DatasetSettings | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { enabled: [], hiddenCategories: {}, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

export function saveDatasetSettings(s: DatasetSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

export function useDatasetList() {
  const [list, setList] = useState<DatasetMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchDatasetList().then(setList, (err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);
  return { list, error };
}

export interface DatasetState {
  response: DatasetResponse | null;
  error: string | null;
  loading: boolean;
}

/**
 * The enabled datasets, each polled at its own pace: its ttl (the server
 * fetches again then), faster while the server is fetching.
 */
export function useDatasets(metas: DatasetMeta[] | null, enabled: string[]) {
  const [states, setStates] = useState<Record<string, DatasetState>>({});
  const [reloadNonce, setReloadNonce] = useState<Record<string, number>>({});
  const key = enabled.join(',');
  /** Reload requests already sent, so a reload of one dataset doesn't force the others. */
  const handled = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!metas) return;
    const timers: number[] = [];
    let cancelled = false;
    for (const id of enabled) {
      const meta = metas.find((m) => m.id === id);
      if (!meta) continue;
      let timer: number | undefined;
      const load = async (force: boolean) => {
        setStates((prev) => ({ ...prev, [id]: { response: prev[id]?.response ?? null, error: prev[id]?.error ?? null, loading: true } }));
        let delay = Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, meta.ttlSeconds * 1000));
        try {
          const r = await fetchDataset(id, force);
          if (cancelled) return;
          setStates((prev) => ({ ...prev, [id]: { response: r, error: null, loading: false } }));
          if (r.refreshing) delay = REFRESHING_POLL_MS;
        } catch (err) {
          if (cancelled) return;
          setStates((prev) => ({ ...prev, [id]: { response: prev[id]?.response ?? null, error: err instanceof Error ? err.message : String(err), loading: false } }));
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
  const reload = (id: string) => setReloadNonce((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  return { states, reload };
}
