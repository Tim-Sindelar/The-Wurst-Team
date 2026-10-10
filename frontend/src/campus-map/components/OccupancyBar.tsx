export function OccupancyBar({
  free,
  total,
  large,
}: {
  free: number;
  total: number;
  large?: boolean;
}) {
  // The workspace data has no seats yet: show nothing rather than a placeholder.
  if (total === 0) return null;
  const pct = Math.round((free / total) * 100);
  return (
    <span className={`occ${large ? ' occ-large' : ''}`}>
      <span className="occ-track">
        <span className="occ-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="occ-label">
        {free}/{total} free
      </span>
    </span>
  );
}
