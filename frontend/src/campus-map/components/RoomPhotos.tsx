import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ethFileUrl,
  fetchRoomSheet,
  sheetImages,
  type RoomSheetFile,
} from '../data/ethRoomsRepository';

/** At most this many rooms are asked for their photos (a workspace can span many rooms). */
const MAX_ROOMS = 4;

interface Photo extends RoomSheetFile {
  room: string;
}

/**
 * Photos of one or more ETH rooms, from their room sheets (fetched when shown,
 * cached for the page). Renders nothing while loading or when there are none.
 */
export function RoomPhotos({
  roomIds,
  title,
}: {
  roomIds: string[];
  /** Names the photos in the enlarged view. */
  title: string;
}) {
  const key = [...new Set(roomIds)].slice(0, MAX_ROOMS).join('|');
  const [loaded, setLoaded] = useState<{ key: string; photos: Photo[] }>({
    key: '',
    photos: [],
  });
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOpen(null);
    const ids = key ? key.split('|') : [];
    // Rooms without a sheet (or not at ETH) just have no photos.
    Promise.all(
      ids.map((id) =>
        fetchRoomSheet(id).then(
          (sheet) => sheetImages(sheet).map((img) => ({ ...img, room: id })),
          () => [] as Photo[],
        ),
      ),
    ).then((lists) => !cancelled && setLoaded({ key, photos: lists.flat() }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  const photos = loaded.key === key ? loaded.photos : [];
  if (!photos.length) return null;
  return (
    <>
      <div className="room-photos">
        {photos.map((img, i) => (
          <button
            key={`${img.room}/${img.id}`}
            type="button"
            className="room-photo"
            onClick={() => setOpen(i)}
            aria-label={`Show photo ${i + 1} of ${img.room} larger`}
          >
            <img
              src={ethFileUrl(img.id)}
              alt={img.altText || img.filename || `Photo of ${img.room}`}
              loading="lazy"
            />
          </button>
        ))}
      </div>
      {open !== null && photos[open] && (
        <Lightbox
          images={photos}
          index={open}
          title={title}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function Lightbox({
  images,
  index,
  title,
  onIndex,
  onClose,
}: {
  images: Photo[];
  index: number;
  title: string;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndex((index + 1) % images.length);
      if (e.key === 'ArrowLeft')
        onIndex((index - 1 + images.length) % images.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, images.length, onIndex, onClose]);
  const img = images[index];
  // On <body>: the sheet's stacking context would keep it below the map.
  return createPortal(
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Photos of ${title}`}
      onClick={onClose}
    >
      <figure onClick={(e) => e.stopPropagation()}>
        <img
          src={ethFileUrl(img.id)}
          alt={img.altText || img.filename || img.room}
        />
        <figcaption>
          <span>
            {img.room} · {index + 1} / {images.length}
            {img.altText && ` · ${img.altText}`}
          </span>
          <span className="row">
            {images.length > 1 && (
              <>
                <button
                  className="btn-ghost"
                  onClick={() =>
                    onIndex((index - 1 + images.length) % images.length)
                  }
                  aria-label="Previous photo"
                >
                  ‹
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => onIndex((index + 1) % images.length)}
                  aria-label="Next photo"
                >
                  ›
                </button>
              </>
            )}
            <a
              className="btn-ghost"
              href={ethFileUrl(img.id)}
              target="_blank"
              rel="noreferrer"
            >
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
