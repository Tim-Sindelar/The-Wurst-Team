import { Card, Progress, Text } from '@mantine/core';
import { useId, type ReactNode } from 'react';
import { stripeClass, type SeatState } from '../domain/seat';
import { formatCountdown, secondsUntil } from '../hooks/useCountdown';
import { cx } from './cx';
import { SectionLabel } from './SectionLabel';

type TimerCardProps = {
  label: string;
  /** When the countdown reaches zero (client clock). */
  expiresAt: number;
  /** The time to count from, shared by every timer on the screen so they tick together. */
  now: number;
  /** Full length in seconds, for the progress bar. */
  total: number;
  stripe?: SeatState;
  children?: ReactNode;
};

/** Countdown card: label, big ticking time, shrinking bar, optional note and action. */
export function TimerCard({
  label,
  expiresAt,
  now,
  total,
  stripe,
  children,
}: TimerCardProps) {
  const left = Math.min(total, secondsUntil(expiresAt, now));
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
