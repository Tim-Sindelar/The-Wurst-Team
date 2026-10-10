import { ROOM_STATUS_LABELS, ROOM_STATUSES, type RoomStatus } from '../domain/ethRooms';
import type { OccupancyStyle } from '../map/minimalStyle';
import type { RoomInfo } from '../roomFeatures';

const SLIDER_MIN = 6 * 60;
const SLIDER_MAX = 23 * 60 + 45;

/** Map overlay: status colors with room counts and, optionally, the time being shown. */
export function OccupancyLegend({ infos, colors, showColors, minute, label, live, showSlider, onMinute, note }: {
  infos: RoomInfo[];
  colors: OccupancyStyle;
  showColors: boolean;
  minute: number;
  /** The time shown, e.g. "Now 14:05" or "Tue 20 Oct 09:00". */
  label: string;
  /** Following the clock (no time picked). */
  live: boolean;
  showSlider: boolean;
  /** A minute of the day shown, or null to follow the clock again. */
  onMinute: (minute: number | null) => void;
  /** Replaces the counts, e.g. while there is no data for today. */
  note: string | null;
}) {
  const counts = new Map<RoomStatus, number>();
  for (const { state } of infos) counts.set(state.status, (counts.get(state.status) ?? 0) + 1);
  return (
    <div className="occ-legend" role="group" aria-label="Room occupancy">
      {note ? (
        <span className="note">{note}</span>
      ) : (
        showColors && (
          <div className="occ-legend-items">
            {ROOM_STATUSES.filter((st) => counts.get(st)).map((st) => (
              <span key={st} title={`${counts.get(st)} rooms ${ROOM_STATUS_LABELS[st].toLowerCase()}`}>
                <i className="status-dot" style={{ background: colors[st] }} />
                {ROOM_STATUS_LABELS[st]} <b>{counts.get(st)}</b>
              </span>
            ))}
          </div>
        )
      )}
      <div className="occ-legend-time">
        <span className="occ-time">{label}</span>
        {showSlider && (
          <>
            <input
              type="range"
              min={SLIDER_MIN}
              max={SLIDER_MAX}
              step={15}
              value={Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, minute))}
              aria-label="Time of day"
              onChange={(e) => onMinute(Number(e.target.value))}
            />
            <button className="btn-ghost" disabled={live} onClick={() => onMinute(null)}>
              Now
            </button>
          </>
        )}
      </div>
    </div>
  );
}
