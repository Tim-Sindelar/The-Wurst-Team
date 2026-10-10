import { Alert, Button, Card, Text, Title } from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { endReservationMutation } from '../api/generated/@tanstack/react-query.gen';
import { DecisionSheet } from '../components/DecisionSheet';
import { Icon } from '../components/Icon';
import {
  ActionBar,
  Screen,
  ScreenHeader,
  ScreenMain,
} from '../components/Screen';
import { SeatChip } from '../components/SeatChip';
import { TimerCard } from '../components/TimerCard';
import { apiProblem, secondsBetween } from '../domain/booking';
import { stripeClass } from '../domain/seat';
import {
  useMyReservation,
  useRefetchAt,
  useRefreshBooking,
} from '../hooks/useMyReservation';
import { useRules } from '../hooks/useRules';
import { paths } from '../routes';

const header = (
  <ScreenHeader
    title="Your reservation"
    backTo={paths.home}
    backLabel="Back to home"
  />
);

export function ReservationScreen() {
  const navigate = useNavigate();
  const refresh = useRefreshBooking();
  const { query, held, running, toClient } = useMyReservation();
  const { query: rulesQuery, rules } = useRules();
  const end = useMutation(endReservationMutation());
  const [cancelOpen, setCancelOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  /* Count down to the start for a seat booked for later, otherwise to the
     check-in deadline. When the time runs out the server frees the seat. */
  const upcoming = held?.status === 'upcoming';
  const target = held
    ? toClient(upcoming ? held.starts_at : held.check_in_deadline)
    : null;
  const total = held
    ? upcoming
      ? Math.max(1, (rules?.public_reservation_window_minutes ?? 0) * 60)
      : Math.max(1, secondsBetween(held.starts_at, held.check_in_deadline))
    : 1;
  const { refetch } = query;
  useRefetchAt(target, refetch);

  if (query.isError || rulesQuery.isError) {
    return (
      <Screen>
        {header}
        <ScreenMain>
          <Alert
            variant="danger"
            role="alert"
            icon={<Icon name="alert" />}
            title="Couldn't load your reservation"
          >
            <Text size="sm">Check your connection and try again.</Text>
          </Alert>
        </ScreenMain>
        <ActionBar>
          <Button
            fullWidth
            onClick={() => {
              void refetch();
              void rulesQuery.refetch();
            }}
          >
            Try again
          </Button>
        </ActionBar>
      </Screen>
    );
  }

  if (!query.data || !rules) {
    return (
      <Screen>
        {header}
        <ScreenMain>
          <Text c="dimmed" role="status">
            Loading your reservation…
          </Text>
        </ScreenMain>
      </Screen>
    );
  }

  if (!held || target === null) {
    if (leaving) return null;
    return (
      <Screen>
        {header}
        <ScreenMain>
          <Alert title="No active reservation" icon={<Icon name="clock" />}>
            <Text>
              {running
                ? 'You have already checked in. Your session is running.'
                : 'Your reservation has expired or been cancelled. The seat is no longer held for you.'}
            </Text>
          </Alert>
        </ScreenMain>
        <ActionBar>
          <Button
            component={Link}
            to={running ? paths.session : paths.home}
            fullWidth
          >
            {running ? 'Open session' : 'Choose a study space'}
          </Button>
        </ActionBar>
      </Screen>
    );
  }

  const canCheckIn = held.available_actions.includes('check_in');

  const cancel = () =>
    end.mutate(
      { path: { reservation_id: held.id } },
      {
        onSuccess: async () => {
          setLeaving(true);
          await refresh();
          navigate(paths.home);
        },
      },
    );

  const closeSheet = () => {
    setCancelOpen(false);
    end.reset();
  };

  return (
    <Screen>
      {header}

      <ScreenMain>
        <Card
          component="section"
          className={stripeClass.reserved}
          aria-labelledby="seat-title"
        >
          <div className="flex items-center justify-between gap-2">
            <Title order={2} id="seat-title" className="text-heading">
              Seat {held.seat.label}
            </Title>
            <SeatChip state="reserved" plain />
          </div>
          <Text c="dimmed" className="flex items-center gap-2">
            <Icon name="pin" size="sm" /> {held.space.name}
          </Text>
        </Card>

        <TimerCard
          label={upcoming ? 'Your time starts in' : 'Check in within'}
          seconds={total}
          expiresAt={target}
          total={total}
        >
          <Text size="sm" c="dimmed">
            {upcoming
              ? `The current session is about to end. Scan the QR code on your table once your time starts, within ${rules.check_in_window_minutes} minutes.`
              : 'Scan the QR code on your table when you arrive. If the time runs out, the seat is released for others.'}
          </Text>
        </TimerCard>
      </ScreenMain>

      <ActionBar>
        {canCheckIn ? (
          <Button
            component={Link}
            to={paths.scan}
            fullWidth
            leftSection={<Icon name="qr" />}
          >
            Check in
          </Button>
        ) : (
          <Button fullWidth disabled leftSection={<Icon name="qr" />}>
            Check in opens when your time starts
          </Button>
        )}
        <Button
          variant="secondary"
          fullWidth
          onClick={() => setCancelOpen(true)}
        >
          Cancel reservation
        </Button>
      </ActionBar>

      <DecisionSheet
        opened={cancelOpen}
        onClose={closeSheet}
        title="Cancel reservation?"
        safeLabel="Keep seat"
        actionLabel="Cancel reservation"
        actionTone="danger"
        onConfirm={cancel}
      >
        {end.isError
          ? apiProblem(end.error).message
          : `Seat ${held.seat.label} becomes free for others right away.`}
      </DecisionSheet>
    </Screen>
  );
}
