import { getMapNavigation } from '../../api/generated';
import {
  validateNavigation,
  type NavigationConfig,
} from '../domain/navigation';

// GET /api/v1/map/navigation: the click-to-zoom areas and buildings.

/** The saved config, or null while none is saved. */
export async function fetchNavigation(): Promise<NavigationConfig | null> {
  const { data, error, response } = await getMapNavigation();
  if (response?.status === 404) return null;
  if (error !== undefined || !response?.ok)
    throw new Error(`Loading navigation failed: ${response?.status}`);
  const errors = validateNavigation(data);
  if (errors.length)
    throw new Error(`The navigation config is invalid:\n${errors.join('\n')}`);
  return data as NavigationConfig;
}
