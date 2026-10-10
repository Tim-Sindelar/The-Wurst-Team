import { getMapDataset, listMapDatasets } from '../../api/generated';
import { unwrap } from '../data/api';
import type { DatasetMeta, DatasetResponse } from './types';

// GET /api/v1/map/datasets[/<id>]: fetched and cached by the backend.

export const fetchDatasetList = async () =>
  (await unwrap(listMapDatasets())) as DatasetMeta[];

/** `at`: a Zurich time, YYYY-MM-DDTHH:MM; null for now. */
export async function fetchDataset(
  id: string,
  refresh = false,
  at: string | null = null,
) {
  const response = await unwrap(
    getMapDataset({
      path: { dataset_id: id },
      query: { refresh: refresh || undefined, at: at ?? undefined },
    }),
  );
  return response as unknown as DatasetResponse;
}
