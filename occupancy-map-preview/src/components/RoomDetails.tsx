import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BOOKING_KIND_LABELS, duration, hhmm, isBusy, ROOM_STATUS_LABELS, type Booking } from '../domain/ethRooms';
import { ethFileUrl, fetchRoomSheet, officialRoomUrl, type RoomSheet, type RoomSheetFile } from '../data/ethRoomsRepository';
import type { OccupancyStyle } from '../map/minimalStyle';
import type { RoomInfo } from '../roomFeatures';

const DAY_START = 7 * 60;
const DAY_END = 22 * 60;

/** Side panel card of one ETH room: status, today's schedule, photos and the official room sheet. */
export function RoomDetails({ info, buildingName, minute, colors, onClose, onShowOnMap }: {
  info: RoomInfo;
  buildingName: string | null;
  minute: number;
  colors: OccupancyStyle;
  onClose: () => void;
  /** Null when the room isn't on the floor plans. */
  onShowOnMap: (() => void) | null;
}) {
  const { room, state } = info;
  const [sheet, setSheet] = useState<{ id: string; data: RoomSheet | null; error: string | null } | null>(null);
  const [photo, setPhoto] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSheet(null);
    setPhoto(null);
    fetchRoomSheet(room.id).then(
      (data) => !cancelled && setSheet({ id: room.id, data, error: null }),
      (err) => !cancelled && setSheet({ id: room.id, data: null, error: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [room.id]);

  const images: RoomSheetFile[] = [];
  const docs: RoomSheetFile[] = [];
  for (const tab of sheet?.data?.tabs ?? []) {
    for (const [kind, files] of Object.entries(tab.attachments ?? {})) for (const f of files ?? []) (kind === 'images' ? images : docs).push(f);
  }

  const seats = room.seats != null ? `${room.seats} seats` : room.workplaces != null ? `${room.workplaces} workplaces` : 'seats not listed';
  const statusText =
    state.status === 'busy'
      ? `In use until ${hhmm(state.until)}`
      : state.status === 'closed'
        ? `Building closed until ${hhmm(state.until)}`
        : state.status === 'unknown'
          ? 'No booking data'
          : state.until >= 1440
            ? 'Free for the rest of the day'
            : `Free until ${hhmm(state.until)} (${duration(state.until - minute)})`;
  const shown = room.bookings.filter((b) => b.kind !== 'closed');

  return (
    <section className="panel-section details room-details">
      <div className="section-head">
        <h2>{room.id}</h2>
        <button className="btn-icon" aria-label="Close room details" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="note">
        {room.type} · {seats}
        {buildingName && ` · ${buildingName}`}
        {room.campus && ` · ${room.campus}`}
      </p>
      <div className="room-status" style={{ borderColor: colors[state.status] }}>
        <i className="status-dot" style={{ background: colors[state.status] }} />
        <div>
          <strong>{ROOM_STATUS_LABELS[state.status]}</strong> · {statusText}
          {state.current && state.status === 'busy' && <div className="note">{bookingTitle(state.current)}</div>}
          {state.next && state.status !== 'busy' && <div className="note">Next: {hhmm(state.next.s)} {bookingTitle(state.next)}</div>}
        </div>
      </div>

      {images.length > 0 && (
        <div className="room-photos">
          {images.map((img, i) => (
            <button key={img.id} className="room-photo" onClick={() => setPhoto(i)} title={img.altText || 'Show larger'}>
              <img src={ethFileUrl(img.id)} alt={img.altText || img.filename || `Photo ${i + 1} of ${room.id}`} loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {sheet === null && <p className="note">Loading room sheet…</p>}
      {sheet?.error && <p className="note error-text">Room sheet unavailable: {sheet.error}</p>}

      <h3 className="sub-head">Today</h3>
      <DayBar bookings={room.bookings} minute={minute} colors={colors} />
      {shown.length === 0 ? (
        <p className="note">No bookings today.</p>
      ) : (
        <ul className="booking-list">
          {shown.map((b, i) => (
            <li key={i} className={`${b.kind === 'cancelled' ? 'is-cancelled' : ''}${b.s <= minute && minute < b.e ? ' is-now' : ''}`}>
              <span className="booking-time">
                {hhmm(b.s)}–{hhmm(b.e)}
              </span>
              <span>
                {bookingTitle(b)}
                {b.organiser && <span className="muted"> · {b.organiser}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {room.equipment.length > 0 && (
        <>
          <h3 className="sub-head">Equipment</h3>
          <ul className="table-grid">
            {room.equipment.map((e) => (
              <li key={e}>
                <span className="chip">{e}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {sheet?.data && (
        <details className="room-sheet">
          <summary>All room details</summary>
          {(sheet.data.tabs ?? []).filter((t) => t.attributes?.length).map((tab, i) => (
            <div key={i}>
              <h3 className="sub-head">{tab.title || 'Other'}</h3>
              <dl>
                {tab.attributes!.map((a, j) => (
                  <div key={j} className="sheet-row">
                    <dt>{a.label}</dt>
                    <dd>
                      {a.isAttachment && a.attachmentId != null ? (
                        <a href={ethFileUrl(a.attachmentId)} target="_blank" rel="noreferrer">
                          {a.name || 'File'}
                        </a>
                      ) : (
                        a.value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          {sheet.data.orgunits && sheet.data.orgunits.length > 0 && <p className="note">Managed by {sheet.data.orgunits.map((o) => o.name).join(', ')}</p>}
        </details>
      )}
      {docs.length > 0 && (
        <p className="note">
          Attachments:{' '}
          {docs.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ' · '}
              <a href={ethFileUrl(d.id)} target="_blank" rel="noreferrer">
                {d.filename || `File ${d.id}`}
              </a>
            </span>
          ))}
        </p>
      )}

      <div className="row room-actions">
        {onShowOnMap && (
          <button className="btn" onClick={onShowOnMap}>
            Show on map
          </button>
        )}
        <a className="source" href={officialRoomUrl(room.id)} target="_blank" rel="noreferrer">
          ETH room page ↗
        </a>
      </div>

      {photo !== null && images[photo] && (
        <Lightbox images={images} index={photo} title={room.id} onIndex={setPhoto} onClose={() => setPhoto(null)} />
      )}
    </section>
  );
}

const bookingTitle = (b: Booking) => `${b.title || BOOKING_KIND_LABELS[b.kind]}${b.number ? ` (${b.number})` : ''}${b.kind === 'cancelled' ? ' · cancelled' : ''}`;

/** Today from 07:00 to 22:00 with the bookings, closed hours and the time shown. */
function DayBar({ bookings, minute, colors }: { bookings: Booking[]; minute: number; colors: OccupancyStyle }) {
  const x = (m: number) => `${(100 * (Math.min(DAY_END, Math.max(DAY_START, m)) - DAY_START)) / (DAY_END - DAY_START)}%`;
  const w = (b: Booking) => `${(100 * (Math.min(DAY_END, b.e) - Math.max(DAY_START, b.s))) / (DAY_END - DAY_START)}%`;
  const inDay = bookings.filter((b) => b.e > DAY_START && b.s < DAY_END && (isBusy(b) || b.kind === 'closed'));
  return (
    <div className="day-bar" aria-hidden="true">
      <div className="day-track" style={{ background: colors.free }}>
        {inDay.map((b, i) => (
          <span
            key={i}
            className={b.kind === 'closed' ? 'day-closed' : 'day-busy'}
            style={{ left: x(b.s), width: w(b), background: b.kind === 'closed' ? colors.closed : colors.busy }}
            title={`${hhmm(b.s)}–${hhmm(b.e)} ${b.title ?? BOOKING_KIND_LABELS[b.kind]}`}
          />
        ))}
        {minute >= DAY_START && minute <= DAY_END && <span className="day-now" style={{ left: x(minute) }} />}
      </div>
      <div className="day-axis">
        {[7, 10, 13, 16, 19, 22].map((h) => (
          <span key={h} style={{ left: x(h * 60) }}>
            {h}
          </span>
        ))}
      </div>
    </div>
  );
}

function Lightbox({ images, index, title, onIndex, onClose }: {
  images: RoomSheetFile[];
  index: number;
  title: string;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndex((index + 1) % images.length);
      if (e.key === 'ArrowLeft') onIndex((index - 1 + images.length) % images.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, images.length, onIndex, onClose]);
  const img = images[index];
  // On <body>: the side panel's stacking context would keep it below the map.
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Photos of ${title}`} onClick={onClose}>
      <figure onClick={(e) => e.stopPropagation()}>
        <img src={ethFileUrl(img.id)} alt={img.altText || img.filename || title} />
        <figcaption>
          <span>
            {title} · {index + 1} / {images.length}
            {img.altText && ` · ${img.altText}`}
          </span>
          <span className="row">
            {images.length > 1 && (
              <>
                <button className="btn-ghost" onClick={() => onIndex((index - 1 + images.length) % images.length)} aria-label="Previous photo">
                  ‹
                </button>
                <button className="btn-ghost" onClick={() => onIndex((index + 1) % images.length)} aria-label="Next photo">
                  ›
                </button>
              </>
            )}
            <a className="btn-ghost" href={ethFileUrl(img.id)} target="_blank" rel="noreferrer">
              Full size ↗
            </a>
            <button className="btn-ghost" onClick={onClose}>
              Close
            </button>
          </span>
        </figcaption>
      </figure>
    </div>,
    document.body,
  );
}
