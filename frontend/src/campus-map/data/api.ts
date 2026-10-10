// The campus map's backend lives in FastAPI under /api/v1/map (see
// backend/app/features/campus_map). JSON endpoints go through the generated
// client; plain URLs (floor plans, room photos) are built from MAP_API.

import { client } from '../../api/client';

export const MAP_API = `${client.getConfig().baseUrl ?? ''}/api/v1/map`;

type Result<T> = { data?: T; error?: unknown; response?: Response };

/** The data of a generated SDK call, or an Error with the API's `detail`. */
export async function unwrap<T>(call: Promise<Result<T>>): Promise<T> {
  const { data, error, response } = await call;
  if (error === undefined && response?.ok) return data as T;
  const detail = (error as { detail?: unknown } | undefined)?.detail;
  throw new Error(
    typeof detail === 'string'
      ? detail
      : `${response?.url ?? 'Request'}: ${response?.status ?? 'failed'}`,
  );
}
