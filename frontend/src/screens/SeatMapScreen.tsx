import { Alert, Button, Text } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
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
import { DiceButton } from '../components/seat-map/DiceButton';
import { SeatMap } from '../components/seat-map/SeatMap';
import { SeatSheet } from '../components/seat-map/SeatSheet';
import { apiProblem } from '../domain/booking';
import { layoutSeats } from '../domain/room';
import { describeAvailability } from '../domain/space';
import { isReservable, seatStateDetail, seatStateName } from '../domain/seat';
import { useMyReservation, useRefreshBooking } from '../hooks/useMyReservation';
import { useRules } from '../hooks/useRules';
import { paths } from '../routes';

/* Room the seat sheet covers at the bottom of the map; a picked seat is centred above it. */
const SHEET_INSET = 200;

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

  useEffect(() => {
    if (!picked || sheetOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPicked(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [picked, sheetOpen]);

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

  const seat = seats.find((item) => item.id === picked) ?? null;
  const timeFormat = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: space.timezone,
  });
  const reservableFrom = seat?.reservableAt
    ? timeFormat.format(new Date(seat.reservableAt))
    : null;

  const chooseAnyFree = () => {
    /* A random free seat, never the one already shown (unless it's the only one). */
    const free = seats.filter((item) => item.state === 'free');
    const others = free.filter((item) => item.id !== picked);
    const pool = others.length > 0 ? others : free;
    if (pool.length > 0)
      setPicked(pool[Math.floor(Math.random() * pool.length)].id);
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
    seat !== null && space.is_open && !busy && isReservable(seat.state);

  let actionLabel = '';
  if (seat) {
    if (own) actionLabel = running ? 'View session' : 'View reservation';
    else if (!space.is_open) actionLabel = 'Closed · unavailable';
    else if (busy) actionLabel = 'You already have a reservation';
    else if (seat.state === 'free') actionLabel = `Reserve seat ${seat.label}`;
    else if (later) actionLabel = `Reserve seat ${seat.label} for later`;
    else actionLabel = `${seatStateName[seat.state]} · unavailable`;
  }

  const checkIn = (
    <strong className="font-bold text-text">
      {rules.check_in_window_minutes} minutes
    </strong>
  );
  const sheetNote = later ? (
    <>
      Your time starts{' '}
      {reservableFrom
        ? `at ${reservableFrom}`
        : 'when the current session ends'}
      . Check in within {checkIn} after that.
    </>
  ) : (
    <>Check in within {checkIn} or the seat is released.</>
  );

  const seatDetail = seat
    ? own
      ? running
        ? 'Your session'
        : 'Reserved for you'
      : later && reservableFrom
        ? `Occupied · available to reserve from ${reservableFrom}`
        : seatStateDetail[seat.state]
    : null;

  return (
    <Screen className="h-dvh overflow-hidden">
      {header}

      {hidden > 0 && (
        <div className="px-4 pt-3">
          <Alert
            variant="warning"
            icon={<Icon name="alert" />}
            title={`${hidden} more seats aren't on the map`}
          >
            <Text size="sm">The room plan has no space for them yet.</Text>
          </Alert>
        </div>
      )}

      <main className="relative min-h-0 flex-1">
        {seats.length > 0 ? (
          <SeatMap
            seats={seats}
            selected={seat?.id ?? null}
            onSelect={setPicked}
            onDeselect={() => setPicked(null)}
            bottomInset={SHEET_INSET}
          />
        ) : (
          <div className="p-4">
            <Alert icon={<Icon name="clock" />} title="No seats in service">
              <Text size="sm">This study space has no seats you can book.</Text>
            </Alert>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-2 flex flex-col items-end gap-3">
          {ownSeatId === null && (
            <DiceButton
              disabled={!seats.some((item) => item.state === 'free')}
              onRoll={chooseAnyFree}
            />
          )}
          {seat && (
            <SeatSheet
              key={seat.id}
              title={`Seat ${seat.label}`}
              state={seat.state}
              detail={`${space.name} · ${seatDetail}`}
              actionLabel={actionLabel}
              actionDisabled={!own && !canReserve}
              onAction={() =>
                own
                  ? navigate(running ? paths.session : paths.reservation)
                  : setSheetOpen(true)
              }
              onClose={() => setPicked(null)}
            />
          )}
        </div>
      </main>

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
