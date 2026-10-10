import { client } from './generated/client.gen';

client.setConfig({
  baseUrl:
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.BASE_URL.replace(/\/$/, ''),
});

/** A URL for a path on our API ("/api/v1/..."), under the app's base URL (PR previews). */
export const apiUrl = (path: string) =>
  `${client.getConfig().baseUrl ?? ''}${path}`;

export { client };
