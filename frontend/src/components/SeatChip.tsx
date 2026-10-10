import { Badge } from '@mantine/core';
import type { ReactNode } from 'react';
import { seatStateName, stateVar, type SeatState } from '../domain/seat';
import { Icon } from './Icon';

type SeatChipProps = {
  state: SeatState;
  /** Text only, no marker (when the card stripe already shows the state). */
  plain?: boolean;
  children?: ReactNode;
};

/* Seat state chip: tinted background plus a marker in the state colour.
   On break shows a cup, bookable a clock, yours a ringed dot, others a dot. */
export function SeatChip({ state, plain = false, children }: SeatChipProps) {
  let marker: ReactNode = null;
  if (!plain) {
    if (state === 'break' || state === 'bookable') {
      marker = (
        <Icon
          name={state === 'break' ? 'coffee' : 'clock'}
          width={14}
          height={14}
          className="text-(--state)"
        />
      );
    } else {
      marker = (
        <span
          className={
            state === 'yours'
              ? 'mx-0.5 size-2.5 rounded-full bg-(--state) shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--state)]'
              : 'size-2.5 rounded-full bg-(--state)'
          }
        />
      );
    }
  }

  return (
    <Badge className={stateVar[state]} leftSection={marker}>
      {children ?? seatStateName[state]}
    </Badge>
  );
}
