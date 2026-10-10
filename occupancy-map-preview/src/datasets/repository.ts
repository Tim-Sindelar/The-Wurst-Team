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

export const fetchDataset = (id: string, refresh = false) =>
  getJson<DatasetResponse>(`${BASE}/${encodeURIComponent(id)}${refresh ? '?refresh=1' : ''}`);
