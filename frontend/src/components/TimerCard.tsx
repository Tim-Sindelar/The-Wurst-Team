import { Card, Progress, Text } from '@mantine/core';
import { useId, type ReactNode } from 'react';
import { stripeClass, type SeatState } from '../domain/seat';
import { formatCountdown, useCountdown } from '../hooks/useCountdown';
import { cx } from './cx';
import { SectionLabel } from './SectionLabel';

type TimerCardProps = {
  label: string;
  /** Seconds left when the card appears. */
  seconds: number;
  /** Full length, for the progress bar. */
  total: number;
  stripe?: SeatState;
  children?: ReactNode;
};

/** Countdown card: label, big ticking time, shrinking bar, optional note and action. */
export function TimerCard({
  label,
  seconds,
  total,
  stripe,
  children,
}: TimerCardProps) {
  const left = useCountdown(seconds);
  const labelId = useId();

  return (
    <Card
      component="section"
      aria-labelledby={labelId}
      className={cx(stripe && stripeClass[stripe])}
    >
      <SectionLabel as="p" id={labelId}>
        {label}
      </SectionLabel>
      <Text className="text-timer tabular-nums">{formatCountdown(left)}</Text>
      <Progress value={(left / total) * 100} aria-label={label} />
      {children}
    </Card>
  );
}
