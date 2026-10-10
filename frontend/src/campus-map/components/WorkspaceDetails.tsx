import type { ReactNode } from 'react';
import type { Library, OccupancyData } from '../domain/types';
import { WORKSPACE_KIND_LABELS } from '../domain/types';
import {
  dayOf,
  isOpenDuring,
  minutesOf,
  summarizeHours,
} from '../domain/hours';
import { occupancyOf, seatsOfTable, tablesOf } from '../domain/operations';
import type { Selection } from '../state';
import { OccupancyBar } from './OccupancyBar';
import {
  libraryFloorLabel,
  levelName,
  type LevelInfo,
} from '../floors/floorData';

/** The popup of a workspace: its facts, seats and tables; `children` (photos, live rooms, mensa) go below the facts. */
export function WorkspaceDetails({
  data,
  library,
  selection,
  onSelectTable,
  levels,
  children,
}: {
  data: OccupancyData;
  library: Library;
  /** The floor plan levels, for the floor letter; empty while loading. */
  levels: LevelInfo[];
  selection: Selection;
  onSelectTable: (libraryId: string, tableId: string) => void;
  children?: ReactNode;
}) {
  const occ = occupancyOf(data, library.id);
  const tables = tablesOf(data, library.id);
  return (
    <section className="panel-section details">
      <dl>
        <dt>Type</dt>
        <dd>{WORKSPACE_KIND_LABELS[library.kind]}</dd>
        <dt>Address</dt>
        <dd>{library.address ?? 'not published'}</dd>
        {library.floor !== null && (
          <>
            <dt>Floor</dt>
            <dd>
              {libraryFloorLabel(
                {
                  floor: library.floor,
                  levelId: library.levelId,
                  facilityId: library.facilityId,
                },
                levels,
              )}
              {library.levelId && ` · ${levelName(library.levelId)}`}
            </dd>
          </>
        )}
        <dt>Hours</dt>
        <dd>
          {library.openingHours ? (
            <HoursTable hours={library.openingHours} />
          ) : (
            'not published'
          )}
        </dd>
        {library.cardAccess24h && (
          <>
            <dt>Access</dt>
            <dd>24h with ETH card</dd>
          </>
        )}
        {library.availabilityNote && (
          <>
            <dt>Availability</dt>
            <dd>{library.availabilityNote}</dd>
          </>
        )}
        {library.description && (
          <>
            <dt>About</dt>
            <dd>{library.description}</dd>
          </>
        )}
      </dl>
      {children}
      <OccupancyBar free={occ.free} total={occ.total} large />
      {tables.length > 0 && (
        <ul className="table-grid">
          {tables.map((t) => {
            const seats = seatsOfTable(data, t.id);
            const free = seats.filter((s) => s.status === 'free').length;
            return (
              <li key={t.id}>
                <button
                  className={`chip${t.id === selection.tableId ? ' is-active' : ''}`}
                  onClick={() => onSelectTable(library.id, t.id)}
                >
                  {t.label}{' '}
                  <span className="muted">
                    {free}/{seats.length}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {library.sourceUrl && (
        <a
          className="source"
          href={library.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          Source ↗
        </a>
      )}
    </section>
  );
}

function HoursTable({
  hours,
}: {
  hours: NonNullable<Library['openingHours']>;
}) {
  const today = dayOf(new Date());
  const open = isOpenDuring(hours, today, minutesOf(new Date()));
  return (
    <>
      <strong>{open ? 'Open now' : 'Closed now'}</strong>
      <div className="hours-table">
        {summarizeHours(hours).map((g) => (
          <HoursRow
            key={g.label}
            label={g.label}
            text={g.text}
            isToday={g.days.includes(today)}
          />
        ))}
      </div>
    </>
  );
}

function HoursRow({
  label,
  text,
  isToday,
}: {
  label: string;
  text: string;
  isToday: boolean;
}) {
  return (
    <>
      <span className={isToday ? 'today' : undefined}>{label}</span>
      <span className={isToday ? 'today' : undefined}>{text}</span>
    </>
  );
}
