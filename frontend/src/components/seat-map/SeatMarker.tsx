import { UnstyledButton } from '@mantine/core';
import type { MouseEvent } from 'react';
import { seatStateName, stateVar, type SeatState } from '../../domain/seat';
import { Icon } from '../Icon';

type SeatMarkerProps = {
  id: string;
  label: string;
  state: SeatState;
  /** Centre on the room canvas. */
  x: number;
  y: number;
  selected: boolean;
  onSelect: () => void;
};

/* A seat on the map: a 44px tap target around a 32 × 36 filled seat with its
   number. On-break seats add a cup badge, bookable seats a clock badge. */
export function SeatMarker({
  id,
  label,
  state,
  x,
  y,
  selected,
  onSelect,
}: SeatMarkerProps) {
  const description = `Seat ${label}, ${seatStateName[state].toLowerCase()}${selected ? ', selected' : ''}`;
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
          'grid h-9 w-8 place-items-center rounded-control border-2 border-(--state) bg-(--state) text-small leading-none font-bold group-focus-visible:shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-focus)]',
          stateVar[state],
          state === 'occupied' ? 'text-on-seat-muted' : 'text-on-seat',
          selected
            ? 'shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-accent)]'
            : state === 'yours' &&
              'shadow-[0_0_0_2px_var(--color-bg),0_0_0_4px_var(--state)]',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {label}
      </span>
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
