/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the occupancy API. Defaults to `/api` (the local JSON-file stand-in). */
  readonly VITE_API_BASE?: string;
}
