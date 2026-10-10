import { Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { cx } from './cx';
import type { Availability } from '../domain/space';

const level: Record<Availability, string> = {
  high: '[--level:var(--color-avail-high)]',
  mid: '[--level:var(--color-avail-mid)]',
  none: '[--level:var(--color-avail-none)]',
};

type AvailabilityLabelProps = {
  availability: Availability;
  children: ReactNode;
  size?: 'small' | 'body';
};

/** How full a study space is: coloured dot plus the words ("3 free · almost full"). */
export function AvailabilityLabel({
  availability,
  children,
  size = 'body',
}: AvailabilityLabelProps) {
  return (
    <Text
      component="p"
      className={cx(
        "inline-flex items-center gap-2 font-semibold before:size-2.5 before:flex-none before:rounded-full before:bg-(--level) before:content-['']",
        size === 'small' ? 'text-small' : 'text-body',
        level[availability],
      )}
    >
      {children}
    </Text>
  );
}
