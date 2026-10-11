import { getMapWorkspaces } from '../../api/generated';
import type { OccupancyData } from '../domain/types';
import { assertOccupancyData } from '../domain/validate';
import { unwrap } from './api';

/**
 * Storage abstraction. The UI only talks to this interface, so swapping where
 * the workspaces come from means writing a new implementation, with no
 * component changes.
 */
export interface OccupancyRepository {
  load(): Promise<OccupancyData>;
}

/**
 * GET /api/v1/map/workspaces: the generated workspaces with the admin edits
 * applied, from Postgres (imported from backend/app/features/campus_map/map-data).
 */
export class HttpRepository implements OccupancyRepository {
  async load(): Promise<OccupancyData> {
    return assertOccupancyData(await unwrap(getMapWorkspaces()));
  }
}

export const repository: OccupancyRepository = new HttpRepository();
