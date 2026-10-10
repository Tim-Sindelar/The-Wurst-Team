export function OccupancyBar({
  free,
  total,
  large,
}: {
  free: number;
  total: number;
  large?: boolean;
}) {
  if (total === 0)
    return <span className="occ-empty">No seats registered</span>;
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
