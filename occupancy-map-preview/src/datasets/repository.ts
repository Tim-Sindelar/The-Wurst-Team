import type { DatasetMeta, DatasetResponse } from './types';

// GET {base}/datasets[/<id>], answered by server/datasetsApi.ts.

const BASE = `${import.meta.env.VITE_API_BASE ?? '/api'}/datasets`;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `${url}: ${res.status}`);
  return body as T;
}

export const fetchDatasetList = () => getJson<DatasetMeta[]>(BASE);

/** `at`: a Zurich time, YYYY-MM-DDTHH:MM; null for now. */
export function fetchDataset(id: string, refresh = false, at: string | null = null) {
  const q = new URLSearchParams();
  if (refresh) q.set('refresh', '1');
  if (at) q.set('at', at);
  return getJson<DatasetResponse>(`${BASE}/${encodeURIComponent(id)}${q.size ? `?${q}` : ''}`);
}
