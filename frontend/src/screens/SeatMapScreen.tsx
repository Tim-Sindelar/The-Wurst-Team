import { Alert, Button, Card, Text, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  createReservationMutation,
  getMyReservationQueryKey,
  getSpaceOptions,
} from '../api/generated/@tanstack/react-query.gen';
import { AvailabilityLabel } from '../components/AvailabilityLabel';
import { DecisionSheet } from '../components/DecisionSheet';
import { Icon } from '../components/Icon';
import {
  ActionBar,
  Screen,
  ScreenHeader,
  ScreenMain,
} from '../components/Screen';
import { SeatChip } from '../components/SeatChip';
import { SeatMap } from '../components/seat-map/SeatMap';
import { apiProblem } from '../domain/booking';
import { layoutSeats } from '../domain/room';
import { describeAvailability } from '../domain/space';
import {
  isReservable,
  seatStateDetail,
  seatStateName,
  stripeClass,
} from '../domain/seat';
import { useMyReservation, useRefreshBooking } from '../hooks/useMyReservation';
import { useRules } from '../hooks/useRules';
import { paths } from '../routes';

export function SeatMapScreen() {
  const { spaceId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refresh = useRefreshBooking();
  const spaceQuery = useQuery({
    ...getSpaceOptions({ path: { space_id: spaceId } }),
    refetchInterval: 15_000,
  });
  const { query: rulesQuery, rules } = useRules();
  const { reservation, held, running } = useMyReservation();
  const reserve = useMutation(createReservationMutation());
  const [picked, setPicked] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const space = spaceQuery.data?.space;
  const ownSeatId =
    reservation && (held || running) ? reservation.seat.id : null;
  const { shown: seats, hidden } = useMemo(
    () => layoutSeats(space?.seats ?? [], ownSeatId),
    [space?.seats, ownSeatId],
  );

  const freeCount = space
    ? space.seats.filter((item) => item.state === 'free').length
    : 0;
  const level = space
    ? describeAvailability(space.free_seats, space.total_seats, space.is_open)
    : null;

  const header = (
    <ScreenHeader
      title={space?.name ?? 'Study Spaces'}
      backTo={paths.home}
      backLabel="Back to home"
      subtitle={
        space &&
        level && (
          <AvailabilityLabel availability={level.availability} size="small">
            {space.is_open
              ? `${freeCount} free of ${space.seats.length} seats`
              : 'Closed right now'}
          </AvailabilityLabel>
        )
      }
    />
  );

  if (spaceQuery.isError || rulesQuery.isError) {
    return (
      <Screen>
        {header}
        <ScreenMain>
          <Alert
            variant="danger"
            role="alert"
            icon={<Icon name="alert" />}
            title="Couldn't load this study space"
          >
            <Text size="sm">Check your connection and try again.</Text>
          </Alert>
        </ScreenMain>
        <ActionBar>
          <Button
            fullWidth
            onClick={() => {
              void spaceQuery.refetch();
              void rulesQuery.refetch();
            }}
          >
            Try again
          </Button>
        </ActionBar>
      </Screen>
    );
  }

  if (!space || !rules) {
    return (
      <Screen>
        {header}
        <ScreenMain>
          <Text c="dimmed" role="status">
            Loading seats…
          </Text>
        </ScreenMain>
      </Screen>
    );
  }

  const fallback =
    seats.find((item) => item.state === 'yours') ??
    seats.find((item) => item.state === 'free') ??
    seats[0];
  const seat = seats.find((item) => item.id === picked) ?? fallback;
  const timeFormat = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: space.timezone,
  });
  const reservableFrom = seat?.reservableAt
    ? timeFormat.format(new Date(seat.reservableAt))
    : null;

  const chooseAnyFree = () => {
    const free = seats.find((item) => item.state === 'free');
    if (free) setPicked(free.id);
  };

  const confirmReserve = () => {
    if (!seat) return;
    reserve.mutate(
      { body: { kind: 'seat', seat_id: seat.id } },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getMyReservationQueryKey(), data);
          void refresh();
          navigate(paths.reservation);
        },
        onError: () => void refresh(),
      },
    );
  };

  const closeSheet = () => {
    setSheetOpen(false);
    reserve.reset();
  };

  const own = seat?.state === 'yours';
  const later = seat?.state === 'bookable';
  const busy = ownSeatId !== null && !own;
  const canReserve =
    Boolean(seat) && space.is_open && !busy && isReservable(seat.state);

  let actionLabel = 'No seats to show';
  if (seat) {
    if (own) actionLabel = running ? 'View session' : 'View reservation';
    else if (!space.is_open) actionLabel = 'Closed · unavailable';
    else if (busy) actionLabel = 'You already have a reservation';
    else if (seat.state === 'free') actionLabel = `Reserve seat ${seat.label}`;
    else if (later) actionLabel = `Reserve seat ${seat.label} for later`;
    else actionLabel = `${seatStateName[seat.state]} · unavailable`;
  }

  const sheetNote = later
    ? `${space.name}. Your time starts ${reservableFrom ? `at ${reservableFrom}, ` : ''}when the current session ends. Check in within ${rules.check_in_window_minutes} minutes after that.`
    : `${space.name}. Check in within ${rules.check_in_window_minutes} minutes of reserving, or the seat is released.`;

  return (
    <Screen className="h-dvh overflow-hidden">
      {header}

      <ScreenMain fit>
        {hidden > 0 && (
          <Alert
            variant="warning"
            icon={<Icon name="alert" />}
            title={`${hidden} more seats aren't on the map`}
          >
            <Text size="sm">The room plan has no space for them yet.</Text>
          </Alert>
        )}

        {seat ? (
          <>
            <div className="min-h-0 flex-1 basis-0">
              <SeatMap seats={seats} selected={seat.id} onSelect={setPicked} />
            </div>

            <Card
              component="article"
              className={stripeClass[seat.state]}
              aria-labelledby="selected-seat-title"
              aria-live="polite"
              aria-atomic="true"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Title order={3} id="selected-seat-title">
                  Seat {seat.label}
                </Title>
                <SeatChip state={seat.state} />
              </div>
              <Text size="sm" c="dimmed">
                {space.name} ·{' '}
                {own
                  ? running
                    ? 'Your session'
                    : 'Reserved for you'
                  : later && reservableFrom
                    ? `Occupied · available to reserve from ${reservableFrom}`
                    : seatStateDetail[seat.state]}
              </Text>
            </Card>
          </>
        ) : (
          <Alert icon={<Icon name="clock" />} title="No seats in service">
            <Text size="sm">This study space has no seats you can book.</Text>
          </Alert>
        )}
      </ScreenMain>

      <ActionBar>
        {ownSeatId === null && (
          <Button
            variant="secondary"
            fullWidth
            disabled={!seats.some((item) => item.state === 'free')}
            onClick={chooseAnyFree}
          >
            Choose any free seat
          </Button>
        )}
        <Button
          fullWidth
          disabled={!own && !canReserve}
          onClick={() =>
            own
              ? navigate(running ? paths.session : paths.reservation)
              : setSheetOpen(true)
          }
        >
          {actionLabel}
        </Button>
      </ActionBar>

      <DecisionSheet
        opened={sheetOpen}
        onClose={closeSheet}
        title={`Reserve seat ${seat?.label ?? ''}?`}
        safeLabel="Cancel"
        actionLabel={`Reserve seat ${seat?.label ?? ''}`}
        onConfirm={confirmReserve}
      >
        {reserve.isError ? apiProblem(reserve.error).message : sheetNote}
      </DecisionSheet>
    </Screen>
  );
}
