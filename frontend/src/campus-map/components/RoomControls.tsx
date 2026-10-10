import {
  duration,
  zurichTime,
  type EthRoomsResponse,
} from '../domain/ethRooms';
import { ROOM_FEATURE_LABELS, type RoomFeatures } from '../roomFeatures';

/** Live room mode switch, for the render bar on the map. */
export function RoomModeButton({
  features,
  onChange,
  open,
  onOpen,
  busy,
}: {
  features: RoomFeatures;
  onChange: (f: RoomFeatures) => void;
  open: boolean;
  onOpen: (open: boolean) => void;
  /** Data is being fetched from ETH. */
  busy: boolean;
}) {
  return (
    <>
      <button
        className={`style-toggle live-toggle${features.enabled ? ' is-active' : ''}`}
        aria-pressed={features.enabled}
        title="Live room occupancy from the ETH room bookings"
        onClick={() => {
          onChange({ ...features, enabled: !features.enabled });
          onOpen(!features.enabled);
        }}
      >
        <i className={`live-dot${busy ? ' is-busy' : ''}`} /> Live rooms
      </button>
      {features.enabled && (
        <button
          className={`btn-ghost style-toggle${open ? ' is-active' : ''}`}
          aria-expanded={open}
          onClick={() => onOpen(!open)}
        >
          Rooms ▾
        </button>
      )}
    </>
  );
}

/** What live room mode shows, the state of the ETH data and how well it matched the floor plans. */
export function RoomPanel({
  features,
  onChange,
  response,
  error,
  floorPlans,
}: {
  features: RoomFeatures;
  onChange: (f: RoomFeatures) => void;
  response: EthRoomsResponse | null;
  error: string | null;
  /** Floor plans loaded in the app (rooms can only be colored with them). */
  floorPlans: boolean;
}) {
  const snap = response?.snapshot ?? null;
  const total = snap?.rooms.length ?? 0;
  const placed = total - (response?.unmatched.length ?? 0);
  return (
    <div className="style-panel room-panel">
      <section>
        <h3>ETH room bookings</h3>
        <DataStatus response={response} error={error} />
      </section>
      <section>
        <h3>Show</h3>
        {(
          Object.keys(
            ROOM_FEATURE_LABELS,
          ) as (keyof typeof ROOM_FEATURE_LABELS)[]
        ).map((key) => (
          <label
            key={key}
            className="check feature"
            title={ROOM_FEATURE_LABELS[key].hint}
          >
            <input
              type="checkbox"
              checked={features[key]}
              onChange={(e) =>
                onChange({ ...features, [key]: e.target.checked })
              }
            />
            <span>
              {ROOM_FEATURE_LABELS[key].label}{' '}
              <span className="muted">· {ROOM_FEATURE_LABELS[key].hint}</span>
            </span>
          </label>
        ))}
        {features.occupancy && (
          <label className="slider">
            <span>Booked soon</span>
            <input
              type="range"
              min={0}
              max={120}
              step={5}
              value={features.soonMinutes}
              onChange={(e) =>
                onChange({ ...features, soonMinutes: Number(e.target.value) })
              }
            />
            <output>{features.soonMinutes}′</output>
          </label>
        )}
        <p className="note">
          Statuses come from bookings, not sensors: a free room may still be in
          use.
        </p>
      </section>
      {snap && (
        <section>
          <h3>Rooms on the map</h3>
          {!floorPlans || !response?.floorPlans ? (
            <p className="note">
              No floor plans: run scraper/extract_floors.py to place rooms on
              the map.
            </p>
          ) : (
            <p className="note">
              {placed} of {total} ETH rooms found on the floor plans by their
              room number.
            </p>
          )}
          {response && response.unmatched.length > 0 && response.floorPlans && (
            <details>
              <summary className="note">
                {response.unmatched.length} not found
              </summary>
              <p className="note unmatched">{response.unmatched.join(', ')}</p>
            </details>
          )}
        </section>
      )}
    </div>
  );
}

function DataStatus({
  response,
  error,
}: {
  response: EthRoomsResponse | null;
  error: string | null;
}) {
  const snap = response?.snapshot;
  if (!response)
    return (
      <p className="note">
        {error ? <span className="error-text">{error}</span> : 'Loading…'}
      </p>
    );
  return (
    <>
      {response.state === 'running' && (
        <div className="fetch-progress">
          <span className="note">
            Fetching today's bookings from ETH… {response.done} /{' '}
            {response.total || '?'} rooms
          </span>
          <div className="occ-track">
            <span
              className="occ-fill"
              style={{
                width: `${response.total ? (100 * response.done) / response.total : 0}%`,
              }}
            />
          </div>
        </div>
      )}
      {snap && (
        <p className="note">
          Bookings of {snap.date}, fetched {zurichTime(snap.fetchedAt)}
          {response.ageSeconds != null &&
            ` (${duration(Math.round(response.ageSeconds / 60))} ago)`}
          .{' '}
          {response.state !== 'running' &&
            response.nextFetchInSeconds != null &&
            (response.nextFetchInSeconds > 0
              ? `Next update in ${duration(Math.ceil(response.nextFetchInSeconds / 60))}.`
              : 'Update due.')}
          {snap.errors > 0 && ` ${snap.errors} rooms failed to load.`}
        </p>
      )}
      {(response.error || error) && (
        <p className="note error-text">
          {error ?? `Last update failed: ${response.error}`}
        </p>
      )}
    </>
  );
}
