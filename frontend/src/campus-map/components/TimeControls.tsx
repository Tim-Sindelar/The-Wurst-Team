import { hhmm } from '../domain/ethRooms';
import { addDays, dayLabel, type ZurichTime } from '../domain/viewTime';
import type { DatasetMeta, TimeSupport } from '../datasets/types';

/** "Today 14:00", "Tue 20 Oct 09:15" */
export const timeLabel = (t: ZurichTime, today: string) =>
  `${dayLabel(t.date, today)} ${hhmm(t.minute)}`;

/** Time switch for the render bar on the map: "Now" or the time picked. */
export function TimeButton({
  view,
  now,
  open,
  onOpen,
}: {
  /** null: following the clock. */
  view: ZurichTime | null;
  now: ZurichTime;
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  return (
    <button
      className={`style-toggle time-toggle${view ? ' is-active' : ''}${open ? ' is-open' : ''}`}
      aria-expanded={open}
      title="Show rooms and campus data at another date and time"
      onClick={() => onOpen(!open)}
    >
      🕒 {view ? timeLabel(view, now.date) : 'Now'} ▾
    </button>
  );
}

export const SUPPORT_LABELS: Record<
  TimeSupport,
  { mark: string; label: string }
> = {
  full: { mark: '✓', label: 'Any time' },
  partial: { mark: '◐', label: 'Partly' },
  live: { mark: '✕', label: 'Now only' },
};

/** One row per source: can it show the picked time? */
interface Source {
  id: string;
  title: string;
  support: TimeSupport;
  note: string;
  /** Shown on the map right now. */
  on: boolean;
  /** The picked time is known to be out of the source's range. */
  outOfRange?: boolean;
}

/** Date and time to show, and which sources can show it. */
export function TimePanel({
  view,
  now,
  onChange,
  metas,
  enabledDatasets,
  rooms,
  roomWindow,
}: {
  view: ZurichTime | null;
  now: ZurichTime;
  /** null: back to now. */
  onChange: (t: ZurichTime | null) => void;
  metas: DatasetMeta[] | null;
  enabledDatasets: string[];
  /** Live room mode is on. */
  rooms: boolean;
  /** Days ETH has room bookings for. */
  roomWindow: { min: string | null; max: string | null } | null;
}) {
  const t = view ?? now;
  const set = (patch: Partial<ZurichTime>) => onChange({ ...t, ...patch });
  const shift = (minutes: number) => {
    const total = t.minute + minutes;
    const days = Math.floor(total / 1440);
    onChange({ date: addDays(t.date, days), minute: total - days * 1440 });
  };
  const outOfWindow =
    !!roomWindow?.min &&
    !!roomWindow.max &&
    (t.date < roomWindow.min || t.date > roomWindow.max);
  const sources: Source[] = [
    {
      id: 'rooms',
      title: 'Room bookings (ETH)',
      support: 'partial',
      note: `Any day ETH has bookings for${roomWindow?.min ? ` (${roomWindow.min} to ${roomWindow.max})` : ', about a year back and ahead'}. Bookings, not sensors.`,
      on: rooms,
      outOfRange: outOfWindow,
    },
    {
      id: 'uzh',
      title: 'UZH library seats',
      support: 'live',
      note: 'Live sensor data only: no history, no forecast.',
      on: rooms,
    },
    ...(metas ?? []).map((m) => ({
      id: m.id,
      title: m.title,
      support: m.time?.support ?? 'live',
      note: m.time?.note ?? 'Live data only.',
      on: enabledDatasets.includes(m.id),
    })),
  ];

  return (
    <div className="style-panel time-panel">
      <section>
        <h3>Show the map at</h3>
        <div className="time-inputs">
          <input
            type="date"
            value={t.date}
            aria-label="Date"
            onChange={(e) => e.target.value && set({ date: e.target.value })}
          />
          <input
            type="time"
            step={900}
            value={hhmm(t.minute)}
            aria-label="Time"
            onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number);
              if (!Number.isNaN(h) && !Number.isNaN(m))
                set({ minute: h * 60 + m });
            }}
          />
          <button
            className="btn-ghost"
            disabled={!view}
            onClick={() => onChange(null)}
          >
            Now
          </button>
        </div>
        <div className="kind-chips">
          <button className="chip" onClick={() => shift(-1440)}>
            −1 day
          </button>
          <button className="chip" onClick={() => shift(-60)}>
            −1 h
          </button>
          <button className="chip" onClick={() => shift(60)}>
            +1 h
          </button>
          <button className="chip" onClick={() => shift(1440)}>
            +1 day
          </button>
        </div>
        <p className="note">
          Zurich time.{' '}
          {view
            ? `Showing ${timeLabel(view, now.date)}.`
            : 'Following the clock.'}
        </p>
      </section>
      <section>
        <h3>Sources at another time</h3>
        <ul className="time-sources">
          {sources.map((s) => {
            const nowOnly = !!view && s.on && s.support === 'live';
            return (
              <li key={s.id} className={s.on ? '' : 'is-off'}>
                <span
                  className={`support support-${s.support}`}
                  title={SUPPORT_LABELS[s.support].label}
                >
                  {SUPPORT_LABELS[s.support].mark}
                </span>
                <span>
                  <span>
                    <strong>{s.title}</strong>{' '}
                    <span className="muted">
                      · {SUPPORT_LABELS[s.support].label}
                    </span>
                  </span>
                  <span className="note">{s.note}</span>
                  {nowOnly && (
                    <span className="note error-text">
                      Shown as it is now, not at the time picked.
                    </span>
                  )}
                  {view && s.on && s.outOfRange && (
                    <span className="note error-text">
                      No data for this date.
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="note">Greyed out: not switched on.</p>
      </section>
    </div>
  );
}
