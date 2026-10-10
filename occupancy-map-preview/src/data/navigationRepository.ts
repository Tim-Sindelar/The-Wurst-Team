import { validateNavigation, type NavigationConfig } from '../domain/navigation';

// GET/PUT {base}/navigation, served from data/navigation.json by the dev API.

const NAVIGATION_URL = `${import.meta.env.VITE_API_BASE ?? '/api'}/navigation`;

/** The saved config, or null while navigation.json doesn't exist. */
export async function fetchNavigation(): Promise<NavigationConfig | null> {
  const res = await fetch(NAVIGATION_URL, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Loading navigation failed: ${res.status} ${await res.text()}`);
  const config: unknown = await res.json();
  const errors = validateNavigation(config);
  if (errors.length) throw new Error(`navigation.json is invalid:\n${errors.join('\n')}`);
  return config as NavigationConfig;
}

export async function saveNavigation(config: NavigationConfig): Promise<void> {
  const res = await fetch(NAVIGATION_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`Saving navigation failed: ${res.status} ${await res.text()}`);
}
