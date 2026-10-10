import { UnstyledButton } from '@mantine/core';
import type { MouseEvent } from 'react';
import { seatStateName, stateVar, type SeatState } from '../../domain/seat';
import type { SeatFriend } from '../../features/social/studying';
import { Icon } from '../Icon';

type SeatMarkerProps = {
  id: string;
  label: string;
  state: SeatState;
  /** Centre on the room canvas. */
  x: number;
  y: number;
  /** Rotation of the seat in degrees; the number stays upright. */
  angle?: number;
  /** Seat features, read out after the state ("power outlet"). */
  features?: string[];
  selected: boolean;
  onSelect: () => void;
  /** Who the seat is for in a group booking: their initials replace the number. */
  person?: { initials: string; name: string };
  /** A friend checked in here: their photo or initials, ringed in the accent,
      replace the number. */
  friend?: SeatFriend;
};

/* A seat on the map: a 44px tap target around a 32 × 36 filled seat with its
   number, turned the way the layout places it. On-break seats add a cup badge, bookable seats a clock badge. */
export function SeatMarker({
  id,
  label,
  state,
  x,
  y,
  angle = 0,
  features = [],
  selected,
  onSelect,
  person,
  friend,
}: SeatMarkerProps) {
  const description = [
    `Seat ${label}`,
    ...(person
      ? [`for ${person.name}`]
      : friend
        ? [
            `${friend.name}, your friend`,
            friend.onBreak ? 'on a break' : 'studying here',
          ]
        : [seatStateName[state].toLowerCase()]),
    ...features.map((feature) => feature.toLowerCase()),
    ...(selected ? ['selected'] : []),
  ].join(', ');
  const badge =
    state === 'break' ? 'coffee' : state === 'bookable' ? 'clock' : null;

  /* Pointer taps are handled by the map's pan gesture; this catches Enter and Space. */
  const onClick = (event: MouseEvent) => {
    if (event.detail === 0) onSelect();
  };

  return (
    <UnstyledButton
      className="group absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center text-text focus:outline-none"
      style={{ left: x, top: y }}
      data-seat-id={id}
      data-x={x}
      data-y={y}
      aria-label={description}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span
        className={[
          'col-start-1 row-start-1 h-9 w-8 rounded-control border-2 border-(--state) bg-(--state) group-focus-visible:shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-focus)]',
          stateVar[state],
          selected
            ? 'shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-accent)]'
            : state === 'yours' &&
              'shadow-[0_0_0_2px_var(--color-bg),0_0_0_4px_var(--state)]',
        ]
          .filter(Boolean)
          .join(' ')}
        style={angle ? { rotate: `${angle}deg` } : undefined}
        aria-hidden="true"
      />
      {friend && !person ? (
        <span
          className="relative col-start-1 row-start-1 grid size-7 place-items-center overflow-hidden rounded-full bg-surface text-label leading-none font-bold text-text ring-2 ring-accent"
          aria-hidden="true"
        >
          {friend.photoUrl ? (
            <img
              src={friend.photoUrl}
              alt=""
              className="size-full object-cover"
              draggable={false}
            />
          ) : (
            friend.initials
          )}
        </span>
      ) : (
        <span
          className={`relative col-start-1 row-start-1 text-small leading-none font-bold ${state === 'occupied' ? 'text-on-seat-muted' : 'text-on-seat'}`}
        >
          {person?.initials ?? label}
        </span>
      )}
      {badge && (
        <span
          className="absolute top-0 right-0 grid size-4.5 place-items-center rounded-full border border-border-strong bg-surface text-text"
          aria-hidden="true"
        >
          <Icon name={badge} size="xs" />
        </span>
      )}
    </UnstyledButton>
  );
}
