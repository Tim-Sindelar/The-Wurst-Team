import {
  ROOM_STATUS_LABELS,
  ROOM_STATUSES,
  type RoomStatus,
} from '../domain/ethRooms';
import type { OccupancyStyle } from '../map/minimalStyle';
import type { RoomInfo } from '../roomFeatures';

/** Map overlay: status colors with room counts and the time being shown (picked in Map › Date and time). */
export function OccupancyLegend({
  infos,
  colors,
  showColors,
  label,
  note,
}: {
  infos: RoomInfo[];
  colors: OccupancyStyle;
  showColors: boolean;
  /** The time shown, e.g. "Now 14:05" or "Tue 20 Oct 09:00". */
  label: string;
  /** Replaces the counts, e.g. while there is no data for today. */
  note: string | null;
}) {
  const counts = new Map<RoomStatus, number>();
  for (const { state } of infos)
    counts.set(state.status, (counts.get(state.status) ?? 0) + 1);
  return (
    <div className="occ-legend" role="group" aria-label="Room occupancy">
      {note ? (
        <span className="note">{note}</span>
      ) : (
        showColors && (
          <div className="occ-legend-items">
            {ROOM_STATUSES.filter((st) => counts.get(st)).map((st) => (
              <span
                key={st}
                title={`${counts.get(st)} rooms ${ROOM_STATUS_LABELS[st].toLowerCase()}`}
              >
                <i className="status-dot" style={{ background: colors[st] }} />
                {ROOM_STATUS_LABELS[st]} <b>{counts.get(st)}</b>
              </span>
            ))}
          </div>
        )
      )}
      <div className="occ-legend-time">
        <span className="occ-time">{label}</span>
      </div>
    </div>
  );
}
