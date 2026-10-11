import { AppMark } from './AppName';

/** Transparent loading indicator shared by the lazy map and its initial data. */
export function MapLoading() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-1200 grid place-items-center"
      role="status"
      aria-label="Loading campus map"
    >
      <div
        className="relative grid size-24 place-items-center"
        aria-hidden="true"
      >
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-border-strong border-t-accent motion-reduce:animate-none" />
        <AppMark className="size-12" />
      </div>
    </div>
  );
}
