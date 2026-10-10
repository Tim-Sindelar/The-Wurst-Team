import { hhmm, ROOM_STATUS_LABELS } from '../domain/ethRooms';
import type { OccupancyStyle } from '../map/minimalStyle';
import type { RoomInfo } from '../roomFeatures';

/**
 * The booking status of the ETH rooms a workspace (or mensa) spans, in its
 * popup. Shown whether or not the live room layer is on; tapping a room opens
 * its own popup with the day's schedule.
 */
export function LiveRooms({
  infos,
  colors,
  note,
  onSelect,
}: {
  infos: RoomInfo[];
  colors: OccupancyStyle;
  /** Shown instead of the list while the room data loads or when it failed. */
  note: string | null;
  onSelect: (ethId: string) => void;
}) {
  if (!infos.length && !note) return null;
  return (
    <>
      <h3 className="sub-head">Room availability</h3>
      {infos.length > 0 ? (
        <ul className="live-rooms">
          {infos.map(({ room, state }) => (
            <li key={room.id}>
              <button type="button" onClick={() => onSelect(room.id)}>
                <i
                  className="status-dot"
                  style={{ background: colors[state.status] }}
                  aria-hidden="true"
                />
                <span className="live-room-text">
                  <strong>{room.id}</strong>
                  <span className="muted">
                    {ROOM_STATUS_LABELS[state.status]}
                    {statusDetail(state)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">{note}</p>
      )}
    </>
  );
}

function statusDetail(state: RoomInfo['state']) {
  if (state.status === 'unknown') return '';
  return state.until >= 1440
    ? ' for the rest of the day'
    : ` until ${hhmm(state.until)}`;
}
