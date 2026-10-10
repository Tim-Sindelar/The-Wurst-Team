import { Alert, Button, Card, Text, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  endReservationMutation,
  getMyReservationOptions,
  getMyReservationQueryKey,
  listSpacesQueryKey,
} from '../api/generated/@tanstack/react-query.gen';
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
import { stripeClass } from '../domain/seat';
import { paths } from '../routes';

export function ReservationScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery(getMyReservationOptions());
  const end = useMutation(endReservationMutation());
  const [cancelOpen, setCancelOpen] = useState(false);

  const reservation = query.data?.reservation;
  const held =
    reservation?.status === 'upcoming' || reservation?.status === 'pending'
      ? reservation
      : null;

  /* The deadline is on the server's clock; shift it onto this device's so a
     wrong local clock doesn't skew the countdown. */
  const serverTime = query.data?.server_time;
  const deadline =
    held && serverTime
      ? Date.parse(held.check_in_deadline) -
        Date.parse(serverTime) +
        query.dataUpdatedAt
      : null;
  const total = held
    ? Math.max(
        1,
        Math.round(
          (Date.parse(held.check_in_deadline) - Date.parse(held.starts_at)) /
            1000,
        ),
      )
    : 0;

  /* When the hold runs out the server frees the seat; ask again. */
  const { refetch } = query;
  useEffect(() => {
    if (deadline === null) return;
    const timer = window.setTimeout(
      () => void refetch(),
      Math.max(0, deadline - Date.now()) + 500,
    );
    return () => window.clearTimeout(timer);
  }, [deadline, refetch]);

  const cancel = () => {
    if (!held) return;
    end.mutate(
      { path: { reservation_id: held.id } },
      {
        onSuccess: async () => {
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: getMyReservationQueryKey(),
            }),
            queryClient.invalidateQueries({ queryKey: listSpacesQueryKey() }),
          ]);
          navigate(paths.home);
        },
        onSettled: () => setCancelOpen(false),
      },
    );
  };

  if (query.isError) {
    return (
      <Screen>
        <ScreenHeader
          title="Your reservation"
          backTo={paths.home}
          backLabel="Back to home"
        />
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
          <Button fullWidth onClick={() => void query.refetch()}>
            Try again
          </Button>
        </ActionBar>
      </Screen>
    );
  }

  if (!query.data) {
    return (
      <Screen>
        <ScreenHeader
          title="Your reservation"
          backTo={paths.home}
          backLabel="Back to home"
        />
        <ScreenMain>
          <Text c="dimmed" role="status">
            Loading your reservation…
          </Text>
        </ScreenMain>
      </Screen>
    );
  }

  if (!held || deadline === null) {
    return (
      <Screen>
        <ScreenHeader
          title="Your reservation"
          backTo={paths.home}
          backLabel="Back to home"
        />
        <ScreenMain>
          <Alert title="No active reservation" icon={<Icon name="clock" />}>
            <Text>
              Your reservation has expired or been cancelled. The seat is no
              longer held for you.
            </Text>
          </Alert>
        </ScreenMain>
        <ActionBar>
          <Button component={Link} to={paths.seatMap} fullWidth>
            Choose a seat
          </Button>
        </ActionBar>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        title="Your reservation"
        backTo={paths.home}
        backLabel="Back to home"
      />

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
          label="Check in within"
          seconds={total}
          expiresAt={deadline}
          total={total}
        >
          <Text size="sm" c="dimmed">
            Scan the QR code on your table when you arrive. If the time runs
            out, the seat is released for others.
          </Text>
        </TimerCard>
      </ScreenMain>

      <ActionBar>
        <Button
          component={Link}
          to={paths.scan}
          fullWidth
          leftSection={<Icon name="qr" />}
        >
          Check in
        </Button>
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
        onClose={() => setCancelOpen(false)}
        title="Cancel reservation?"
        safeLabel="Keep seat"
        actionLabel="Cancel reservation"
        actionTone="danger"
        onConfirm={cancel}
      >
        {end.isError
          ? "Couldn't cancel. Try again."
          : `Seat ${held.seat.label} becomes free for others right away.`}
      </DecisionSheet>
    </Screen>
  );
}
