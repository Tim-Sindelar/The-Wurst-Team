import type { OccupancyData } from '../domain/types';
import { assertOccupancyData } from '../domain/validate';

/**
 * Storage abstraction. The UI only talks to this interface, so swapping the
 * local JSON file for a real backend means writing a new implementation (or
 * pointing HttpRepository at another base URL) — no component changes.
 */
export interface OccupancyRepository {
  load(): Promise<OccupancyData>;
  save(data: OccupancyData): Promise<void>;
}

/**
 * Talks to `GET/PUT {baseUrl}/occupancy`. In this preview that endpoint is
 * served by the Vite dev-server plugin in `server/jsonFileApi.ts`, which
 * merges `data/generated.json` (pipeline output) with `data/overrides.json`
 * (admin edits) on load, and writes only the overrides on save.
 */
export class HttpRepository implements OccupancyRepository {
  constructor(private readonly baseUrl = '/api') {}

  async load(): Promise<OccupancyData> {
    const res = await fetch(`${this.baseUrl}/occupancy`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Load failed: ${res.status} ${await res.text()}`);
    return assertOccupancyData(await res.json());
  }

  async save(data: OccupancyData): Promise<void> {
    const res = await fetch(`${this.baseUrl}/occupancy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Save failed: ${res.status} ${await res.text()}`);
  }
}

export const repository: OccupancyRepository = new HttpRepository(import.meta.env.VITE_API_BASE ?? '/api');
